import { describe, it, expect } from 'vitest';
import { classifyTool, batchRequiresConfirmation, getWorkerRiskSummary } from '../hitl';

describe('classifyTool', () => {
  it('classifies get_ tools as read', () => {
    const result = classifyTool('get_quote');
    expect(result.level).toBe('read');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('classifies read tools correctly', () => {
    expect(classifyTool('get_quote').level).toBe('read');
    expect(classifyTool('get_portfolio').level).toBe('read');
    expect(classifyTool('search_holdings').level).toBe('read');
    expect(classifyTool('get_analyst_consensus').level).toBe('read');
  });

  it('classifies list_ tools as read', () => {
    const result = classifyTool('list_positions');
    expect(result.level).toBe('read');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('classifies create_ tools as write', () => {
    const result = classifyTool('create_order');
    expect(result.level).toBe('write');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('classifies update_ tools as write', () => {
    const result = classifyTool('update_holding');
    expect(result.level).toBe('write');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('classifies close_position as write', () => {
    const result = classifyTool('close_position');
    expect(result.level).toBe('write');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('classifies simulate_trade as write', () => {
    const result = classifyTool('simulate_trade');
    expect(result.level).toBe('write');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('classifies rebalance as write', () => {
    const result = classifyTool('rebalance');
    expect(result.level).toBe('write');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('classifies send_alert as notify', () => {
    const result = classifyTool('send_alert');
    expect(result.level).toBe('notify');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('classifies send_email as notify', () => {
    const result = classifyTool('send_email');
    expect(result.level).toBe('notify');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('classifies post_to_channel as notify', () => {
    const result = classifyTool('post_to_channel');
    expect(result.level).toBe('notify');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('read tools do not require confirmation', () => {
    expect(classifyTool('get_quote').requiresConfirmation).toBe(false);
    expect(classifyTool('get_portfolio').requiresConfirmation).toBe(false);
  });

  it('defaults unknown tools to read (safe fallthrough)', () => {
    const result = classifyTool('some_unknown_tool');
    expect(result.level).toBe('read');
    expect(result.requiresConfirmation).toBe(false);
  });
});

describe('batchRequiresConfirmation', () => {
  it('returns false for read-only batch', () => {
    expect(batchRequiresConfirmation(['get_quote', 'get_portfolio'])).toBe(false);
  });

  it('returns true if any tool is write', () => {
    expect(batchRequiresConfirmation(['get_quote', 'create_order'])).toBe(true);
  });

  it('returns true if any tool is notify', () => {
    expect(batchRequiresConfirmation(['get_quote', 'send_alert'])).toBe(true);
  });
});

describe('getWorkerRiskSummary', () => {
  it('categorizes tools correctly', () => {
    const summary = getWorkerRiskSummary(['get_quote', 'create_order', 'send_alert', 'get_portfolio']);
    expect(summary.reads).toContain('get_quote');
    expect(summary.reads).toContain('get_portfolio');
    expect(summary.writes).toContain('create_order');
    expect(summary.notifies).toContain('send_alert');
  });
});
