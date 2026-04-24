// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — Challenge Monitor
//
// Weekly scan that flags holdings warranting review:
// - Expensive vs peers (high PE with low growth)
// - Analyst consensus deteriorating
// - Negative momentum with no catalyst
// - Concentration risk building
//
// Triggered via /api/scheduled/challenge — recommended: weekly Friday 16:00

import { mcpClient } from './mcp-client';
import { getStandaloneClient } from './client';
import { sendEmail } from './email-service';
import { postToChannel } from './teams-channel';
import { createAction, hasOpenAction } from './action-tracker';
import { startWorkflow } from './workflow-engine';
import { logCrmActivity } from './autonomous-actions';
import { generateChallengeXlsx } from './doc-generator';
import { type Holding, parseMcpArray } from './types';

const MANAGER_EMAIL = process.env.MANAGER_EMAIL || '';
const MANAGER_NAME = process.env.MANAGER_NAME || 'Manager';

// ── Concurrency Limiter ─────────────────────────────────────────────
async function mapConcurrent<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = 5): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...await Promise.allSettled(batch.map(fn)));
  }
  return results;
}

interface ChallengedHolding {
  symbol: string;
  company: string;
  reasons: string[];
  pe: number;
  fiveDayReturn: number;
  consensus: string;
  weight: number;
  severity: 'high' | 'medium' | 'low';
}

export async function runChallengeMonitor(): Promise<{ status: string; challenged: number }> {
  console.log(`[Challenge] Weekly holdings challenge starting at ${new Date().toISOString()}`);

  // Fetch holdings
  let holdings: Holding[] = [];
  try {
    const raw = await mcpClient.getPortfolioHoldings('active');
    holdings = parseMcpArray<Holding>(raw);
  } catch (err) {
    console.error('[Challenge] Failed to fetch holdings:', err);
    return { status: 'error', challenged: 0 };
  }

  const activeHoldings = holdings.filter((h) => h.Ticker && h.Shares > 0);
  if (activeHoldings.length === 0) return { status: 'no_holdings', challenged: 0 };

  // Calculate total portfolio value for weight computation
  const totalValue = activeHoldings.reduce((sum: number, h: any) => sum + (h.Shares || 0) * (h.CostPerShare || 0), 0);

  const challenged: ChallengedHolding[] = [];

  // Analyze each holding
  const results = await mapConcurrent(
    activeHoldings.slice(0, 20),
    async (h: any) => {
      const symbol = h.Ticker;
      const [financials, recs] = await Promise.allSettled([
        mcpClient.getBasicFinancials(symbol),
        mcpClient.callTool(process.env.MCP_FINNHUB_ENDPOINT || process.env.MCP_SERVER_URL || '', 'get-recommendation-trends', { symbol }),
      ]);

      const metrics = financials.status === 'fulfilled' ? (financials.value as any)?.metric || {} : {};
      const recsList = recs.status === 'fulfilled' && Array.isArray(recs.value) ? recs.value : [];
      const latest = recsList[0] || {};

      const pe = metrics.peBasicExclExtraTTM || 0;
      const fiveDayReturn = metrics['5DayPriceReturnDaily'] || 0;
      const sellCount = (latest.sell || 0) + (latest.strongSell || 0);
      const buyCount = (latest.strongBuy || 0) + (latest.buy || 0);
      const total = buyCount + (latest.hold || 0) + sellCount;
      const consensus = total > 0 ? (buyCount / total >= 0.5 ? 'Buy' : sellCount / total >= 0.3 ? 'Sell' : 'Hold') : 'N/A';
      const weight = totalValue > 0 ? ((h.Shares * (h.CostPerShare || 0)) / totalValue) * 100 : 0;

      const reasons: string[] = [];

      // Rule 1: Expensive (PE > 35) with negative momentum
      if (pe > 35 && fiveDayReturn < -1) {
        reasons.push(`High valuation (PE ${pe.toFixed(1)}) with negative momentum (${fiveDayReturn.toFixed(1)}% 5d)`);
      }

      // Rule 2: Analyst consensus is Hold or Sell
      if (consensus === 'Sell') {
        reasons.push(`Analyst consensus is Sell (${sellCount} sell vs ${buyCount} buy)`);
      } else if (consensus === 'Hold' && pe > 25) {
        reasons.push(`Analyst consensus only Hold with elevated valuation (PE ${pe.toFixed(1)})`);
      }

      // Rule 3: Significant recent decline
      if (fiveDayReturn < -5) {
        reasons.push(`Sharp decline: ${fiveDayReturn.toFixed(1)}% over 5 days`);
      }

      // Rule 4: Overweight position with concerns
      if (weight > 8 && (pe > 30 || consensus !== 'Buy')) {
        reasons.push(`Large position (${weight.toFixed(1)}% weight) — concentration risk`);
      }

      if (reasons.length > 0) {
        challenged.push({
          symbol,
          company: h.Company || symbol,
          reasons,
          pe,
          fiveDayReturn,
          consensus,
          weight,
          severity: reasons.length >= 3 || consensus === 'Sell' ? 'high' : reasons.length >= 2 ? 'medium' : 'low',
        });
      }
    },
    5,
  );

  if (challenged.length === 0) {
    console.log('[Challenge] No positions challenged this week');
    await postToChannel('<h3>✅ Weekly Holdings Challenge</h3><p>All positions look justified — no challenges this week.</p>');
    return { status: 'no_challenges', challenged: 0 };
  }

  // Sort by severity
  challenged.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.severity] - order[b.severity];
  });

  console.log(`[Challenge] ${challenged.length} positions challenged`);

  // ── END-TO-END: Create tracked actions + risk workflows ──

  let actionsCreated = 0;
  let workflowsStarted = 0;

  for (const c of challenged) {
    // Determine recommended action type
    const actionType = c.consensus === 'Sell' ? 'exit' as const
      : c.reasons.length >= 3 ? 'trim' as const
      : 'review' as const;

    // Create tracked action (if not already open for this symbol)
    const alreadyTracked = await hasOpenAction(c.symbol, actionType);
    if (!alreadyTracked) {
      await createAction({
        symbol: c.symbol,
        company: c.company,
        actionType,
        recommendation: `${actionType === 'exit' ? 'Exit' : actionType === 'trim' ? 'Trim' : 'Review'} ${c.symbol} — ${c.reasons[0]}`,
        rationale: c.reasons.join('. '),
        severity: c.severity,
        source: 'challenge-monitor',
      });
      actionsCreated++;
    }

    // Start risk remediation workflow for high-severity challenges
    if (c.severity === 'high') {
      const wf = await startWorkflow('risk_remediation', c.symbol, c.company, {
        reasons: c.reasons,
        pe: c.pe,
        consensus: c.consensus,
        weight: c.weight,
      }, 'challenge-monitor');
      if (wf) workflowsStarted++;
    }

    // Log in CRM
    await logCrmActivity({
      ticker: c.symbol,
      activityType: 'recommendation',
      subject: `Challenge: ${actionType} — ${c.reasons[0]}`,
      description: `Severity: ${c.severity}. PE: ${c.pe.toFixed(1)}, 5d: ${c.fiveDayReturn.toFixed(1)}%, Consensus: ${c.consensus}, Weight: ${c.weight.toFixed(1)}%. Reasons: ${c.reasons.join('; ')}`,
    });
  }

  // Generate narrative using LLM
  const client = await getStandaloneClient();
  let narrative = '';
  try {
    narrative = await client.invokeAgentWithScope(`You are a portfolio manager's digital worker. Write a concise 2-paragraph challenge report for these ${challenged.length} holdings that need review:\n\n${challenged.map(c => `${c.symbol} (${c.company}): ${c.reasons.join('; ')}. PE=${c.pe.toFixed(1)}, 5d return=${c.fiveDayReturn.toFixed(1)}%, consensus=${c.consensus}, weight=${c.weight.toFixed(1)}%`).join('\n')}\n\nBe direct. For each, suggest: keep, trim, or exit. Speak as "I" (the digital worker).`) || '';
  } catch { /* continue without narrative */ }

  const html = `
    <div style="font-family:Segoe UI,sans-serif;max-width:680px;margin:0 auto">
      <div style="background:#dc2626;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">❓ Weekly Holdings Challenge — ${challenged.length} Position${challenged.length > 1 ? 's' : ''}</h2>
        <p style="margin:4px 0 0;opacity:.85;font-size:13px">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>
      <div style="background:#fff;padding:20px;border:1px solid #e0e0e0;border-top:none">
        ${challenged.map(c => `
          <div style="padding:12px;margin-bottom:10px;background:#fef2f2;border-radius:8px;border-left:4px solid ${c.severity === 'high' ? '#dc2626' : c.severity === 'medium' ? '#d97706' : '#16a34a'}">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong style="font-size:15px">${c.symbol}</strong>
              <span style="font-size:11px;color:${c.severity === 'high' ? '#dc2626' : '#d97706'};font-weight:700;text-transform:uppercase">${c.severity}</span>
            </div>
            <div style="font-size:12px;color:#666;margin:4px 0">${c.company} — PE: ${c.pe.toFixed(1)} | 5d: ${c.fiveDayReturn.toFixed(1)}% | ${c.consensus} | ${c.weight.toFixed(1)}% weight</div>
            <ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:#333">${c.reasons.map(r => `<li>${r}</li>`).join('')}</ul>
          </div>`).join('')}
        ${narrative ? `<div style="background:#f8f9fa;padding:14px;border-radius:6px;margin-top:12px;border-left:4px solid #1a237e"><h4 style="margin:0 0 6px;font-size:13px;color:#1a237e">🤖 My Recommendation</h4><div style="font-size:13px;line-height:1.5">${narrative.replace(/\n/g, '<br>')}</div></div>` : ''}

        <div style="margin-top:14px;padding:12px;background:#e8f5e9;border-radius:6px;border-left:4px solid #16a34a">
          <h4 style="margin:0 0 6px;font-size:13px;color:#16a34a">✅ Actions Taken</h4>
          <ul style="margin:0;padding-left:18px;font-size:12px;color:#333">
            <li><strong>${actionsCreated} tracked actions</strong> created — I'll escalate if not addressed</li>
            ${workflowsStarted > 0 ? `<li><strong>${workflowsStarted} risk remediation workflows</strong> started (flag → follow-up → verify resolution)</li>` : ''}
            <li><strong>${challenged.length} CRM activities</strong> logged with recommendations</li>
          </ul>
        </div>
      </div>
    </div>`;

  await postToChannel(html);

  if (MANAGER_EMAIL && challenged.some(c => c.severity === 'high')) {
    try {
      // Generate Excel workbook with challenge detail
      const xlsxBuf = await generateChallengeXlsx(
        challenged.map(c => ({
          ...c,
          recommendedAction: c.consensus === 'Sell' ? 'Exit'
            : c.reasons.length >= 3 ? 'Trim' : 'Review',
        })),
        narrative,
      );
      console.log(`[Challenge] Generated .xlsx (${(xlsxBuf.length / 1024).toFixed(0)} KB)`);

      await sendEmail({
        to: MANAGER_EMAIL,
        subject: `❓ Holdings Challenge: ${challenged.filter(c => c.severity === 'high').map(c => c.symbol).join(', ')} need review`,
        body: html,
        isHtml: true,
        attachments: [{
          name: `Challenge-Report-${new Date().toISOString().slice(0, 10)}.xlsx`,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content: xlsxBuf,
        }],
      });
    } catch { /* non-critical */ }
  }

  return { status: 'complete', challenged: challenged.length };
}
