import { describe, it, expect } from 'vitest';
import { DELEGATION_RULES, canDelegate, getDelegationTargets } from '../worker-delegation';

describe('worker-delegation', () => {
  describe('DELEGATION_RULES', () => {
    it('has 8 delegation rules', () => {
      expect(DELEGATION_RULES.length).toBe(8);
    });

    it('defines researcher → risk-analyst delegation', () => {
      const rule = DELEGATION_RULES.find(
        r => r.sourceWorker === 'market-researcher' && r.targetWorker === 'risk-analyst'
      );
      expect(rule).toBeDefined();
      expect(rule!.trigger).toContain('material risk');
    });

    it('defines trader → compliance-officer delegation', () => {
      const rule = DELEGATION_RULES.find(
        r => r.sourceWorker === 'trader' && r.targetWorker === 'compliance-officer'
      );
      expect(rule).toBeDefined();
      expect(rule!.trigger).toContain('compliance');
    });

    it('defines compliance-officer → trader (approved) delegation', () => {
      const rule = DELEGATION_RULES.find(
        r => r.sourceWorker === 'compliance-officer' && r.targetWorker === 'trader'
      );
      expect(rule).toBeDefined();
      expect(rule!.trigger).toContain('approved');
    });

    it('generates correct prompt templates', () => {
      const rule = DELEGATION_RULES.find(
        r => r.sourceWorker === 'risk-analyst' && r.targetWorker === 'trader'
      );
      const prompt = rule!.promptTemplate('AAPL risk acceptable, opportunity to buy');
      expect(prompt).toContain('[DELEGATION from Risk Analyst]');
      expect(prompt).toContain('AAPL risk acceptable');
    });
  });

  describe('canDelegate', () => {
    it('returns true for valid delegation paths', () => {
      expect(canDelegate('market-researcher', 'risk-analyst')).toBe(true);
      expect(canDelegate('trader', 'compliance-officer')).toBe(true);
      expect(canDelegate('compliance-officer', 'trader')).toBe(true);
    });

    it('returns false for invalid delegation paths', () => {
      expect(canDelegate('compliance-officer', 'market-researcher')).toBe(false);
      expect(canDelegate('command-center', 'trader')).toBe(false);
    });
  });

  describe('getDelegationTargets', () => {
    it('returns targets for market-researcher', () => {
      const targets = getDelegationTargets('market-researcher');
      expect(targets.length).toBe(2);
      expect(targets.map(t => t.targetWorker)).toContain('risk-analyst');
      expect(targets.map(t => t.targetWorker)).toContain('trader');
    });

    it('returns targets for trader', () => {
      const targets = getDelegationTargets('trader');
      expect(targets.length).toBe(2);
      expect(targets.map(t => t.targetWorker)).toContain('compliance-officer');
      expect(targets.map(t => t.targetWorker)).toContain('client-relationship');
    });

    it('returns empty for command-center', () => {
      const targets = getDelegationTargets('command-center');
      expect(targets.length).toBe(0);
    });
  });
});
