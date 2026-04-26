// Portfolio Manager — Approval Queue with Adaptive Cards
// Manages pending WRITE/NOTIFY operations that require human confirmation.
// Presents Adaptive Cards in Teams with Approve/Reject buttons.

import { classifyTool, type HitlClassification } from './hitl';

// ── Pending Action ──

export interface PendingAction {
  id: string;
  workerId: string;
  workerName: string;
  toolName: string;
  classification: HitlClassification;
  parameters: Record<string, unknown>;
  userId: string;
  displayName: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
}

// ── In-memory queue (durable version uses Table Storage) ──

const pendingActions = new Map<string, PendingAction>();
const ACTION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
export const CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000;
export const MAX_QUEUE_SIZE = 500;

// ── Queue Management ──

/**
 * Queue a write/notify action for approval.
 * Returns the pending action ID and the Adaptive Card to send to the user.
 */
export function queueAction(
  workerId: string,
  workerName: string,
  toolName: string,
  parameters: Record<string, unknown>,
  userId: string,
  displayName: string,
): { actionId: string; card: any } {
  const classification = classifyTool(toolName);
  const actionId = `action-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const action: PendingAction = {
    id: actionId,
    workerId,
    workerName,
    toolName,
    classification,
    parameters,
    userId,
    displayName,
    status: 'pending',
    createdAt: new Date(),
  };

  pendingActions.set(actionId, action);
  cleanupExpired();

  const card = buildApprovalCard(action);
  return { actionId, card };
}

/**
 * Resolve a pending action (approve or reject).
 */
export function resolveAction(
  actionId: string,
  decision: 'approved' | 'rejected',
  resolvedBy: string,
): PendingAction | null {
  const action = pendingActions.get(actionId);
  if (!action || action.status !== 'pending') return null;

  action.status = decision;
  action.resolvedAt = new Date();
  action.resolvedBy = resolvedBy;

  console.log(`[ApprovalQueue] Action ${actionId} ${decision} by ${resolvedBy}: ${action.toolName}`);
  return action;
}

/**
 * Get a pending action by ID.
 */
export function getAction(actionId: string): PendingAction | null {
  return pendingActions.get(actionId) || null;
}

/**
 * Get all pending actions for a user.
 */
export function getUserPendingActions(userId: string): PendingAction[] {
  return Array.from(pendingActions.values())
    .filter(a => a.userId === userId && a.status === 'pending');
}

/**
 * Get queue summary.
 */
export function getQueueSummary(): {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
} {
  const all = Array.from(pendingActions.values());
  return {
    total: all.length,
    pending: all.filter(a => a.status === 'pending').length,
    approved: all.filter(a => a.status === 'approved').length,
    rejected: all.filter(a => a.status === 'rejected').length,
    expired: all.filter(a => a.status === 'expired').length,
  };
}

// ── Cleanup ──

function cleanupExpired(): void {
  const now = Date.now();
  for (const [id, action] of pendingActions) {
    if (action.status === 'pending' && now - action.createdAt.getTime() > ACTION_EXPIRY_MS) {
      action.status = 'expired';
      console.log(`[ApprovalQueue] Action ${id} expired: ${action.toolName}`);
    }
    if (action.status !== 'pending' && now - action.createdAt.getTime() > CLEANUP_AFTER_MS) {
      pendingActions.delete(id);
    }
  }
  if (pendingActions.size > MAX_QUEUE_SIZE) {
    const sorted = [...pendingActions.entries()].sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime());
    for (let i = 0; i < sorted.length - MAX_QUEUE_SIZE; i++) {
      pendingActions.delete(sorted[i][0]);
    }
  }
}

// ── Adaptive Card Builder ──

function buildApprovalCard(action: PendingAction): any {
  const icon = action.classification.level === 'notify' ? '📧' : '✏️';
  const riskColor = action.classification.level === 'notify' ? 'warning' : 'attention';

  const paramFacts = Object.entries(action.parameters)
    .filter(([_, v]) => v !== undefined && v !== null)
    .slice(0, 8)
    .map(([key, value]) => ({
      title: key,
      value: typeof value === 'string' ? value.substring(0, 150) : JSON.stringify(value).substring(0, 150),
    }));

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'ColumnSet',
        columns: [
          {
            type: 'Column',
            width: 'auto',
            items: [{ type: 'TextBlock', text: icon, size: 'Large' }],
          },
          {
            type: 'Column',
            width: 'stretch',
            items: [
              { type: 'TextBlock', text: 'Confirmation Required', weight: 'Bolder', size: 'Medium' },
              {
                type: 'TextBlock',
                text: `${action.workerName} wants to execute a ${action.classification.level.toUpperCase()} operation`,
                spacing: 'None',
                isSubtle: true,
                wrap: true,
              },
            ],
          },
        ],
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Action', value: action.toolName },
          { title: 'Worker', value: action.workerName },
          { title: 'Risk Level', value: action.classification.level.toUpperCase() },
          { title: 'Requested by', value: action.displayName },
          ...paramFacts,
        ],
      },
      {
        type: 'TextBlock',
        text: action.classification.description,
        wrap: true,
        spacing: 'Medium',
        color: riskColor,
      },
    ],
    actions: [
      {
        type: 'Action.Submit',
        title: '✅ Approve',
        style: 'positive',
        data: { action: 'approve', actionId: action.id },
      },
      {
        type: 'Action.Submit',
        title: '❌ Reject',
        style: 'destructive',
        data: { action: 'reject', actionId: action.id },
      },
    ],
  };
}

/**
 * Build a result card showing the outcome of an approval decision.
 */
export function buildResultCard(action: PendingAction): any {
  const isApproved = action.status === 'approved';
  const icon = isApproved ? '✅' : '❌';
  const color = isApproved ? 'good' : 'attention';

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: `${icon} Action ${action.status.toUpperCase()}`,
        weight: 'Bolder',
        size: 'Medium',
        color,
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Action', value: action.toolName },
          { title: 'Worker', value: action.workerName },
          { title: 'Decision', value: action.status },
          { title: 'Decided by', value: action.resolvedBy || 'Unknown' },
          { title: 'Decided at', value: action.resolvedAt?.toISOString() || 'N/A' },
        ],
      },
    ],
  };
}
