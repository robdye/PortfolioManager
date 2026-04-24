// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — Live Portfolio Monitor
//
// Checks portfolio holdings for significant price movements and sends
// alerts via Teams and email.
//
// Triggered via API endpoint /api/scheduled/monitor — called by an external
// scheduler (every 5 minutes via Azure Logic App, Container App Job, etc.).

import { configDotenv } from 'dotenv';
configDotenv();

import { mcpClient } from './mcp-client';
import { getStandaloneClient } from './client';
import { postPriceAlert } from './teams-channel';
import { runDecisionEngine, type DecisionResult } from './decision-engine';
import { Holding, parseMcpArray } from './types';

const PRICE_CHANGE_THRESHOLD = parseFloat(process.env.PRICE_CHANGE_THRESHOLD || '2.0');
const MANAGER_EMAIL = process.env.MANAGER_EMAIL || '';
const MANAGER_NAME = process.env.MANAGER_NAME || 'Manager';

/** Previous prices keyed by ticker symbol */
const priceCache = new Map<string, { price: number; timestamp: number }>();

interface PriceAlert {
  symbol: string;
  previousPrice: number;
  currentPrice: number;
  changePercent: number;
  direction: 'up' | 'down';
}

/**
 * Check all portfolio holdings for significant price movements.
 */
async function checkPortfolio(): Promise<PriceAlert[]> {
  const alerts: PriceAlert[] = [];

  try {
    const holdingsRaw = await mcpClient.getPortfolioHoldings() as any;
    if (!holdingsRaw) {
      console.warn('[Monitor] No holdings data received');
      return alerts;
    }

    // Parse holdings — MCP returns a string with JSON array embedded
    const holdingsList = parseMcpArray<Holding>(holdingsRaw);

    if (holdingsList.length === 0) {
      console.warn('[Monitor] Could not parse holdings data');
      return alerts;
    }

    // Filter to active holdings only
    const activeHoldings: Holding[] = holdingsList.filter((h: any) => h.Ticker && h.Shares > 0);
    console.log(`[Monitor] Checking ${activeHoldings.length} active holdings...`);

    // Get financials for each holding (returns 5DayPriceReturnDaily)
    for (const holding of activeHoldings) {
      const symbol = holding.Ticker;

      try {
        const financials = await mcpClient.getBasicFinancials(symbol) as any;
        if (!financials?.metric) continue;

        const fiveDayReturn = financials.metric['5DayPriceReturnDaily'];
        const currentPrice = financials.metric['52WeekHigh']; // approximate
        const cached = priceCache.get(symbol);

        // Use 5-day return as a proxy for significant moves
        if (typeof fiveDayReturn === 'number' && Math.abs(fiveDayReturn) >= PRICE_CHANGE_THRESHOLD) {
          // Only alert once per direction change
          const prevDirection = cached?.price ? (cached.price > 0 ? 'up' : 'down') : null;
          const curDirection = fiveDayReturn > 0 ? 'up' : 'down';

          if (!cached || curDirection !== prevDirection) {
            alerts.push({
              symbol,
              previousPrice: cached?.price || 0,
              currentPrice: currentPrice || 0,
              changePercent: fiveDayReturn,
              direction: curDirection as 'up' | 'down',
            });
          }
        }

        priceCache.set(symbol, { price: fiveDayReturn, timestamp: Date.now() });
      } catch (err) {
        console.warn(`[Monitor] Failed to get data for ${symbol}:`, (err as Error).message);
      }
    }
  } catch (error) {
    console.error('[Monitor] Failed to check portfolio:', error);
  }

  return alerts;
}

/**
 * Format and send alerts for significant price movements.
 */
async function processAlerts(alerts: PriceAlert[]): Promise<void> {
  if (alerts.length === 0) return;

  console.log(`[Monitor] ${alerts.length} price alert(s) detected — posting to Teams channel`);

  // Post to the Finance > Portfolio Alerts channel
  try {
    await postPriceAlert(alerts);
    console.log('[Monitor] Alert posted to Finance > Portfolio Alerts channel');
  } catch (error) {
    console.error('[Monitor] Failed to post alert to channel:', error);
  }
}

/**
 * Run a single monitoring cycle — called by API endpoint.
 * Returns alert count for the API response.
 */
export async function runPortfolioMonitor(): Promise<{ status: string; alertCount: number; holdingsChecked: number; decisionEngine?: DecisionResult }> {
  console.log(`[Monitor] Portfolio monitor triggered at ${new Date().toISOString()}`);
  try {
    // Run legacy price-only check
    const alerts = await checkPortfolio();
    await processAlerts(alerts);

    // Also run the decision engine for multi-signal analysis
    let decisionResult: DecisionResult | undefined;
    try {
      decisionResult = await runDecisionEngine();
      console.log(`[Monitor] Decision engine: ${decisionResult.signalsSurfaced} signals surfaced`);
    } catch (err) {
      console.warn('[Monitor] Decision engine failed, continuing with price-only alerts:', (err as Error).message);
    }

    return {
      status: 'complete',
      alertCount: alerts.length,
      holdingsChecked: priceCache.size,
      decisionEngine: decisionResult,
    };
  } catch (error) {
    console.error('[Monitor] Monitoring cycle error:', error);
    throw error;
  }
}
