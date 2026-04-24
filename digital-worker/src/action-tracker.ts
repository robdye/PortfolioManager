// Portfolio Manager Digital Worker — Action Tracker
//
// Closes the loop on recommendations. Every time the digital worker
// recommends something (trim, add, review, schedule), it gets tracked
// here. The tracker monitors whether the PM acted on it, and escalates
// if recommendations go stale.
//
// Lifecycle: OPEN → ACKNOWLEDGED → ACTED | DISMISSED → OUTCOME_RECORDED
// Escalation: OPEN for >4h → ESCALATED (re-sent with urgency bump)

import { saveMemory, loadMemory } from './persistent-memory';

// ── Types ───────────────────────────────────────────────────────────

export type ActionStatus = 'open' | 'acknowledged' | 'acted' | 'dismissed' | 'deferred' | 'escalated' | 'expired';
export type ActionType = 'trim' | 'add' | 'exit' | 'review' | 'schedule_meeting' | 'update_crm' | 'investigate' | 'hold' | 'rebalance' | 'hedge';

export interface TrackedAction {
  id: string;
  symbol: string;
  company: string;
  actionType: ActionType;
  recommendation: string;    // Human-readable: "Trim MSFT by 20% — PE too high"
  rationale: string;         // Why we recommended this
  status: ActionStatus;
  severity: 'critical' | 'high' | 'medium' | 'low';
  createdAt: number;
  updatedAt: number;
  acknowledgedAt?: number;
  actedAt?: number;
  deferredUntil?: number;
  escalationCount: number;
  lastEscalatedAt?: number;
  source: string;            // Which workflow created this: 'decision-engine', 'challenge-monitor', etc.
  // Outcome tracking
  priceAtCreation?: number;
  priceAtAction?: number;
  priceAtOutcome?: number;
  outcomeNote?: string;
  outcomeRecordedAt?: number;
}

export interface ActionSummary {
  total: number;
  open: number;
  acknowledged: number;
  acted: number;
  dismissed: number;
  deferred: number;
  escalated: number;
  expired: number;
  avgTimeToActMs: number;
  hitRate: number; // % of acted recommendations where outcome was favorable
}

// ── In-memory cache ─────────────────────────────────────────────────

const actions = new Map<string, TrackedAction>();
let loaded = false;
let loadPromise: Promise<void> | null = null;
let actionCounter = 0;

// ── Persistence ─────────────────────────────────────────────────────

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const data = await loadMemory('action_tracker', 'actions');
      if (data && Array.isArray((data as any).items)) {
        for (const a of (data as any).items as TrackedAction[]) {
          actions.set(a.id, a);
        }
        actionCounter = (data as any).counter || actions.size;
        console.log(`[ActionTracker] Restored ${actions.size} tracked actions`);
      }
    } catch (err) {
      console.warn('[ActionTracker] Failed to load, starting fresh:', (err as Error).message);
    } finally {
      loaded = true;
      loadPromise = null;
    }
  })();
  return loadPromise;
}

async function persist(): Promise<void> {
  // Keep only last 200 actions (prune expired/old)
  const items = Array.from(actions.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 200);
  actions.clear();
  for (const a of items) actions.set(a.id, a);
  await saveMemory('action_tracker', 'actions', { items, counter: actionCounter }).catch((err) => { console.error('[ActionTracker] Failed to persist:', (err as Error).message); });
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Create a new tracked action from a recommendation.
 */
export async function createAction(params: {
  symbol: string;
  company: string;
  actionType: ActionType;
  recommendation: string;
  rationale: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  source: string;
  priceAtCreation?: number;
}): Promise<TrackedAction> {
  await ensureLoaded();
  actionCounter++;
  const id = `ACT-${Date.now().toString(36)}-${actionCounter}`;
  const action: TrackedAction = {
    id,
    symbol: params.symbol,
    company: params.company,
    actionType: params.actionType,
    recommendation: params.recommendation,
    rationale: params.rationale,
    status: 'open',
    severity: params.severity,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    escalationCount: 0,
    source: params.source,
    priceAtCreation: params.priceAtCreation,
  };
  actions.set(id, action);
  await persist();
  console.log(`[ActionTracker] Created ${id}: ${params.actionType} ${params.symbol} — ${params.recommendation}`);
  return action;
}

/**
 * PM acknowledges a recommendation (they've seen it).
 */
export async function acknowledgeAction(id: string): Promise<TrackedAction | null> {
  await ensureLoaded();
  const action = actions.get(id);
  if (!action) return null;
  action.status = 'acknowledged';
  action.acknowledgedAt = Date.now();
  action.updatedAt = Date.now();
  await persist();
  return action;
}

/**
 * PM acted on the recommendation.
 */
export async function markActed(id: string, priceAtAction?: number): Promise<TrackedAction | null> {
  await ensureLoaded();
  const action = actions.get(id);
  if (!action) return null;
  action.status = 'acted';
  action.actedAt = Date.now();
  action.updatedAt = Date.now();
  if (priceAtAction !== undefined) action.priceAtAction = priceAtAction;
  await persist();
  return action;
}

/**
 * PM dismissed the recommendation (decided not to act).
 */
export async function dismissAction(id: string, reason?: string): Promise<TrackedAction | null> {
  await ensureLoaded();
  const action = actions.get(id);
  if (!action) return null;
  action.status = 'dismissed';
  action.updatedAt = Date.now();
  if (reason) action.outcomeNote = `Dismissed: ${reason}`;
  await persist();
  return action;
}

/**
 * PM defers action until later.
 */
export async function deferAction(id: string, untilMs?: number): Promise<TrackedAction | null> {
  await ensureLoaded();
  const action = actions.get(id);
  if (!action) return null;
  action.status = 'deferred';
  action.deferredUntil = untilMs || Date.now() + 24 * 60 * 60 * 1000; // default: defer 24h
  action.updatedAt = Date.now();
  await persist();
  return action;
}

/**
 * Record the outcome of an action taken (for hit-rate tracking).
 */
export async function recordOutcome(id: string, priceAtOutcome: number, note: string): Promise<TrackedAction | null> {
  await ensureLoaded();
  const action = actions.get(id);
  if (!action) return null;
  action.priceAtOutcome = priceAtOutcome;
  action.outcomeNote = note;
  action.outcomeRecordedAt = Date.now();
  action.updatedAt = Date.now();
  await persist();
  return action;
}

// ── Escalation ──────────────────────────────────────────────────────

const ESCALATION_THRESHOLDS_MS: Record<string, number> = {
  critical: 2 * 60 * 60 * 1000,    // 2 hours
  high: 4 * 60 * 60 * 1000,        // 4 hours
  medium: 8 * 60 * 60 * 1000,      // 8 hours
  low: 24 * 60 * 60 * 1000,        // 24 hours
};

const MAX_ESCALATIONS = 3;

/**
 * Check for stale actions that need escalation.
 * Called from the workday execution cycle.
 */
export async function checkEscalations(): Promise<TrackedAction[]> {
  await ensureLoaded();
  const now = Date.now();
  const escalated: TrackedAction[] = [];

  for (const action of actions.values()) {
    // Only escalate open or deferred actions
    if (action.status !== 'open' && action.status !== 'deferred') continue;

    // Check if deferred and not yet due
    if (action.status === 'deferred' && action.deferredUntil && now < action.deferredUntil) continue;
    // Un-defer if deferred and past due date
    if (action.status === 'deferred' && action.deferredUntil && now >= action.deferredUntil) {
      action.status = 'open';
      action.updatedAt = now;
    }

    // Check escalation threshold
    const threshold = ESCALATION_THRESHOLDS_MS[action.severity] || ESCALATION_THRESHOLDS_MS.medium;
    const lastCheck = action.lastEscalatedAt || action.createdAt;
    if (now - lastCheck < threshold) continue;
    if (action.escalationCount >= MAX_ESCALATIONS) {
      action.status = 'expired';
      action.updatedAt = now;
      continue;
    }

    // Escalate
    action.status = 'escalated';
    action.escalationCount++;
    action.lastEscalatedAt = now;
    action.updatedAt = now;
    // Bump severity if not already critical
    if (action.severity === 'low') action.severity = 'medium';
    else if (action.severity === 'medium') action.severity = 'high';
    escalated.push(action);
  }

  if (escalated.length > 0) {
    await persist();
    console.log(`[ActionTracker] ${escalated.length} actions escalated`);
  }
  return escalated;
}

// ── Query ───────────────────────────────────────────────────────────

/**
 * Get all open/escalated actions (things requiring PM attention).
 */
export async function getPendingActions(): Promise<TrackedAction[]> {
  await ensureLoaded();
  return Array.from(actions.values()).filter(
    a => a.status === 'open' || a.status === 'escalated' || a.status === 'deferred'
  ).sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity] || b.createdAt - a.createdAt;
  });
}

/**
 * Get actions for a specific symbol.
 */
export async function getActionsForSymbol(symbol: string): Promise<TrackedAction[]> {
  await ensureLoaded();
  return Array.from(actions.values())
    .filter(a => a.symbol.toUpperCase() === symbol.toUpperCase())
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Check if there's already an open recommendation for this symbol+type.
 * Prevents duplicate recommendations.
 */
export async function hasOpenAction(symbol: string, actionType: ActionType): Promise<boolean> {
  await ensureLoaded();
  return Array.from(actions.values()).some(
    a => a.symbol.toUpperCase() === symbol.toUpperCase()
      && a.actionType === actionType
      && (a.status === 'open' || a.status === 'escalated' || a.status === 'acknowledged')
  );
}

/**
 * Get overall summary statistics.
 */
export async function getActionSummary(): Promise<ActionSummary> {
  await ensureLoaded();
  const all = Array.from(actions.values());
  const acted = all.filter(a => a.status === 'acted');
  const withOutcome = acted.filter(a => a.priceAtOutcome !== undefined && a.priceAtCreation !== undefined);

  // Calculate hit rate — was the recommendation directionally correct?
  let hits = 0;
  for (const a of withOutcome) {
    const recWasTrim = ['trim', 'exit', 'hedge'].includes(a.actionType);
    const priceFell = (a.priceAtOutcome! < a.priceAtCreation!);
    if ((recWasTrim && priceFell) || (!recWasTrim && !priceFell)) hits++;
  }

  // Average time-to-act
  const timesToAct = acted.filter(a => a.actedAt && a.createdAt).map(a => a.actedAt! - a.createdAt);
  const avgTimeToAct = timesToAct.length > 0 ? timesToAct.reduce((s, t) => s + t, 0) / timesToAct.length : 0;

  return {
    total: all.length,
    open: all.filter(a => a.status === 'open').length,
    acknowledged: all.filter(a => a.status === 'acknowledged').length,
    acted: acted.length,
    dismissed: all.filter(a => a.status === 'dismissed').length,
    deferred: all.filter(a => a.status === 'deferred').length,
    escalated: all.filter(a => a.status === 'escalated').length,
    expired: all.filter(a => a.status === 'expired').length,
    avgTimeToActMs: avgTimeToAct,
    hitRate: withOutcome.length > 0 ? (hits / withOutcome.length) * 100 : 0,
  };
}

/**
 * Get a specific action by ID.
 */
export async function getAction(id: string): Promise<TrackedAction | null> {
  await ensureLoaded();
  return actions.get(id) || null;
}

/**
 * Get recent actions for display (last N).
 */
export async function getRecentActions(limit: number = 20): Promise<TrackedAction[]> {
  await ensureLoaded();
  return Array.from(actions.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}
