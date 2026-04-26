// Portfolio Manager — Reasoning Trace Store
// Captures the full agent decision-making process: intent classification,
// worker routing, tool calls, LLM reasoning, and outcome evaluation.
// Exposed via /api/reasoning-traces for the Mission Control Agent Mind tab.

// ── Trace Entry Types ──

export type TraceType =
  | 'intent'         // User message classified to a worker
  | 'routing'        // Decision on which worker handles the request
  | 'tool-call'      // Tool invoked by the agent
  | 'tool-result'    // Result returned from a tool
  | 'llm-thinking'   // LLM internal reasoning / chain-of-thought
  | 'delegation'     // Worker delegated to another worker
  | 'escalation'     // Request escalated up the chain
  | 'approval'       // Human-in-the-loop approval decision
  | 'market-signal'  // Decision engine signal detected
  | 'error'          // Error during processing
  | 'outcome';       // Final response delivered

export interface ReasoningTrace {
  id: string;
  conversationId: string;
  timestamp: string;
  type: TraceType;
  source: string;
  summary: string;
  detail: string;
  confidence?: 'high' | 'medium' | 'low';
  durationMs?: number;
  metadata?: Record<string, string>;
  marketContext?: {
    symbols?: string[];
    prices?: Record<string, number>;
    signals?: string[];
  };
}

// ── In-Memory Store ──

const MAX_TRACES = 2000;
const traces: ReasoningTrace[] = [];
let traceCounter = 0;

function generateId(): string {
  return `rt-${Date.now()}-${(++traceCounter).toString(36)}`;
}

function generateConversationId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
}

// ── Public API ──

export function startConversation(): string {
  return generateConversationId();
}

export function logTrace(entry: Omit<ReasoningTrace, 'id' | 'timestamp'>): ReasoningTrace {
  const trace: ReasoningTrace = {
    ...entry,
    id: generateId(),
    timestamp: new Date().toISOString(),
  };
  traces.push(trace);
  if (traces.length > MAX_TRACES) traces.splice(0, traces.length - MAX_TRACES);

  const conf = trace.confidence ? ` [${trace.confidence}]` : '';
  const dur = trace.durationMs ? ` (${trace.durationMs}ms)` : '';
  console.log(`[Reasoning] ${trace.type}${conf}${dur} | ${trace.source} | ${trace.summary}`);

  return trace;
}

export function logIntent(
  conversationId: string,
  userMessage: string,
  workerId: string,
  workerName: string,
  confidence: 'high' | 'medium' | 'low',
  reason: string
): ReasoningTrace {
  return logTrace({
    conversationId,
    type: 'intent',
    source: 'intent-classifier',
    summary: `Classified to ${workerName}`,
    detail: `User asked: "${truncate(userMessage, 200)}"\nMatched worker: ${workerId}\nReason: ${reason}`,
    confidence,
    metadata: { workerId, workerName, userMessage: truncate(userMessage, 500) },
  });
}

export function logRouting(
  conversationId: string,
  fromWorker: string,
  toWorker: string,
  reason: string
): ReasoningTrace {
  return logTrace({
    conversationId,
    type: 'routing',
    source: fromWorker,
    summary: `Routed → ${toWorker}`,
    detail: reason,
    metadata: { fromWorker, toWorker },
  });
}

export function logToolCall(
  conversationId: string,
  workerSource: string,
  toolName: string,
  args: Record<string, unknown>
): ReasoningTrace {
  const sanitized = sanitizeArgs(args);
  return logTrace({
    conversationId,
    type: 'tool-call',
    source: workerSource,
    summary: `Called ${toolName}`,
    detail: `Arguments: ${JSON.stringify(sanitized, null, 2)}`,
    metadata: { toolName, workerSource },
  });
}

export function logToolResult(
  conversationId: string,
  workerSource: string,
  toolName: string,
  resultSummary: string,
  durationMs: number
): ReasoningTrace {
  return logTrace({
    conversationId,
    type: 'tool-result',
    source: workerSource,
    summary: `${toolName} returned`,
    detail: truncate(resultSummary, 500),
    durationMs,
    metadata: { toolName, workerSource },
  });
}

export function logThinking(
  conversationId: string,
  workerSource: string,
  thinking: string
): ReasoningTrace {
  return logTrace({
    conversationId,
    type: 'llm-thinking',
    source: workerSource,
    summary: `Reasoning: ${truncate(thinking, 80)}`,
    detail: thinking,
    metadata: { workerSource },
  });
}

export function logDelegation(
  conversationId: string,
  fromWorker: string,
  toWorker: string,
  reason: string
): ReasoningTrace {
  return logTrace({
    conversationId,
    type: 'delegation',
    source: fromWorker,
    summary: `Delegated → ${toWorker}`,
    detail: reason,
    metadata: { fromWorker, toWorker },
  });
}

export function logEscalation(
  conversationId: string,
  fromWorker: string,
  toLevel: string,
  reason: string
): ReasoningTrace {
  return logTrace({
    conversationId,
    type: 'escalation',
    source: fromWorker,
    summary: `Escalated to ${toLevel}`,
    detail: reason,
    metadata: { fromWorker, escalationLevel: toLevel },
  });
}

/** Log a market signal detection (PM-specific). */
export function logMarketSignal(
  conversationId: string,
  signalType: string,
  symbols: string[],
  detail: string,
  confidence: 'high' | 'medium' | 'low'
): ReasoningTrace {
  return logTrace({
    conversationId,
    type: 'market-signal',
    source: 'decision-engine',
    summary: `Signal: ${signalType} on ${symbols.join(', ')}`,
    detail,
    confidence,
    marketContext: { symbols, signals: [signalType] },
    metadata: { signalType, symbols: symbols.join(',') },
  });
}

export function logOutcome(
  conversationId: string,
  workerSource: string,
  responseSummary: string,
  durationMs: number
): ReasoningTrace {
  return logTrace({
    conversationId,
    type: 'outcome',
    source: workerSource,
    summary: `Response delivered`,
    detail: truncate(responseSummary, 500),
    durationMs,
    metadata: { workerSource },
  });
}

export function logError(
  conversationId: string,
  source: string,
  error: string
): ReasoningTrace {
  return logTrace({
    conversationId,
    type: 'error',
    source,
    summary: `Error: ${truncate(error, 80)}`,
    detail: error,
  });
}

// ── Query Functions ──

export function getTraces(opts?: {
  limit?: number;
  conversationId?: string;
  type?: TraceType;
  since?: string;
}): ReasoningTrace[] {
  let result = [...traces];

  if (opts?.conversationId) {
    result = result.filter(t => t.conversationId === opts.conversationId);
  }
  if (opts?.type) {
    result = result.filter(t => t.type === opts.type);
  }
  if (opts?.since) {
    const sinceTime = new Date(opts.since).getTime();
    result = result.filter(t => new Date(t.timestamp).getTime() >= sinceTime);
  }

  result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const limit = opts?.limit || 200;
  return result.slice(0, limit);
}

export function getConversations(limit = 50): Array<{
  conversationId: string;
  traceCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
  worker: string;
  userMessage: string;
}> {
  const map = new Map<string, {
    count: number;
    first: string;
    last: string;
    worker: string;
    userMessage: string;
  }>();

  for (const t of traces) {
    const existing = map.get(t.conversationId);
    if (!existing) {
      map.set(t.conversationId, {
        count: 1,
        first: t.timestamp,
        last: t.timestamp,
        worker: t.metadata?.workerSource || t.metadata?.workerId || t.source,
        userMessage: t.metadata?.userMessage || '',
      });
    } else {
      existing.count++;
      if (t.timestamp < existing.first) existing.first = t.timestamp;
      if (t.timestamp > existing.last) existing.last = t.timestamp;
      if (t.metadata?.userMessage) existing.userMessage = t.metadata.userMessage;
      if (t.metadata?.workerName) existing.worker = t.metadata.workerName;
    }
  }

  return Array.from(map.entries())
    .map(([id, data]) => ({
      conversationId: id,
      traceCount: data.count,
      firstTimestamp: data.first,
      lastTimestamp: data.last,
      worker: data.worker,
      userMessage: data.userMessage,
    }))
    .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())
    .slice(0, limit);
}

export function getReasoningStats(): {
  totalTraces: number;
  totalConversations: number;
  byType: Record<string, number>;
  avgDurationMs: number;
  recentErrors: number;
} {
  const byType: Record<string, number> = {};
  let totalDuration = 0;
  let durationCount = 0;
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  let recentErrors = 0;

  for (const t of traces) {
    byType[t.type] = (byType[t.type] || 0) + 1;
    if (t.durationMs) {
      totalDuration += t.durationMs;
      durationCount++;
    }
    if (t.type === 'error' && new Date(t.timestamp).getTime() >= fiveMinAgo) {
      recentErrors++;
    }
  }

  const conversationIds = new Set(traces.map(t => t.conversationId));

  return {
    totalTraces: traces.length,
    totalConversations: conversationIds.size,
    byType,
    avgDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
    recentErrors,
  };
}

// ── Helpers ──

const SENSITIVE = /password|secret|token|api_key|credential|authorization|bearer|finnhub|account_number/i;

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    result[key] = SENSITIVE.test(key) ? '[REDACTED]' : value;
  }
  return result;
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.substring(0, maxLen) + '…' : s;
}
