import { describe, it, expect } from 'vitest';
import { classifyIntent, getWorkerById } from '../worker-registry';

describe('worker-registry', () => {
  describe('classifyIntent', () => {
    it('routes market data queries to Market Researcher', () => {
      const result = classifyIntent('What is the current price of AAPL?');
      expect(result.worker.id).toBe('market-researcher');
    });

    it('routes news queries to Market Researcher', () => {
      const result = classifyIntent('Show me the latest news on Microsoft');
      expect(result.worker.id).toBe('market-researcher');
    });

    it('routes analyst consensus to Market Researcher', () => {
      const result = classifyIntent('What is the analyst consensus on Tesla stock?');
      expect(result.worker.id).toBe('market-researcher');
    });

    it('routes deep dive research to Market Researcher', () => {
      const result = classifyIntent("Give me a deep dive on Coventry BS's lending mix");
      expect(result.worker.id).toBe('market-researcher');
    });

    it('routes risk queries to Risk Analyst', () => {
      const result = classifyIntent('Run a stress test on the portfolio for a rate shock');
      expect(result.worker.id).toBe('risk-analyst');
    });

    it('routes concentration risk to Risk Analyst', () => {
      const result = classifyIntent('What is our concentration exposure to tech?');
      expect(result.worker.id).toBe('risk-analyst');
    });

    it('routes trim decision to Command Center (cross-domain: risk + trade)', () => {
      const result = classifyIntent('Should we trim our AAPL position?');
      // "trim" + "position" match both Risk Analyst and Trader → cross-domain
      expect(result.worker.id).toBe('command-center');
      expect(result.confidence).toBe('medium');
    });

    it('routes scenario analysis to Risk Analyst', () => {
      const result = classifyIntent('What is the worst case scenario for our portfolio?');
      expect(result.worker.id).toBe('risk-analyst');
    });

    it('routes trade requests to Trader', () => {
      const result = classifyIntent('Buy 1000 shares of MSFT');
      expect(result.worker.id).toBe('trader');
    });

    it('routes simulate trade to Trader', () => {
      const result = classifyIntent('Simulate selling our entire position in TSLA');
      expect(result.worker.id).toBe('trader');
    });

    it('routes rebalance to Trader', () => {
      const result = classifyIntent('Rebalance the portfolio to match the benchmark');
      expect(result.worker.id).toBe('trader');
    });

    it('routes compliance to Compliance Officer', () => {
      const result = classifyIntent('Check compliance limits for the portfolio');
      expect(result.worker.id).toBe('compliance-officer');
    });

    it('routes regulatory queries to Compliance Officer', () => {
      const result = classifyIntent('Are we compliant with the regulatory guidelines?');
      expect(result.worker.id).toBe('compliance-officer');
    });

    it('routes client queries to Client Relationship', () => {
      const result = classifyIntent('Prepare for the client meeting next week');
      expect(result.worker.id).toBe('client-relationship');
    });

    it('routes CRM queries to Client Relationship', () => {
      const result = classifyIntent('Show me the CRM pipeline opportunities');
      expect(result.worker.id).toBe('client-relationship');
    });

    it('routes email drafting to Client Relationship', () => {
      const result = classifyIntent('Draft an email to the client about portfolio performance');
      expect(result.worker.id).toBe('client-relationship');
    });

    it('routes cross-domain to Command Center', () => {
      const result = classifyIntent('What are the risk and compliance implications of buying AAPL?');
      expect(result.worker.id).toBe('command-center');
      expect(result.confidence).toBe('medium');
    });

    it('routes general queries to Command Center', () => {
      const result = classifyIntent('Hello, how are you?');
      expect(result.worker.id).toBe('command-center');
      expect(result.confidence).toBe('low');
    });

    it('routes portfolio overview to Command Center', () => {
      const result = classifyIntent('Give me a portfolio overview and summary');
      expect(result.worker.id).toBe('command-center');
    });

    it('routes morning briefing to Command Center', () => {
      const result = classifyIntent('Give me my morning briefing');
      expect(result.worker.id).toBe('command-center');
    });
  });

  describe('getWorkerById', () => {
    it('finds market-researcher', () => {
      const w = getWorkerById('market-researcher');
      expect(w).toBeDefined();
      expect(w!.name).toBe('Market Researcher');
    });

    it('finds command-center', () => {
      const w = getWorkerById('command-center');
      expect(w).toBeDefined();
      expect(w!.name).toBe('Command Center');
    });

    it('returns undefined for unknown', () => {
      expect(getWorkerById('unknown-worker')).toBeUndefined();
    });
  });
});
