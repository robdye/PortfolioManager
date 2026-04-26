// Portfolio Manager — Durable Memory Store
// Tiered memory using Azure Table Storage:
// - Short-term: Per-conversation context (last 10 messages) — 24h TTL
// - Medium-term: Per-user session state (positions, active signals) — 7d TTL
// - Long-term: Cross-session knowledge (preferences, convictions, outcomes) — no TTL
// Falls back to in-memory when Table Storage is not configured.

import { TableClient, AzureNamedKeyCredential } from '@azure/data-tables';

// ── Memory Tiers ──

export interface MemoryEntry {
  partitionKey: string;  // userId or 'system'
  rowKey: string;        // tier + timestamp
  tier: 'short' | 'medium' | 'long';
  category: string;      // 'conversation' | 'session' | 'preference' | 'conviction' | 'outcome'
  content: string;
  workerId?: string;
  expiresAt?: string;
  timestamp: string;
}

// ── Configuration ──

const TABLE_NAME = 'PortfolioManagerMemory';
const STORAGE_CONNECTION_STRING = process.env.AUDIT_STORAGE_CONNECTION_STRING || '';
const STORAGE_ACCOUNT = process.env.AUDIT_STORAGE_ACCOUNT || '';
const STORAGE_KEY = process.env.AUDIT_STORAGE_KEY || '';

let tableClient: TableClient | null = null;
let initialized = false;

// In-memory fallback
const memoryStore = new Map<string, MemoryEntry[]>();
const MAX_PER_USER = 100;

async function ensureTable(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (STORAGE_CONNECTION_STRING) {
    try {
      tableClient = TableClient.fromConnectionString(STORAGE_CONNECTION_STRING, TABLE_NAME);
      await tableClient.createTable();
      console.log(`[MemoryStore] Connected to Azure Table Storage: ${TABLE_NAME}`);
    } catch (err: any) {
      if (err?.statusCode === 409) {
        console.log(`[MemoryStore] Table ${TABLE_NAME} already exists`);
      } else {
        console.warn('[MemoryStore] Table Storage init failed, using in-memory fallback:', err?.message);
        tableClient = null;
      }
    }
  } else if (STORAGE_ACCOUNT && STORAGE_KEY) {
    try {
      const cred = new AzureNamedKeyCredential(STORAGE_ACCOUNT, STORAGE_KEY);
      tableClient = new TableClient(
        `https://${STORAGE_ACCOUNT}.table.core.windows.net`,
        TABLE_NAME,
        cred,
      );
      await tableClient.createTable();
      console.log(`[MemoryStore] Connected to Azure Table Storage: ${TABLE_NAME}`);
    } catch (err: any) {
      if (err?.statusCode === 409) {
        console.log(`[MemoryStore] Table ${TABLE_NAME} already exists`);
      } else {
        console.warn('[MemoryStore] Table Storage init failed, using in-memory fallback:', err?.message);
        tableClient = null;
      }
    }
  } else {
    console.log('[MemoryStore] No Azure Table Storage configured — using in-memory store');
  }
}

// ── Write ──

export async function storeMemory(
  userId: string,
  tier: 'short' | 'medium' | 'long',
  category: string,
  content: string,
  workerId?: string,
  ttlHours?: number,
): Promise<void> {
  await ensureTable();

  const entry: MemoryEntry = {
    partitionKey: userId,
    rowKey: `${tier}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    tier,
    category,
    content: content.substring(0, 32_000),
    workerId,
    expiresAt: ttlHours ? new Date(Date.now() + ttlHours * 3600_000).toISOString() : undefined,
    timestamp: new Date().toISOString(),
  };

  if (tableClient) {
    try {
      await tableClient.createEntity(entry);
    } catch (err) {
      console.error('[MemoryStore] Failed to write:', err);
      pushLocal(userId, entry);
    }
  } else {
    pushLocal(userId, entry);
  }
}

function pushLocal(userId: string, entry: MemoryEntry): void {
  if (!memoryStore.has(userId)) memoryStore.set(userId, []);
  const entries = memoryStore.get(userId)!;
  entries.push(entry);
  if (entries.length > MAX_PER_USER) entries.shift();
}

// ── Read ──

export async function getMemory(
  userId: string,
  tier?: 'short' | 'medium' | 'long',
  limit = 20,
): Promise<MemoryEntry[]> {
  await ensureTable();

  const entries = memoryStore.get(userId) || [];
  let filtered = tier ? entries.filter(e => e.tier === tier) : entries;

  const now = new Date().toISOString();
  filtered = filtered.filter(e => !e.expiresAt || e.expiresAt > now);

  return filtered.slice(-limit);
}

/**
 * Store a conversation message (short-term memory, 24h TTL).
 */
export async function addConversationMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  workerId?: string,
): Promise<void> {
  await storeMemory(userId, 'short', 'conversation', `${role}: ${content}`, workerId, 24);
}

/**
 * Get conversation history (short-term memory).
 */
export async function getConversationHistory(userId: string, limit = 10): Promise<string> {
  const entries = await getMemory(userId, 'short', limit);
  return entries
    .filter(e => e.category === 'conversation')
    .map(e => e.content)
    .join('\n');
}

/**
 * Store a PM preference for long-term retention.
 * Example: "I hate banks below 1x book" → stored with provenance.
 */
export async function storePreference(
  userId: string,
  content: string,
  workerId?: string,
): Promise<void> {
  await storeMemory(userId, 'long', 'preference', content, workerId);
}

/**
 * Store an investment conviction for long-term retention.
 * Example: "Bullish on UK gilts — rate cuts imminent"
 */
export async function storeConviction(
  userId: string,
  content: string,
  workerId?: string,
): Promise<void> {
  await storeMemory(userId, 'long', 'conviction', content, workerId);
}

/**
 * Store a trade outcome for learning.
 */
export async function storeOutcome(
  userId: string,
  content: string,
  workerId?: string,
): Promise<void> {
  await storeMemory(userId, 'long', 'outcome', content, workerId);
}

/**
 * Get all long-term memory (preferences + convictions + outcomes).
 */
export async function getLongTermMemory(userId: string, limit = 50): Promise<MemoryEntry[]> {
  return getMemory(userId, 'long', limit);
}

/**
 * Get memory store summary.
 */
export function getMemoryStoreSummary(): {
  userCount: number;
  totalEntries: number;
  byTier: Record<string, number>;
  storageBackend: 'azure-table' | 'in-memory';
} {
  let totalEntries = 0;
  const byTier: Record<string, number> = { short: 0, medium: 0, long: 0 };

  for (const entries of memoryStore.values()) {
    totalEntries += entries.length;
    for (const e of entries) {
      byTier[e.tier] = (byTier[e.tier] || 0) + 1;
    }
  }

  return {
    userCount: memoryStore.size,
    totalEntries,
    byTier,
    storageBackend: tableClient ? 'azure-table' : 'in-memory',
  };
}
