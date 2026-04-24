// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — Earnings calendar tracker
//
// Uses the Finnhub earnings calendar API to detect upcoming earnings
// for portfolio holdings and alert via Teams channel.
//
// Triggered via API endpoint /api/scheduled/earnings — called by an
// external scheduler (daily via Azure Logic App, etc.).

import { mcpClient } from './mcp-client';
import { postToChannel } from './teams-channel';
import { sendEmail } from './email-service';
import { startWorkflow } from './workflow-engine';
import { createAction, hasOpenAction } from './action-tracker';
import { scheduleEarningsReview, logCrmActivity } from './autonomous-actions';
import { generateEarningsPptx } from './doc-generator';

const MANAGER_EMAIL = process.env.MANAGER_EMAIL || '';
const MANAGER_NAME = process.env.MANAGER_NAME || 'Manager';

/**
 * Check for upcoming earnings in the next 7 days and alert.
 * Uses the real Finnhub earnings calendar endpoint.
 */
export async function checkEarnings(holdings: Array<{ ticker: string; company: string }>): Promise<void> {
  const upcoming: Array<{ ticker: string; company: string; date: string; epsEstimate: number | null; revenueEstimate: number | null; quarter: number }> = [];

  try {
    // Fetch earnings calendar for next 7 days
    const calendarData = await mcpClient.getEarningsCalendar(undefined, 7) as any;
    const earningsEvents = calendarData?.earningsCalendar || [];

    // Cross-reference with our holdings
    const holdingTickers = new Set(holdings.map(h => h.ticker.toUpperCase()));

    for (const event of earningsEvents) {
      if (holdingTickers.has(event.symbol?.toUpperCase())) {
        const holding = holdings.find(h => h.ticker.toUpperCase() === event.symbol?.toUpperCase());
        upcoming.push({
          ticker: event.symbol,
          company: holding?.company || event.symbol,
          date: event.date,
          epsEstimate: event.epsEstimate || null,
          revenueEstimate: event.revenueEstimate || null,
          quarter: event.quarter || 0,
        });
      }
    }
  } catch (err) {
    console.warn('[Earnings] Calendar API failed, falling back to per-symbol check:', err);

    // Fallback: check each holding individually
    for (const h of holdings.slice(0, 15)) {
      try {
        const data = await mcpClient.getEarningsCalendar(h.ticker) as any;
        const events = data?.earningsCalendar || [];
        const now = Date.now();
        const sevenDays = now + 7 * 86400000;

        for (const event of events) {
          const eventDate = new Date(event.date).getTime();
          if (eventDate >= now && eventDate <= sevenDays) {
            upcoming.push({
              ticker: h.ticker,
              company: h.company,
              date: event.date,
              epsEstimate: event.epsEstimate || null,
              revenueEstimate: event.revenueEstimate || null,
              quarter: event.quarter || 0,
            });
          }
        }
      } catch {
        // Skip if not available
      }
    }
  }

  if (upcoming.length === 0) {
    console.log('[Earnings] No upcoming earnings for portfolio holdings in next 7 days');
    return;
  }

  console.log(`[Earnings] ${upcoming.length} upcoming earnings detected`);

  // ── END-TO-END: Launch workflows, schedule reviews, track actions ──

  const workflowsStarted: string[] = [];
  const eventsCreated: string[] = [];

  for (const e of upcoming) {
    const earningsDate = new Date(e.date);
    const daysUntil = Math.ceil((earningsDate.getTime() - Date.now()) / 86400000);

    // 1. Start earnings prep workflow (if not already running)
    const wf = await startWorkflow('earnings_prep', e.ticker, e.company, {
      earningsDate: earningsDate.getTime(),
      epsEstimate: e.epsEstimate,
      revenueEstimate: e.revenueEstimate,
      quarter: e.quarter,
    }, 'earnings-tracker');
    if (wf) workflowsStarted.push(`${e.ticker}: ${wf.id}`);

    // 2. Schedule pre-earnings review calendar event (for ≤3 days out)
    if (daysUntil <= 3) {
      const event = await scheduleEarningsReview(e.ticker, e.company, earningsDate);
      if (event) eventsCreated.push(e.ticker);
    }

    // 3. Create tracked action: "review position before earnings"
    const hasAction = await hasOpenAction(e.ticker, 'review');
    if (!hasAction) {
      await createAction({
        symbol: e.ticker,
        company: e.company,
        actionType: 'review',
        recommendation: `Review ${e.ticker} position before earnings on ${e.date}`,
        rationale: `EPS estimate: ${e.epsEstimate !== null ? `$${e.epsEstimate.toFixed(2)}` : 'N/A'}. Revenue estimate: ${e.revenueEstimate !== null ? `$${(e.revenueEstimate / 1e9).toFixed(2)}B` : 'N/A'}. Consider position sizing and risk ahead of the print.`,
        severity: daysUntil <= 1 ? 'high' : 'medium',
        source: 'earnings-tracker',
      });
    }

    // 4. Log in CRM
    await logCrmActivity({
      ticker: e.ticker,
      activityType: 'note',
      subject: `Earnings in ${daysUntil}d — Q${e.quarter}`,
      description: `Upcoming earnings on ${e.date}. EPS est: ${e.epsEstimate ?? 'N/A'}, Rev est: ${e.revenueEstimate ? `$${(e.revenueEstimate / 1e9).toFixed(2)}B` : 'N/A'}.`,
    });
  }

  // ── Build the notification (now includes what we DID, not just what we found) ──

  const html = `
    <div style="font-family:Segoe UI,sans-serif;max-width:680px;margin:0 auto">
      <div style="background:#1a237e;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">📊 Earnings Prep — ${upcoming.length} Holdings</h2>
        <p style="margin:4px 0 0;opacity:.85;font-size:13px">Workflows started, calendar events created, actions tracked</p>
      </div>
      <div style="background:#fff;padding:20px;border:1px solid #e0e0e0;border-top:none">
        <table style="border-collapse:collapse;width:100%">
          <tr style="background:#f5f5f5">
            <th style="padding:8px;text-align:left;font-size:12px">Company</th>
            <th style="padding:8px;text-align:left;font-size:12px">Date</th>
            <th style="padding:8px;text-align:right;font-size:12px">EPS Est.</th>
            <th style="padding:8px;text-align:right;font-size:12px">Rev Est.</th>
            <th style="padding:8px;text-align:center;font-size:12px">Status</th>
          </tr>
          ${upcoming.map((e, i) => {
            const daysUntil = Math.ceil((new Date(e.date).getTime() - Date.now()) / 86400000);
            return `
            <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9f9f9'}">
              <td style="padding:8px"><strong>${e.company} (${e.ticker})</strong></td>
              <td style="padding:8px">${e.date} ${daysUntil <= 1 ? '⚠️' : ''}</td>
              <td style="padding:8px;text-align:right">${e.epsEstimate !== null ? `$${e.epsEstimate.toFixed(2)}` : 'N/A'}</td>
              <td style="padding:8px;text-align:right">${e.revenueEstimate !== null ? `$${(e.revenueEstimate / 1e9).toFixed(2)}B` : 'N/A'}</td>
              <td style="padding:8px;text-align:center;font-size:11px">
                ${eventsCreated.includes(e.ticker) ? '📅' : ''}
                ${workflowsStarted.some(w => w.startsWith(e.ticker)) ? '🔄' : ''}
                ✅
              </td>
            </tr>`;
          }).join('')}
        </table>

        <div style="margin-top:16px;padding:12px;background:#e8f5e9;border-radius:6px;border-left:4px solid #16a34a">
          <h4 style="margin:0 0 6px;font-size:13px;color:#16a34a">✅ Actions Taken</h4>
          <ul style="margin:0;padding-left:18px;font-size:12px;color:#333">
            ${workflowsStarted.length > 0 ? `<li><strong>${workflowsStarted.length} earnings prep workflows</strong> started (research → prep → day-of → post-earnings → thesis update)</li>` : ''}
            ${eventsCreated.length > 0 ? `<li><strong>${eventsCreated.length} calendar events</strong> created for pre-earnings review</li>` : ''}
            <li><strong>${upcoming.length} tracked actions</strong> created — I'll follow up if not addressed</li>
            <li><strong>${upcoming.length} CRM activities</strong> logged</li>
          </ul>
        </div>
      </div>
    </div>`;

  await postToChannel(html);

  if (MANAGER_EMAIL) {
    try {
      // Generate PowerPoint for pre-earnings review
      const pptxBuf = await generateEarningsPptx(upcoming);
      console.log(`[Earnings] Generated .pptx (${(pptxBuf.length / 1024).toFixed(0)} KB)`);

      await sendEmail({
        to: MANAGER_EMAIL,
        subject: `📊 Earnings Prep: ${upcoming.length} Holdings — ${workflowsStarted.length} workflows started, ${eventsCreated.length} events created`,
        body: html,
        isHtml: true,
        attachments: [{
          name: `Earnings-Prep-${new Date().toISOString().slice(0, 10)}.pptx`,
          contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          content: pptxBuf,
        }],
      });
    } catch (err) {
      console.warn('[Earnings] Failed to email earnings alert:', err);
    }
  }
}

/**
 * Check for upcoming IPOs that might be relevant to portfolio sectors.
 */
export async function checkIPOs(): Promise<void> {
  try {
    const data = await mcpClient.getIpoCalendar(14) as any;
    const ipos = data?.ipoCalendar || [];

    if (ipos.length === 0) return;

    const html = `
      <h3>🚀 Upcoming IPOs — Next 14 Days</h3>
      <ul>
        ${ipos.slice(0, 10).map((ipo: any) => `
          <li><strong>${ipo.name} (${ipo.symbol})</strong> — ${ipo.date} | Price: $${ipo.price || 'TBD'} | Shares: ${ipo.numberOfShares?.toLocaleString() || 'TBD'}</li>
        `).join('')}
      </ul>
    `;
    await postToChannel(html);
  } catch (err) {
    console.warn('[IPO] Calendar check failed:', err);
  }
}
