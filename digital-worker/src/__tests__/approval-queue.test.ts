import { describe, it, expect } from 'vitest';
import { queueAction, resolveAction, getAction, getQueueSummary, MAX_QUEUE_SIZE } from '../approval-queue';

describe('queueAction', () => {
  it('creates a pending action with approval card', () => {
    const { actionId, card } = queueAction(
      'risk-analyst', 'Risk Analyst',
      'create_order', { symbol: 'AAPL', quantity: 100 },
      'user1', 'Test User'
    );
    expect(actionId).toBeTruthy();
    expect(card).toBeDefined();
    expect(card.type).toBe('AdaptiveCard');

    const action = getAction(actionId);
    expect(action).not.toBeNull();
    expect(action!.status).toBe('pending');
    expect(action!.toolName).toBe('create_order');
  });
});

describe('resolveAction', () => {
  it('approves a pending action', () => {
    const { actionId } = queueAction(
      'trader', 'Trader',
      'update_holding', { symbol: 'MSFT', quantity: 50 },
      'user2', 'Approver'
    );
    const resolved = resolveAction(actionId, 'approved', 'admin1');
    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe('approved');
    expect(resolved!.resolvedBy).toBe('admin1');
  });

  it('rejects a pending action', () => {
    const { actionId } = queueAction(
      'trader', 'Trader',
      'close_position', { symbol: 'TSLA' },
      'user3', 'Requester'
    );
    const resolved = resolveAction(actionId, 'rejected', 'admin2');
    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe('rejected');
  });

  it('returns null for unknown action', () => {
    expect(resolveAction('nonexistent', 'approved', 'admin')).toBeNull();
  });
});

describe('getQueueSummary', () => {
  it('returns summary with correct counts', () => {
    const summary = getQueueSummary();
    expect(summary.total).toBeGreaterThan(0);
    expect(typeof summary.pending).toBe('number');
    expect(typeof summary.approved).toBe('number');
    expect(typeof summary.rejected).toBe('number');
  });
});

describe('MAX_QUEUE_SIZE', () => {
  it('is set to 500', () => {
    expect(MAX_QUEUE_SIZE).toBe(500);
  });
});
