import { describe, it, expect } from 'vitest';
import {
  getEscalationLog,
  getActiveEscalations,
  createStaleDecisionEscalation,
  MAX_ESCALATION_LOG,
} from '../escalation-chain';

describe('escalation-chain', () => {
  describe('createStaleDecisionEscalation', () => {
    it('creates command-center level for < 4 hours', () => {
      const event = createStaleDecisionEscalation('relative-value-shift', 'risk-analyst', 2);
      expect(event.currentLevel).toBe('command-center');
      expect(event.originalWorkerId).toBe('risk-analyst');
      expect(event.reason).toContain('2 hours');
    });

    it('creates human level for > 4 hours', () => {
      const event = createStaleDecisionEscalation('earnings-miss', 'market-researcher', 6);
      expect(event.currentLevel).toBe('human');
      expect(event.reason).toContain('6 hours');
    });

    it('includes signal type in reason', () => {
      const event = createStaleDecisionEscalation('concentration-breach', 'compliance-officer', 1);
      expect(event.reason).toContain('concentration-breach');
    });
  });

  describe('escalation log', () => {
    it('tracks escalations in log', () => {
      const before = getEscalationLog().length;
      createStaleDecisionEscalation('test-signal', 'trader', 3);
      expect(getEscalationLog().length).toBe(before + 1);
    });

    it('returns active (unresolved) escalations', () => {
      createStaleDecisionEscalation('active-test', 'risk-analyst', 1);
      const active = getActiveEscalations();
      expect(active.some(e => e.reason.includes('active-test'))).toBe(true);
    });

    it('respects max log size', () => {
      expect(MAX_ESCALATION_LOG).toBe(500);
    });
  });
});
