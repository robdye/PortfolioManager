import { describe, it, expect } from 'vitest';
import { escapeOData, validateTicker } from '../dataverse-client';

describe('escapeOData', () => {
  it('should escape single quotes by doubling them', () => {
    expect(escapeOData("O'Reilly")).toBe("O''Reilly");
  });

  it('should handle multiple single quotes', () => {
    expect(escapeOData("it's a test's case")).toBe("it''s a test''s case");
  });

  it('should return the same string if no quotes present', () => {
    expect(escapeOData('AAPL')).toBe('AAPL');
  });

  it('should handle empty string', () => {
    expect(escapeOData('')).toBe('');
  });

  it('should handle string that is just a single quote', () => {
    expect(escapeOData("'")).toBe("''");
  });
});

describe('validateTicker', () => {
  describe('valid tickers', () => {
    it.each([
      'AAPL',
      'MSFT',
      'BRK.B',
      'BRK.A',
      'T',
      'A',
      'JPM',
      'GOOG',
      'META',
    ])('should accept valid ticker: %s', (ticker) => {
      expect(() => validateTicker(ticker)).not.toThrow();
    });

    it('should accept tickers with hyphens', () => {
      expect(() => validateTicker('BF-B')).not.toThrow();
    });

    it('should accept lowercase tickers', () => {
      expect(() => validateTicker('aapl')).not.toThrow();
    });

    it('should accept numeric tickers', () => {
      expect(() => validateTicker('0700')).not.toThrow();
    });
  });

  describe('invalid tickers', () => {
    it('should reject SQL injection attempts', () => {
      expect(() => validateTicker("'; DROP TABLE--")).toThrow('Invalid ticker format');
    });

    it('should reject tickers with spaces', () => {
      expect(() => validateTicker('AA PL')).toThrow('Invalid ticker format');
    });

    it('should reject tickers with special characters', () => {
      expect(() => validateTicker('AAPL$')).toThrow('Invalid ticker format');
      expect(() => validateTicker('AAPL;')).toThrow('Invalid ticker format');
      expect(() => validateTicker("AAPL'")).toThrow('Invalid ticker format');
    });

    it('should reject empty string', () => {
      expect(() => validateTicker('')).toThrow('Invalid ticker format');
    });

    it('should reject tickers longer than 10 characters', () => {
      expect(() => validateTicker('ABCDEFGHIJK')).toThrow('Invalid ticker format');
    });

    it('should reject tickers with path traversal', () => {
      expect(() => validateTicker('../etc')).toThrow('Invalid ticker format');
    });

    it('should reject tickers with HTML/script injection', () => {
      expect(() => validateTicker('<script>')).toThrow('Invalid ticker format');
    });
  });
});
