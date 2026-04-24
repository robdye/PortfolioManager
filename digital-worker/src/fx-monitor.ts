// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — FX Rate Monitor
//
// Checks FX rates for significant currency movements that impact portfolio
// holdings. Alerts via Teams and email.
//
// Triggered via API endpoint /api/scheduled/fx — called by an external
// scheduler (every 15 minutes via Azure Logic App, Container App Job, etc.).

import { configDotenv } from 'dotenv';
configDotenv();

import { mcpClient } from './mcp-client';
import { postToChannel } from './teams-channel';
import { sendEmail } from './email-service';

const FX_CHANGE_THRESHOLD = parseFloat(process.env.FX_CHANGE_THRESHOLD || '1.0'); // % change
const MANAGER_EMAIL = process.env.MANAGER_EMAIL || '';

/** Previous rates keyed by currency pair */
const rateCache = new Map<string, { rate: number; timestamp: number }>();

interface FxAlert {
  pair: string;
  previousRate: number;
  currentRate: number;
  changePercent: number;
  direction: 'strengthened' | 'weakened';
  affectedHoldings: string[];
}

/**
 * Key currency pairs to monitor for portfolio exposure.
 */
const MONITORED_PAIRS = ['EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'HKD', 'SEK', 'NOK'];

/**
 * Check FX rates for significant movements.
 */
async function checkFxRates(): Promise<FxAlert[]> {
  const alerts: FxAlert[] = [];

  try {
    const ratesData = await mcpClient.getFxRate('USD') as any;
    const rates = ratesData?.quote || ratesData;

    if (!rates || typeof rates !== 'object') {
      console.warn('[FX Monitor] No rate data received');
      return alerts;
    }

    // Get portfolio holdings to map currency exposures
    let holdingExposures: Record<string, string[]> = {};
    try {
      const holdings = await mcpClient.getPortfolioHoldings('active') as any;
      if (Array.isArray(holdings)) {
        for (const h of holdings) {
          const exposure = h.CurrencyExposure || '';
          if (exposure) {
            const currencies = exposure.split(/[\/,]/).map((c: string) => c.trim().toUpperCase());
            for (const c of currencies) {
              if (!holdingExposures[c]) holdingExposures[c] = [];
              holdingExposures[c].push(h.Ticker || h.pm_ticker || '');
            }
          }
        }
      }
    } catch {
      // Continue without holding data
    }

    for (const currency of MONITORED_PAIRS) {
      const rate = rates[currency];
      if (typeof rate !== 'number' || rate <= 0) continue;

      const pair = `USD/${currency}`;
      const cached = rateCache.get(pair);

      if (cached) {
        const changePercent = ((rate - cached.rate) / cached.rate) * 100;

        if (Math.abs(changePercent) >= FX_CHANGE_THRESHOLD) {
          alerts.push({
            pair,
            previousRate: cached.rate,
            currentRate: rate,
            changePercent,
            direction: changePercent > 0 ? 'weakened' : 'strengthened',
            affectedHoldings: holdingExposures[currency] || [],
          });
        }
      }

      rateCache.set(pair, { rate, timestamp: Date.now() });
    }
  } catch (error) {
    console.error('[FX Monitor] Error checking rates:', error);
  }

  return alerts;
}

/**
 * Format and send FX alerts.
 */
async function sendFxAlerts(alerts: FxAlert[]): Promise<void> {
  if (alerts.length === 0) return;

  const html = `
    <h3>💱 FX Rate Alert — ${alerts.length} Significant Move(s)</h3>
    <table style="border-collapse:collapse;width:100%">
      <tr style="background:#1a237e;color:white">
        <th style="padding:8px">Pair</th>
        <th style="padding:8px;text-align:right">Previous</th>
        <th style="padding:8px;text-align:right">Current</th>
        <th style="padding:8px;text-align:right">Change</th>
        <th style="padding:8px">Direction</th>
        <th style="padding:8px">Affected Holdings</th>
      </tr>
      ${alerts.map((a, i) => `
        <tr style="background:${i % 2 === 0 ? '#f5f5f5' : '#ffffff'}">
          <td style="padding:8px"><strong>${a.pair}</strong></td>
          <td style="padding:8px;text-align:right">${a.previousRate.toFixed(4)}</td>
          <td style="padding:8px;text-align:right">${a.currentRate.toFixed(4)}</td>
          <td style="padding:8px;text-align:right;color:${a.changePercent > 0 ? '#d32f2f' : '#2e7d32'}">${a.changePercent > 0 ? '+' : ''}${a.changePercent.toFixed(2)}%</td>
          <td style="padding:8px">${a.direction === 'strengthened' ? '📈' : '📉'} ${a.direction}</td>
          <td style="padding:8px">${a.affectedHoldings.length > 0 ? a.affectedHoldings.join(', ') : 'None mapped'}</td>
        </tr>
      `).join('')}
    </table>
    <p><strong>Action:</strong> Review FX hedging positions and exposure limits.</p>
  `;

  await postToChannel(html);

  if (MANAGER_EMAIL) {
    try {
      await sendEmail({ to: MANAGER_EMAIL, subject: `\ud83d\udcb1 FX Alert: ${alerts.length} significant currency move(s)`, body: html });
    } catch (err) {
      console.warn('[FX Monitor] Failed to email alert:', err);
    }
  }
}

/**
 * Run a single FX monitoring cycle — called by API endpoint.
 * Returns alert count for the API response.
 */
export async function runFxMonitor(): Promise<{ status: string; alertCount: number; pairsChecked: number }> {
  console.log(`[FX Monitor] FX check triggered at ${new Date().toISOString()}`);
  try {
    const alerts = await checkFxRates();
    if (alerts.length > 0) {
      console.log(`[FX Monitor] ${alerts.length} FX alert(s) triggered`);
      await sendFxAlerts(alerts);
    }
    return {
      status: 'complete',
      alertCount: alerts.length,
      pairsChecked: MONITORED_PAIRS.length,
    };
  } catch (error) {
    console.error('[FX Monitor] Error:', error);
    throw error;
  }
}
