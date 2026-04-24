import { describe, it, expect } from 'vitest';
import { parseMcpArray, DigitalWorkerError } from '../types';

describe('parseMcpArray', () => {
  it('should handle array input directly', () => {
    const input = [{ Ticker: 'AAPL' }, { Ticker: 'MSFT' }];
    expect(parseMcpArray(input)).toEqual(input);
  });

  it('should handle JSON string input', () => {
    const arr = [{ Ticker: 'GOOG' }];
    const input = JSON.stringify(arr);
    expect(parseMcpArray(input)).toEqual(arr);
  });

  it('should handle regex-extracted JSON from MCP response text', () => {
    const input = 'Here is the data: [{"Ticker":"AAPL"},{"Ticker":"MSFT"}] and some trailing text';
    expect(parseMcpArray(input)).toEqual([{ Ticker: 'AAPL' }, { Ticker: 'MSFT' }]);
  });

  it('should return empty array on invalid input', () => {
    expect(parseMcpArray(null)).toEqual([]);
    expect(parseMcpArray(undefined)).toEqual([]);
    expect(parseMcpArray(42)).toEqual([]);
    expect(parseMcpArray({})).toEqual([]);
  });

  it('should return empty array on string with no JSON array', () => {
    expect(parseMcpArray('no json here')).toEqual([]);
  });

  it('should return empty array on malformed JSON string', () => {
    expect(parseMcpArray('[invalid json')).toEqual([]);
  });

  it('should handle empty array input', () => {
    expect(parseMcpArray([])).toEqual([]);
  });

  it('should handle empty JSON array string', () => {
    expect(parseMcpArray('[]')).toEqual([]);
  });

  it('should extract nested array from complex MCP text', () => {
    const mcpText = `Result from tool call:
    Content: [{"Ticker":"BRK.B","Shares":100}]
    End of result`;
    const result = parseMcpArray(mcpText);
    expect(result).toEqual([{ Ticker: 'BRK.B', Shares: 100 }]);
  });
});

describe('DigitalWorkerError', () => {
  it('should have correct name', () => {
    const err = new DigitalWorkerError('ERR_001', 'Test error');
    expect(err.name).toBe('DigitalWorkerError');
  });

  it('should have correct code and message', () => {
    const err = new DigitalWorkerError('TIMEOUT', 'Request timed out');
    expect(err.code).toBe('TIMEOUT');
    expect(err.message).toBe('Request timed out');
  });

  it('should include optional context', () => {
    const ctx = { ticker: 'AAPL', attempt: 3 };
    const err = new DigitalWorkerError('RETRY_EXHAUSTED', 'Retries exhausted', ctx);
    expect(err.context).toEqual(ctx);
  });

  it('should be an instance of Error', () => {
    const err = new DigitalWorkerError('ERR', 'msg');
    expect(err).toBeInstanceOf(Error);
  });

  it('should have context undefined when not provided', () => {
    const err = new DigitalWorkerError('ERR', 'msg');
    expect(err.context).toBeUndefined();
  });
});
