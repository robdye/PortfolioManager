// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — Morning Briefing
//
// Generates a comprehensive morning briefing using data from Finnhub + CRM
// MCP servers, then sends it via email and Teams.
//
// Triggered via API endpoint /api/scheduled/briefing — called by an external
// scheduler (Azure Logic App, Container App Job, or timer trigger).

import { configDotenv } from 'dotenv';
configDotenv();

import { mcpClient } from './mcp-client';
import { getStandaloneClient } from './client';
import { sendEmail } from './email-service';
import { buildBriefingPrompt } from './briefing-prompt';
import { trimFinancials } from './trim-financials';
import { postToChannel } from './teams-channel';
import { runDecisionEngine, getDecisionState, getRvDeltaSummary } from './decision-engine';

const MANAGER_EMAIL = process.env.MANAGER_EMAIL || '';
const MANAGER_NAME = process.env.MANAGER_NAME || 'Manager';

interface BriefingData {
  dashboard: unknown;
  briefing: unknown;
  pipeline: unknown;
  concentrationRisk: unknown;
  timestamp: string;
}

/**
 * Gather all data needed for the morning briefing from MCP servers.
 */
async function gatherBriefingData(): Promise<BriefingData> {
  console.log('[Briefing] Gathering market data from MCP servers...');

  const [dashboard, briefing, pipeline, concentrationRisk] = await Promise.allSettled([
    mcpClient.getPortfolioDashboard(),
    mcpClient.getMorningBriefing(),
    mcpClient.getCrmPipeline(),
    mcpClient.getConcentrationRisk(),
  ]);

  return {
    dashboard: dashboard.status === 'fulfilled' ? dashboard.value : { error: 'Failed to fetch dashboard' },
    briefing: briefing.status === 'fulfilled' ? briefing.value : { error: 'Failed to fetch briefing' },
    pipeline: pipeline.status === 'fulfilled' ? pipeline.value : { error: 'Failed to fetch pipeline' },
    concentrationRisk: concentrationRisk.status === 'fulfilled' ? concentrationRisk.value : { error: 'Failed to fetch risk' },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generate the morning briefing email content using OpenAI.
 */
async function generateBriefingEmail(data: BriefingData): Promise<{ subject: string; body: string }> {
  const client = await getStandaloneClient();

  // Truncate large MCP responses to avoid token limits
  const truncate = (d: unknown, maxLen = 8000): string => {
    const s = typeof d === 'string' ? d : JSON.stringify(d);
    return s.length > maxLen ? s.substring(0, maxLen) + '... (truncated)' : s;
  };

  const prompt = `Generate a professional morning briefing email for ${MANAGER_NAME}. 
Use the following real-time data from our portfolio systems:

PORTFOLIO DASHBOARD:
${truncate(data.dashboard)}

MORNING BRIEFING DATA:
${truncate(data.briefing)}

CRM PIPELINE:
${truncate(data.pipeline, 5000)}

CONCENTRATION RISK:
${truncate(data.concentrationRisk, 3000)}

Format the email as a structured HTML briefing with these sections:
1. **Market Overview** — Key index levels, overnight moves, market sentiment
2. **Portfolio Summary** — Total AUM, daily P&L, MTD/YTD performance  
3. **Top Movers** — Biggest gainers and losers in the portfolio with % changes
4. **Key News** — Headlines affecting portfolio holdings
5. **Risk Alerts** — Any concentration risks, stress test warnings
6. **CRM Pipeline** — Active opportunities, upcoming meetings, deal flow
7. **Action Items** — Recommended actions for today

Use professional financial language. Include specific numbers. Keep it concise but comprehensive.
Use a clean HTML email layout with proper styling. 
Return your response as JSON with "subject" and "body" fields.
The subject should be: "Morning Briefing — [today's date in DD MMM YYYY format]"`;

  const response = await client.invokeAgentWithScope(prompt);

  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(response);
    return { subject: parsed.subject, body: parsed.body };
  } catch {
    // Fallback: use the raw response as the body
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return {
      subject: `Morning Briefing — ${today}`,
      body: response,
    };
  }
}

/**
 * Send the morning briefing via email and post summary to Teams channel.
 */
async function sendBriefing(): Promise<void> {
  console.log(`[Briefing] Starting scheduled morning briefing at ${new Date().toISOString()}`);

  try {
    // Run the decision engine FIRST to detect what has changed
    let decisionSignals: string = '';
    try {
      const decisionResult = await runDecisionEngine();
      if (decisionResult.signals && decisionResult.signals.length > 0) {
        decisionSignals = `\n\n🔔 WHAT HAS CHANGED SINCE YESTERDAY (from Decision Engine):\n${decisionResult.signals.map(s => `- [${s.severity.toUpperCase()}] ${s.title}`).join('\n')}`;
        console.log(`[Briefing] Decision engine detected ${decisionResult.signalsSurfaced} signals to incorporate`);
      }
    } catch (err) {
      console.warn('[Briefing] Decision engine failed, continuing with standard briefing:', err);
    }

    // Fetch RV delta summary from decision engine
    let rvShiftsData = '';
    try {
      const rvDeltas = getRvDeltaSummary();
      if (rvDeltas.length > 0) {
        rvShiftsData = rvDeltas.map(d =>
          `${d.symbol} (${d.company}): PE ${d.previousPE.toFixed(1)} → ${d.currentPE.toFixed(1)} (${d.peChange > 0 ? '+' : ''}${d.peChange.toFixed(1)}%) — ${d.direction.toUpperCase()} — Analyst: ${d.consensusRating}`
        ).join('\n');
      }
    } catch (err) {
      console.warn('[Briefing] RV delta fetch failed:', err);
    }

    // Fetch all data
    const [holdings, pipeline] = await Promise.allSettled([
      mcpClient.getPortfolioHoldings(),
      mcpClient.getCrmPipeline(),
    ]);

    // Fetch trimmed market quotes
    const quotes: Array<{ ticker: string; data: unknown }> = [];
    try {
      const holdingsVal = holdings.status === 'fulfilled' ? holdings.value : null;
      if (holdingsVal) {
        const holdingsStr = typeof holdingsVal === 'string' ? holdingsVal : JSON.stringify(holdingsVal);
        const match = holdingsStr.match(/\[[\s\S]*\]/);
        if (match) {
          const arr = JSON.parse(match[0]);
          const tickers = arr.filter((h: any) => h.Ticker && h.Shares > 0).map((h: any) => h.Ticker).slice(0, 8);
          const results = await Promise.allSettled(tickers.map((t: string) => mcpClient.getBasicFinancials(t)));
          results.forEach((r, i) => {
            if (r.status === 'fulfilled') quotes.push(trimFinancials(tickers[i], r.value));
          });
        }
      }
    } catch (e) {
      console.warn('[Briefing] Quote fetch error:', e);
    }

    // Generate briefing using the structured prompt — LEAD WITH CHANGES
    const changePrefix = decisionSignals
      ? `CRITICAL: Lead the briefing with "What Has Changed" — these are the signals the decision engine detected overnight. This should be the FIRST section, before market overview:\n${decisionSignals}\n\n`
      : '';

    const prompt = changePrefix + buildBriefingPrompt({
      holdings: holdings.status === 'fulfilled' ? holdings.value : 'unavailable',
      pipeline: pipeline.status === 'fulfilled' ? pipeline.value : 'unavailable',
      quotes,
      rvShifts: rvShiftsData,
    }) + '\n\nIMPORTANT:Format the output as clean HTML for an email body. If change signals were provided, start with a "⚡ What Has Changed" section highlighting the most critical shifts before the standard briefing sections.';

    const client = await getStandaloneClient();
    const briefingContent = await client.invokeAgentWithScope(prompt);

    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const decisionState = getDecisionState();

    // Send email
    if (MANAGER_EMAIL) {
      const sent = await sendEmail({
        to: MANAGER_EMAIL,
        subject: decisionSignals ? `⚡ Morning Briefing — ${today} (${decisionState.runCount > 1 ? 'Changes Detected' : 'First Run'})` : `Morning Briefing — ${today}`,
        body: briefingContent,
        isHtml: true,
      });
      console.log(`[Briefing] Email ${sent ? 'sent' : 'failed'} to ${MANAGER_EMAIL}`);
    }

    // Also post summary to Teams channel
    await postToChannel(`<h3>📋 Morning Briefing — ${today}</h3>${decisionSignals ? '<p><strong>⚡ Changes detected — see email for full analysis</strong></p>' : ''}<p>Full briefing emailed to ${MANAGER_NAME}.</p>${briefingContent.substring(0, 2000)}`);

  } catch (error) {
    console.error('[Briefing] Failed to generate morning briefing:', error);
  }
}

/**
 * Run the morning briefing — called by API endpoint.
 * Returns a status object for the API response.
 */
export async function runMorningBriefing(): Promise<{ status: string; emailSent: boolean; teamsPosted: boolean }> {
  console.log(`[Briefing] Morning briefing triggered at ${new Date().toISOString()}`);
  let emailSent = false;
  let teamsPosted = false;

  try {
    await sendBriefing();
    emailSent = !!MANAGER_EMAIL;
    teamsPosted = true;
  } catch (error) {
    console.error('[Briefing] Failed:', error);
    throw error;
  }

  return { status: 'complete', emailSent, teamsPosted };
}

/**
 * Alias for backward compatibility with existing /api/scheduled endpoint.
 */
export const runScheduledBriefing = runMorningBriefing;

/**
 * Direct export for testing or manual trigger.
 */
export { sendBriefing };
