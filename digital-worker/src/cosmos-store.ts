// Portfolio Manager — Cosmos DB Persistence Layer
// Provides durable storage for conversation threads, reasoning traces, and audit data.
// Falls back to in-memory when COSMOS_CONNECTION_STRING is not configured.

import { CosmosClient, Container, Database } from '@azure/cosmos';

// ── Configuration ──

const COSMOS_CONNECTION_STRING = process.env.COSMOS_CONNECTION_STRING || '';
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'portfolio-manager';
const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT || '';
const COSMOS_KEY = process.env.COSMOS_KEY || '';

let client: CosmosClient | null = null;
let database: Database | null = null;
let conversationsContainer: Container | null = null;
let tracesContainer: Container | null = null;
let memoryContainer: Container | null = null;
let initialized = false;

// In-memory fallbacks (bounded — dev/test only; use Cosmos DB in production)
const memConversations = new Map<string, ConversationThread[]>();
const memTraces: StoredReasoningTrace[] = [];
const MAX_MEM_TRACES = 5000;
const MAX_THREADS_PER_USER = 50;
const MAX_MEM_USERS = 1000;

// ── Types ──

export interface ConversationThread {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  workerId?: string;
  timestamp: string;
  ttl?: number;
}

export interface StoredReasoningTrace {
  id: string;
  conversationId: string;
  type: string;
  source: string;
  summary: string;
  detail: string;
  confidence?: string;
  durationMs?: number;
  metadata?: Record<string, string>;
  marketContext?: {
    symbols: string[];
    prices: Record<string, number>;
    signals: string[];
  };
  timestamp: string;
  ttl?: number;
}

export interface MemoryDocument {
  id: string;
  userId: string;
  category: string; // 'preference' | 'conviction' | 'outcome' | 'risk_appetite'
  content: string;
  provenance?: { conversationId: string; timestamp: string };
  timestamp: string;
  ttl?: number;
}

// ── Initialization ──

export async function initCosmosStore(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (!COSMOS_CONNECTION_STRING && !COSMOS_ENDPOINT) {
    console.log('[CosmosStore] No Cosmos DB configured — using in-memory fallback');
    return;
  }

  try {
    if (COSMOS_CONNECTION_STRING) {
      client = new CosmosClient(COSMOS_CONNECTION_STRING);
    } else if (COSMOS_ENDPOINT && COSMOS_KEY) {
      client = new CosmosClient({ endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY });
    } else {
      const { DefaultAzureCredential } = await import('@azure/identity');
      const credential = new DefaultAzureCredential();
      client = new CosmosClient({ endpoint: COSMOS_ENDPOINT, aadCredentials: credential });
    }

    const { database: db } = await client.databases.createIfNotExists({ id: COSMOS_DATABASE });
    database = db;

    const { container: convos } = await db.containers.createIfNotExists({
      id: 'conversations',
      partitionKey: { paths: ['/userId'] },
      defaultTtl: 30 * 24 * 3600, // 30 days
    });
    conversationsContainer = convos;

    const { container: traces } = await db.containers.createIfNotExists({
      id: 'reasoning-traces',
      partitionKey: { paths: ['/conversationId'] },
      defaultTtl: 90 * 24 * 3600, // 90 days
    });
    tracesContainer = traces;

    const { container: memory } = await db.containers.createIfNotExists({
      id: 'memory',
      partitionKey: { paths: ['/userId'] },
      defaultTtl: -1, // No expiry — preferences persist indefinitely
    });
    memoryContainer = memory;

    console.log(`[CosmosStore] Connected to Cosmos DB: ${COSMOS_DATABASE} (conversations, reasoning-traces, memory)`);
  } catch (err) {
    console.error('[CosmosStore] Cosmos DB init failed, using in-memory fallback:', (err as Error).message);
    client = null;
  }
}

// ── Conversation Operations ──

export async function addThreadMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  workerId?: string,
): Promise<void> {
  const entry: ConversationThread = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    userId,
    role,
    content: content.substring(0, 32000),
    workerId,
    timestamp: new Date().toISOString(),
    ttl: 30 * 24 * 3600,
  };

  if (conversationsContainer) {
    try {
      await conversationsContainer.items.create(entry);
    } catch (err) {
      console.error('[CosmosStore] Conversation write failed:', (err as Error).message);
      pushMemConversation(userId, entry);
    }
  } else {
    pushMemConversation(userId, entry);
  }
}

function pushMemConversation(userId: string, entry: ConversationThread): void {
  if (!memConversations.has(userId)) {
    if (memConversations.size >= MAX_MEM_USERS) {
      const oldestKey = memConversations.keys().next().value;
      if (oldestKey) memConversations.delete(oldestKey);
    }
    memConversations.set(userId, []);
  }
  const msgs = memConversations.get(userId)!;
  msgs.push(entry);
  if (msgs.length > MAX_THREADS_PER_USER) msgs.shift();
}

export async function getThreadHistory(userId: string, limit = 10): Promise<string> {
  if (conversationsContainer) {
    try {
      const { resources } = await conversationsContainer.items
        .query({
          query: 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit',
          parameters: [
            { name: '@userId', value: userId },
            { name: '@limit', value: limit },
          ],
        })
        .fetchAll();
      return resources
        .reverse()
        .map((m: ConversationThread) => `${m.role === 'user' ? 'User' : 'PM Agent'}: ${m.content}`)
        .join('\n');
    } catch (err) {
      console.error('[CosmosStore] Conversation read failed:', (err as Error).message);
    }
  }

  const msgs = memConversations.get(userId) || [];
  return msgs.slice(-limit).map(m => `${m.role === 'user' ? 'User' : 'PM Agent'}: ${m.content}`).join('\n');
}

export async function clearThreadHistory(userId: string): Promise<void> {
  memConversations.delete(userId);
}

// ── Reasoning Trace Operations ──

export async function storeReasoningTrace(trace: StoredReasoningTrace): Promise<void> {
  if (tracesContainer) {
    try {
      await tracesContainer.items.create({ ...trace, ttl: 90 * 24 * 3600 });
    } catch (err) {
      console.error('[CosmosStore] Trace write failed:', (err as Error).message);
      memTraces.push(trace);
      if (memTraces.length > MAX_MEM_TRACES) memTraces.splice(0, memTraces.length - MAX_MEM_TRACES);
    }
  } else {
    memTraces.push(trace);
    if (memTraces.length > MAX_MEM_TRACES) memTraces.splice(0, memTraces.length - MAX_MEM_TRACES);
  }
}

export async function queryTraces(opts?: {
  conversationId?: string;
  type?: string;
  since?: string;
  limit?: number;
}): Promise<StoredReasoningTrace[]> {
  const limit = opts?.limit || 200;

  if (tracesContainer) {
    try {
      const conditions: string[] = ['1=1'];
      const params: { name: string; value: string | number }[] = [];

      if (opts?.conversationId) {
        conditions.push('c.conversationId = @convId');
        params.push({ name: '@convId', value: opts.conversationId });
      }
      if (opts?.type) {
        conditions.push('c.type = @type');
        params.push({ name: '@type', value: opts.type });
      }
      if (opts?.since) {
        conditions.push('c.timestamp >= @since');
        params.push({ name: '@since', value: opts.since });
      }

      const { resources } = await tracesContainer.items
        .query({
          query: `SELECT TOP @limit * FROM c WHERE ${conditions.join(' AND ')} ORDER BY c.timestamp DESC`,
          parameters: [...params, { name: '@limit', value: limit }],
        })
        .fetchAll();
      return resources as StoredReasoningTrace[];
    } catch (err) {
      console.error('[CosmosStore] Trace query failed:', (err as Error).message);
    }
  }

  let result = [...memTraces];
  if (opts?.conversationId) result = result.filter(t => t.conversationId === opts.conversationId);
  if (opts?.type) result = result.filter(t => t.type === opts.type);
  if (opts?.since) {
    const sinceTime = new Date(opts.since).getTime();
    result = result.filter(t => new Date(t.timestamp).getTime() >= sinceTime);
  }
  result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return result.slice(0, limit);
}

// ── Memory Operations (PM preferences, convictions, outcomes) ──

export async function storeMemoryDocument(doc: MemoryDocument): Promise<void> {
  if (memoryContainer) {
    try {
      await memoryContainer.items.create(doc);
    } catch (err) {
      console.error('[CosmosStore] Memory write failed:', (err as Error).message);
    }
  }
}

export async function getUserMemory(
  userId: string,
  category?: string,
  limit = 50,
): Promise<MemoryDocument[]> {
  if (memoryContainer) {
    try {
      const conditions = ['c.userId = @userId'];
      const params: { name: string; value: string | number }[] = [
        { name: '@userId', value: userId },
      ];
      if (category) {
        conditions.push('c.category = @category');
        params.push({ name: '@category', value: category });
      }
      const { resources } = await memoryContainer.items
        .query({
          query: `SELECT TOP @limit * FROM c WHERE ${conditions.join(' AND ')} ORDER BY c.timestamp DESC`,
          parameters: [...params, { name: '@limit', value: limit }],
        })
        .fetchAll();
      return resources as MemoryDocument[];
    } catch (err) {
      console.error('[CosmosStore] Memory read failed:', (err as Error).message);
    }
  }
  return [];
}

// ── Store Summary ──

export function getCosmosStoreSummary(): {
  backend: 'cosmos-db' | 'in-memory';
  memConversationUsers: number;
  memTraceCount: number;
} {
  return {
    backend: client ? 'cosmos-db' : 'in-memory',
    memConversationUsers: memConversations.size,
    memTraceCount: memTraces.length,
  };
}
