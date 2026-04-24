// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — Trade simulation

import { mcpClient } from './mcp-client';
import { trimFinancials } from './trim-financials';
import { generateTradeSimXlsx, TradeSimRow } from './doc-generator';

interface SimulationResult {
  action: string;
  ticker: string;
  shares: number;
  pricePerShare?: number;
  totalValue?: number;
  portfolioImpact: string;
}

/**
 * Simulate a trade and return the projected impact on the portfolio.
 */
export async function simulateTrade(description: string): Promise<string> {
  try {
    // Fetch current portfolio
    const holdings = await mcpClient.getPortfolioHoldings();

    // Fetch relevant stock data for tickers mentioned
    const tickerMatch = description.match(/\b([A-Z]{1,5})\b/g) || [];
    const quotes: Array<{ ticker: string; data: unknown }> = [];
    for (const t of tickerMatch.slice(0, 3)) {
      try {
        const data = await mcpClient.getBasicFinancials(t);
        quotes.push(trimFinancials(t, data));
      } catch { /* skip */ }
    }

    return JSON.stringify({
      currentHoldings: holdings,
      marketData: quotes,
      tradeRequest: description,
    });
  } catch (error) {
    return `Unable to simulate trade: ${(error as Error).message}`;
  }
}

/**
 * Generate an Excel workbook for a trade simulation.
 * Parses holdings data and builds before/after comparison rows.
 */
export async function simulateTradeWithExcel(description: string): Promise<{ json: string; xlsx: Buffer }> {
  const json = await simulateTrade(description);
  const parsed = JSON.parse(json);

  // Parse holdings into rows
  let holdingsArr: any[] = [];
  try {
    const hStr = typeof parsed.currentHoldings === 'string' ? parsed.currentHoldings : JSON.stringify(parsed.currentHoldings);
    const match = hStr.match(/\[[\s\S]*\]/);
    if (match) holdingsArr = JSON.parse(match[0]);
  } catch { /* empty */ }

  const totalValue = holdingsArr.reduce((sum: number, h: any) => sum + (h.Value || h.value || 0), 0) || 1;

  const rows: TradeSimRow[] = holdingsArr
    .filter((h: any) => (h.Shares || h.shares || 0) > 0)
    .slice(0, 20)
    .map((h: any) => {
      const ticker = h.Ticker || h.ticker || '';
      const company = h.Company || h.company || ticker;
      const shares = h.Shares || h.shares || 0;
      const price = h.Price || h.price || (h.Value || h.value || 0) / (shares || 1);
      const value = h.Value || h.value || shares * price;
      const weight = (value / totalValue) * 100;
      return {
        ticker, company,
        currentShares: shares, currentPrice: price, currentValue: value, currentWeight: weight,
        proposedShares: shares, proposedValue: value, proposedWeight: weight,
        changeShares: 0, changeValue: 0, changeWeight: 0,
      };
    });

  const xlsx = await generateTradeSimXlsx(rows, description, totalValue);
  return { json, xlsx };
}
