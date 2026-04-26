import { describe, it, expect } from 'vitest';
import {
  startConversation, logIntent, logRouting, logThinking,
  logToolCall, logToolResult, logOutcome, logError, logMarketSignal,
  getTraces, getConversations, getReasoningStats,
} from '../reasoning-trace';

describe('reasoning-trace', () => {
  it('creates a conversation ID', () => {
    const id = startConversation();
    expect(id).toMatch(/^conv-/);
  });

  it('logs intent classification', () => {
    const convId = startConversation();
    const trace = logIntent(convId, 'Show my portfolio', 'market-researcher', 'Market Researcher', 'high', 'matched keyword');
    expect(trace.type).toBe('intent');
    expect(trace.conversationId).toBe(convId);
    expect(trace.confidence).toBe('high');
  });

  it('logs routing decisions', () => {
    const convId = startConversation();
    const trace = logRouting(convId, 'command-center', 'risk-analyst', 'Matched risk domain');
    expect(trace.type).toBe('routing');
  });

  it('logs thinking traces', () => {
    const convId = startConversation();
    const trace = logThinking(convId, 'risk-analyst', 'Analyzing concentration risk in tech sector');
    expect(trace.type).toBe('llm-thinking');
  });

  it('logs tool calls with sanitized args', () => {
    const convId = startConversation();
    const trace = logToolCall(convId, 'trader', 'simulate_trade', {
      symbol: 'AAPL',
      quantity: 100,
      finnhub_key: 'should-be-redacted',
    });
    expect(trace.detail).toContain('[REDACTED]');
    expect(trace.detail).not.toContain('should-be-redacted');
    expect(trace.detail).toContain('AAPL');
  });

  it('logs outcomes with duration', () => {
    const convId = startConversation();
    const trace = logOutcome(convId, 'trader', 'Trade simulation complete: Buy 100 AAPL at $185', 1500);
    expect(trace.durationMs).toBe(1500);
  });

  it('logs market signals (PM-specific)', () => {
    const convId = startConversation();
    const trace = logMarketSignal(convId, 'price_move', ['AAPL', 'MSFT'], 'Tech sector down 3%', 'high');
    expect(trace.type).toBe('market-signal');
    expect(trace.marketContext?.symbols).toContain('AAPL');
    expect(trace.confidence).toBe('high');
  });

  it('retrieves traces by conversation', () => {
    const convId = startConversation();
    logIntent(convId, 'test', 'w1', 'Worker 1', 'high', 'test');
    logOutcome(convId, 'w1', 'done', 100);

    const traces = getTraces({ conversationId: convId });
    expect(traces.length).toBeGreaterThanOrEqual(2);
    expect(traces.every(t => t.conversationId === convId)).toBe(true);
  });

  it('returns reasoning stats', () => {
    const stats = getReasoningStats();
    expect(stats.totalTraces).toBeGreaterThan(0);
    expect(stats.byType).toBeDefined();
  });

  it('returns conversations list', () => {
    const convs = getConversations();
    expect(convs.length).toBeGreaterThan(0);
    expect(convs[0].conversationId).toBeDefined();
    expect(convs[0].traceCount).toBeGreaterThan(0);
  });

  it('logs errors', () => {
    const convId = startConversation();
    const trace = logError(convId, 'risk-analyst', 'Finnhub API timeout after 10s');
    expect(trace.type).toBe('error');
    expect(trace.detail).toContain('Finnhub');
  });
});
