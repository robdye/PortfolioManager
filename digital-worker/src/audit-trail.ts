// Portfolio Manager — Audit Trail
// Logs every worker action for compliance and governance.
// Uses Azure Table Storage for durable, queryable audit records.
// Falls back to console logging when Table Storage is not configured.

import { TableClient, AzureNamedKeyCredential } from '@azure/data-tables';

// ── Audit Entry ──

export interface AuditEntry {
  /** Partition key: worker ID */
  partitionKey: string;
  /** Row key: timestamp + random suffix for uniqueness */
  rowKey: string;
  /** Worker that performed the action */
  workerId: string;
  /** Worker display name */
  workerName: string;
  /** Tool that was called */
  toolName: string;
  /** Tool risk classification */
  riskLevel: 'read' | 'write' | 'notify';
  /** Who triggered the action */
  triggeredBy: string;
  /** How it was triggered */
  triggerType: 'user' | 'scheduled' | 'delegation' | 'escalation';
  /** Tool parameters (sanitized — no secrets) */
  parameters: string;
  /** Result summary (truncated) */
  resultSummary: string;
  /** Whether the action required HITL confirmation */
  requiredConfirmation: boolean;
  /** Whether the user approved (for WRITE/NOTIFY) */
  approved?: boolean;
  /** Duration in milliseconds */
  durationMs: number;
  /** ISO timestamp */
  timestamp: string;
}

// ── Configuration ──

const TABLE_NAME = 'PortfolioManagerAudit';
const STORAGE_ACCOUNT = process.env.AUDIT_STORAGE_ACCOUNT || '';
const STORAGE_KEY = process.env.AUDIT_STORAGE_KEY || '';
const STORAGE_CONNECTION_STRING = process.env.AUDIT_STORAGE_CONNECTION_STRING || '';

let tableClient: TableClient | null = null;
let initialized = false;

// ── In-memory fallback (when Table Storage not configured) ──

const inMemoryLog: AuditEntry[] = [];
const MAX_IN_MEMORY = 1000;

// ── Initialization ──

async function ensureTable(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (STORAGE_CONNECTION_STRING) {
    try {
      tableClient = TableClient.fromConnectionString(STORAGE_CONNECTION_STRING, TABLE_NAME);
      await tableClient.createTable();
      console.log(`[AuditTrail] Connected to Azure Table Storage: ${TABLE_NAME}`);
    } catch (err: any) {
      if (err?.statusCode === 409) {
        console.log(`[AuditTrail] Table ${TABLE_NAME} already exists`);
      } else {
        console.warn('[AuditTrail] Table Storage init failed, using in-memory fallback:', err?.message);
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
      console.log(`[AuditTrail] Connected to Azure Table Storage: ${TABLE_NAME}`);
    } catch (err: any) {
      if (err?.statusCode === 409) {
        console.log(`[AuditTrail] Table ${TABLE_NAME} already exists`);
      } else {
        console.warn('[AuditTrail] Table Storage init failed, using in-memory fallback:', err?.message);
        tableClient = null;
      }
    }
  } else {
    console.log('[AuditTrail] No Azure Table Storage configured — using in-memory audit log');
  }
}

// ── Parameter Sanitization ──

export const SENSITIVE_KEYS = /password|secret|token|api_key|credential|authorization|bearer|cookie|finnhub|account_number/i;

export function sanitizeParams(params: string): string {
  try {
    const parsed = JSON.parse(params);
    return JSON.stringify(redactSensitive(parsed));
  } catch {
    // Not JSON — redact inline patterns
    return params.replace(/(password|secret|token|api_key|credential|finnhub|account_number)["']?\s*[:=]\s*["']?[^"',}\s]+/gi, '$1=[REDACTED]');
  }
}

function redactSensitive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitive);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redactSensitive(value);
    }
    return result;
  }
  return obj;
}

// ── Core Logging ──

/**
 * Log an audit entry. Writes to Azure Table Storage if configured,
 * otherwise falls back to in-memory + console.
 */
export async function logAuditEntry(entry: Omit<AuditEntry, 'partitionKey' | 'rowKey' | 'timestamp'>): Promise<void> {
  await ensureTable();

  const fullEntry: AuditEntry = {
    ...entry,
    parameters: sanitizeParams(entry.parameters),
    partitionKey: entry.workerId,
    rowKey: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    timestamp: new Date().toISOString(),
  };

  if (tableClient) {
    try {
      await tableClient.createEntity(fullEntry);
    } catch (err) {
      console.error('[AuditTrail] Failed to write to Table Storage:', err);
      pushInMemory(fullEntry);
    }
  } else {
    pushInMemory(fullEntry);
  }

  // Always log to console for observability
  console.log(`[Audit] ${fullEntry.triggerType} | ${fullEntry.workerId} | ${fullEntry.toolName} | ${fullEntry.riskLevel} | ${fullEntry.triggeredBy} | ${fullEntry.durationMs}ms`);
}

function pushInMemory(entry: AuditEntry): void {
  inMemoryLog.push(entry);
  if (inMemoryLog.length > MAX_IN_MEMORY) inMemoryLog.shift();
}

// ── Query ──

/**
 * Get recent audit entries from in-memory log.
 */
export function getRecentAuditEntries(limit = 50): AuditEntry[] {
  return inMemoryLog.slice(-limit);
}

/**
 * Get audit entries for a specific worker.
 */
export function getWorkerAuditEntries(workerId: string, limit = 50): AuditEntry[] {
  return inMemoryLog
    .filter(e => e.workerId === workerId)
    .slice(-limit);
}

/**
 * Get audit summary stats.
 */
export function getAuditSummary(): {
  totalEntries: number;
  byWorker: Record<string, number>;
  byRiskLevel: Record<string, number>;
  byTriggerType: Record<string, number>;
  storageBackend: 'azure-table' | 'in-memory';
} {
  const byWorker: Record<string, number> = {};
  const byRiskLevel: Record<string, number> = {};
  const byTriggerType: Record<string, number> = {};

  for (const entry of inMemoryLog) {
    byWorker[entry.workerId] = (byWorker[entry.workerId] || 0) + 1;
    byRiskLevel[entry.riskLevel] = (byRiskLevel[entry.riskLevel] || 0) + 1;
    byTriggerType[entry.triggerType] = (byTriggerType[entry.triggerType] || 0) + 1;
  }

  return {
    totalEntries: inMemoryLog.length,
    byWorker,
    byRiskLevel,
    byTriggerType,
    storageBackend: tableClient ? 'azure-table' : 'in-memory',
  };
}
