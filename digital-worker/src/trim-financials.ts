// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — Trim market data to key metrics only

/**
 * Extract only the key metrics from a get-basic-financials response.
 * The full response is ~400KB per stock — we trim to ~200 bytes.
 */
export function trimFinancials(ticker: string, data: unknown): { ticker: string; data: Record<string, unknown> } {
  const d = data as any;
  const m = d?.metric || {};
  return {
    ticker,
    data: {
      '52WeekHigh': m['52WeekHigh'],
      '52WeekLow': m['52WeekLow'],
      '5DayPriceReturnDaily': m['5DayPriceReturnDaily'],
      '13WeekPriceReturnDaily': m['13WeekPriceReturnDaily'],
      'beta': m['beta'],
      'marketCapitalization': m['marketCapitalization'],
      'peAnnual': m['peAnnual'],
      'dividendYieldIndicatedAnnual': m['dividendYieldIndicatedAnnual'],
      'epsAnnual': m['epsAnnual'],
      'revenuePerShareTTM': m['revenuePerShareTTM'],
    },
  };
}
