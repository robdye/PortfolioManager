// Portfolio Manager Digital Worker — Persistent Memory via Dataverse
//
// Replaces in-memory Maps with Dataverse-backed storage that survives
// container restarts. Uses the MCP server's portfolio endpoint as a
// proxy to Dataverse (avoids duplicating OBO auth in the worker).
//
// Tables used (stored via MCP server /portfolio/mcp tools):
//   - pm_agentmemory — decision state, alert history, conversation memory
//
// Falls back to in-memory if Dataverse is unreachable.

import { mcpClient } from './mcp-client';

// ── In-Memory Fallback Cache ────────────────────────────────────────

interface MemoryEntry {
  key: string;
  category: string; // 'decision_state' | 'alert_history' | 'conversation' | 'signal_effectiveness' | 'investment_thesis'
  data: Record<string, unknown>;
  updatedAt: number;
}

const memoryCache = new Map<string, MemoryEntry>();
let dataverseAvailable: boolean | null = null; // null = untested

// ── Dataverse Operations (via MCP server) ───────────────────────────

async function tryDataverseGet(category: string, key: string): Promise<MemoryEntry | null> {
  if (dataverseAvailable === false) return null;
  try {
    const result = await mcpClient.callTool(mcpClient.portfolioEndpoint, 'get-agent-memory', { category, key });
    if (result && typeof result === 'object' && 'data' in (result as any)) {
      dataverseAvailable = true;
      return result as MemoryEntry;
    }
    // Tool might not exist yet — that's fine, use in-memory
    dataverseAvailable = false;
    return null;
  } catch {
    dataverseAvailable = false;
    return null;
  }
}

async function tryDataversePut(entry: MemoryEntry): Promise<boolean> {
  if (dataverseAvailable === false) return false;
  try {
    await mcpClient.callTool(mcpClient.portfolioEndpoint, 'upsert-agent-memory', {
      category: entry.category,
      key: entry.key,
      data: JSON.stringify(entry.data),
    });
    dataverseAvailable = true;
    return true;
  } catch {
    dataverseAvailable = false;
    return false;
  }
}

// ── Public API ──────────────────────────────────────────────────────

export async function saveMemory(category: string, key: string, data: Record<string, unknown>): Promise<void> {
  const entry: MemoryEntry = { key, category, data, updatedAt: Date.now() };
  memoryCache.set(`${category}:${key}`, entry);
  await tryDataversePut(entry); // Best-effort persist
}

export async function loadMemory(category: string, key: string): Promise<Record<string, unknown> | null> {
  // Check in-memory first
  const cached = memoryCache.get(`${category}:${key}`);
  if (cached) return cached.data;

  // Try Dataverse
  const entry = await tryDataverseGet(category, key);
  if (entry) {
    memoryCache.set(`${category}:${key}`, entry);
    return entry.data;
  }
  return null;
}

// ── Decision State Persistence ──────────────────────────────────────

export interface PersistedDecisionState {
  snapshots: Record<string, unknown>;
  suppressedAlerts: Record<string, number>;
  alertHistory: Array<{ symbol: string; type: string; timestamp: number }>;
  runCount: number;
  lastRun: number;
}

export async function saveDecisionState(state: PersistedDecisionState): Promise<void> {
  await saveMemory('decision_state', 'current', state as unknown as Record<string, unknown>);
}

export async function loadDecisionState(): Promise<PersistedDecisionState | null> {
  const data = await loadMemory('decision_state', 'current');
  return data as PersistedDecisionState | null;
}

// ── Conversation Memory (Persistent) ────────────────────────────────

const MAX_HISTORY = 20; // Doubled from 10 — persistence means we can afford more

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// In-memory cache for fast access during a session
const conversationCache = new Map<string, Message[]>();

export function addMessage(userId: string, role: 'user' | 'assistant', content: string): void {
  if (!conversationCache.has(userId)) {
    conversationCache.set(userId, []);
  }
  const history = conversationCache.get(userId)!;
  history.push({ role, content, timestamp: Date.now() });
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  // Best-effort persist (fire and forget)
  saveMemory('conversation', userId, { messages: history }).catch((err) => { console.error('[Memory] Failed to persist conversation:', (err as Error).message); });
}

export function getHistory(userId: string): string {
  const history = conversationCache.get(userId);
  if (!history || history.length === 0) return '';
  return history.map(m => `${m.role === 'user' ? 'User' : 'PM Agent'}: ${m.content.substring(0, 300)}`).join('\n');
}

export async function loadConversationHistory(userId: string): Promise<void> {
  if (conversationCache.has(userId)) return; // Already loaded
  const data = await loadMemory('conversation', userId);
  if (data && Array.isArray((data as any).messages)) {
    conversationCache.set(userId, (data as any).messages);
  }
}

export function clearHistory(userId: string): void {
  conversationCache.delete(userId);
  saveMemory('conversation', userId, { messages: [] }).catch((err) => { console.error('[Memory] Failed to persist conversation clear:', (err as Error).message); });
}

// ── Signal Effectiveness Tracking ───────────────────────────────────
// Track which alerts the PM acted on vs. ignored

export interface AlertOutcome {
  symbol: string;
  signalType: string;
  timestamp: number;
  severity: string;
  wasActedOn: boolean; // true if PM responded/acted within 2 hours
}

const effectivenessCache: AlertOutcome[] = [];

// Periodic TTL cleanup — remove entries older than 7 days
setInterval(() => {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (let i = effectivenessCache.length - 1; i >= 0; i--) {
    if (effectivenessCache[i].timestamp < cutoff) effectivenessCache.splice(i, 1);
  }
}, 60 * 60 * 1000);

export async function recordAlertSent(symbol: string, signalType: string, severity: string): Promise<void> {
  effectivenessCache.push({ symbol, signalType, timestamp: Date.now(), severity, wasActedOn: false });
  if (effectivenessCache.length > 500) effectivenessCache.splice(0, effectivenessCache.length - 500);
  await saveMemory('signal_effectiveness', 'history', { outcomes: effectivenessCache }).catch((err) => { console.error('[Memory] Failed to persist alert record:', (err as Error).message); });
}

export async function markAlertActedOn(symbol: string): Promise<void> {
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  const recent = effectivenessCache.filter(a => a.symbol === symbol && a.timestamp > twoHoursAgo);
  for (const a of recent) a.wasActedOn = true;
  await saveMemory('signal_effectiveness', 'history', { outcomes: effectivenessCache }).catch((err) => { console.error('[Memory] Failed to persist alert update:', (err as Error).message); });
}

export function getEffectivenessStats(): { totalAlerts: number; actedOn: number; rate: number; byType: Record<string, { sent: number; acted: number }> } {
  const total = effectivenessCache.length;
  const acted = effectivenessCache.filter(a => a.wasActedOn).length;
  const byType: Record<string, { sent: number; acted: number }> = {};
  for (const a of effectivenessCache) {
    if (!byType[a.signalType]) byType[a.signalType] = { sent: 0, acted: 0 };
    byType[a.signalType].sent++;
    if (a.wasActedOn) byType[a.signalType].acted++;
  }
  return { totalAlerts: total, actedOn: acted, rate: total > 0 ? acted / total : 0, byType };
}

// ── Dataverse availability status ───────────────────────────────────
export function isDataverseAvailable(): boolean | null {
  return dataverseAvailable;
}
