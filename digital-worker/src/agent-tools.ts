// Portfolio Manager Digital Worker — Function tools for the @openai/agents Agent
// Registers portfolio, market, CRM, and analysis tools.
// Communication tools (email, Teams, people lookup) are provided by M365 MCP platform.

import { tool } from '@openai/agents';
import { z } from 'zod';
import { mcpClient } from './mcp-client';
import { sendEmail, resolveUserEmail } from './email-service';
import { postToChannel } from './teams-channel';
import { simulateTrade } from './trade-simulation';
import { acknowledgeAction, markActed, dismissAction, deferAction, getPendingActions, getAction, getRecentActions, getActionSummary, getActionsForSymbol, recordOutcome } from './action-tracker';
import { getActiveWorkflows, getWorkflow, getWorkflowSummary, getWorkflowsForSymbol } from './workflow-engine';
import { type Holding, parseMcpArray } from './types';

// ── Helper: build portfolio params from holdings ────────────────────────
async function getPortfolioParams() {
  const raw = await mcpClient.getPortfolioHoldings();
  const holdings = parseMcpArray<Holding>(raw);
  const active = holdings.filter((h) => h.Ticker && Number(h.Shares) > 0);
  const symbols = active.map((h: any) => h.Ticker).join(',');
  const positions: Record<string, { shares: number; costPerShare: number }> = {};
  const types: Record<string, string> = {};
  const sectors: Record<string, string> = {};
  for (const h of active as any[]) {
    positions[h.Ticker] = {
      shares: Number(h.Shares) || 0,
      costPerShare: Number(String(h['Cost Per Share'] || h.CostPerShare || '0').replace(/[$,]/g, '')) || 0,
    };
    types[h.Ticker] = h.Type || 'Client';
    sectors[h.Ticker] = h.Sector || 'Other';
  }
  return { symbols, positions: JSON.stringify(positions), types: JSON.stringify(types), sectors: JSON.stringify(sectors) };
}

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

// ── Tool Definitions ─────────────────────────────────────────────────────

export const agentTools = [
  // ── Portfolio CRUD ──
  tool({
    name: 'read_portfolio',
    description: 'Read all portfolio holdings from Dataverse. Returns ticker symbols, company names, share counts, cost basis, sectors, holding type, and compliance status.',
    parameters: z.object({}),
    execute: async () => stringify(await mcpClient.getPortfolioHoldings()),
  }),

  // ── Market Data ──
  tool({
    name: 'show_stock_quote',
    description: 'Get a real-time stock quote — current price, change, percent change, day high/low.',
    parameters: z.object({ symbol: z.string().describe('Stock ticker symbol, e.g. "MSFT"') }),
    execute: async ({ symbol }) => stringify(await mcpClient.getQuote(symbol)),
  }),

  tool({
    name: 'get_basic_financials',
    description: 'Get key financial metrics — 52-week high/low, PE ratio, market cap, returns, dividend yield, beta.',
    parameters: z.object({ symbol: z.string().describe('Stock ticker symbol') }),
    execute: async ({ symbol }) => stringify(await mcpClient.getBasicFinancials(symbol)),
  }),

  tool({
    name: 'show_company_news',
    description: 'Get recent news articles for a specific company from the last 14 days.',
    parameters: z.object({ symbol: z.string().describe('Stock ticker symbol') }),
    execute: async ({ symbol }) => stringify(await mcpClient.getCompanyNews(symbol)),
  }),

  tool({
    name: 'show_news_feed',
    description: 'Get the latest general market news headlines.',
    parameters: z.object({}),
    execute: async () => stringify(await mcpClient.getMarketNews()),
  }),

  tool({
    name: 'show_analyst_consensus',
    description: 'Get analyst recommendation trends for a stock — buy/hold/sell ratings and target prices.',
    parameters: z.object({ symbol: z.string().describe('Stock ticker symbol') }),
    execute: async ({ symbol }) => stringify(await mcpClient.getRecommendations(symbol)),
  }),

  tool({
    name: 'get_peers',
    description: 'Get peer companies in the same sector for comparison.',
    parameters: z.object({ symbol: z.string().describe('Stock ticker symbol') }),
    execute: async ({ symbol }) => stringify(await mcpClient.callTool(mcpClient.finnhubEndpoint, 'get-peers', { symbol })),
  }),

  tool({
    name: 'get_insider_transactions',
    description: 'Get recent insider trading activity — buys and sells by executives and directors.',
    parameters: z.object({ symbol: z.string().describe('Stock ticker symbol') }),
    execute: async ({ symbol }) => stringify(await mcpClient.callTool(mcpClient.finnhubEndpoint, 'get-insider-transactions', { symbol })),
  }),

  tool({
    name: 'search_symbol',
    description: 'Search for a stock by company name, ticker, ISIN, or CUSIP.',
    parameters: z.object({ query: z.string().describe('Company name, ticker, ISIN, or CUSIP') }),
    execute: async ({ query }) => stringify(await mcpClient.callTool(mcpClient.finnhubEndpoint, 'search-symbol', { query })),
  }),

  // ── Portfolio Analysis ──
  tool({
    name: 'show_concentration_risk',
    description: 'Analyse portfolio concentration risk — sector exposure, single-name risk, HHI index, diversification. Auto-uses all current holdings.',
    parameters: z.object({}),
    execute: async () => {
      const p = await getPortfolioParams();
      return stringify(await mcpClient.getConcentrationRisk(p.symbols, p.positions, p.types, p.sectors));
    },
  }),

  tool({
    name: 'show_stress_test',
    description: 'Run a portfolio stress test — projected P&L under scenarios (rate hike, recession, oil shock). Auto-uses all holdings.',
    parameters: z.object({}),
    execute: async () => {
      const p = await getPortfolioParams();
      return stringify(await mcpClient.getStressTest(p.symbols, p.positions, p.types, p.sectors));
    },
  }),

  tool({
    name: 'show_relative_value',
    description: 'Compare relative valuation across holdings — PE, price-to-book, dividend yield, performance. Auto-uses all holdings.',
    parameters: z.object({}),
    execute: async () => {
      const p = await getPortfolioParams();
      return stringify(await mcpClient.getRelativeValue(p.symbols, p.positions, p.types, p.sectors));
    },
  }),

  tool({
    name: 'show_rv_shifts',
    description: 'Detect relative value SHIFTS — what has changed in the last 7 days. Shows which holdings became expensive or cheap, analyst rating changes, and sector-level RV movement. Focuses on CHANGE, not current levels.',
    parameters: z.object({}),
    execute: async () => {
      const p = await getPortfolioParams();
      return stringify(await mcpClient.getRvShifts(p.symbols, p.positions, p.types, p.sectors));
    },
  }),

  tool({
    name: 'show_challenge_holdings',
    description: 'Challenge your holdings — flags expensive positions with analyst overlay and asks "why still holding?". Ranks by urgency with severity indicators and reasons. Use for position review.',
    parameters: z.object({}),
    execute: async () => {
      const p = await getPortfolioParams();
      return stringify(await mcpClient.getChallengeHoldings(p.symbols, p.positions, p.types, p.sectors));
    },
  }),

  tool({
    name: 'show_benchmark_comparison',
    description: 'Compare fund vs benchmark — sector weights, overweight/underweight positions, active share, tracking error, and benchmark change impact. Use for benchmark deviation analysis.',
    parameters: z.object({}),
    execute: async () => {
      const p = await getPortfolioParams();
      return stringify(await mcpClient.getBenchmarkComparison(p.symbols, p.positions, p.types, p.sectors));
    },
  }),

  // ── FX & Earnings ──
  tool({
    name: 'get_fx_rate',
    description: 'Get live FX exchange rates for major currency pairs.',
    parameters: z.object({ base: z.string().optional().describe('Base currency: USD, EUR, GBP, JPY, CHF. Default: USD') }),
    execute: async ({ base }) => stringify(await mcpClient.getFxRate(base)),
  }),

  tool({
    name: 'get_earnings_calendar',
    description: 'Get upcoming earnings dates for a company or across the market.',
    parameters: z.object({
      symbol: z.string().optional().describe('Stock ticker (optional — omit for all)'),
      days: z.string().optional().describe('Number of days ahead to look. Default: 7'),
    }),
    execute: async ({ symbol, days }) => stringify(await mcpClient.getEarningsCalendar(symbol, days ? Number(days) : undefined)),
  }),

  tool({
    name: 'get_ipo_calendar',
    description: 'Get upcoming IPOs in the next N days.',
    parameters: z.object({ days: z.string().optional().describe('Number of days ahead. Default: 30') }),
    execute: async ({ days }) => stringify(await mcpClient.getIpoCalendar(days ? Number(days) : undefined)),
  }),

  // ── SEC & Regulatory ──
  tool({
    name: 'get_sec_filings',
    description: 'Get recent SEC filings (10-K, 10-Q, 8-K) for a company.',
    parameters: z.object({ symbol: z.string().describe('Stock ticker symbol') }),
    execute: async ({ symbol }) => stringify(await mcpClient.getSecFilings(symbol)),
  }),

  tool({
    name: 'get_reported_financials',
    description: 'Get reported financial statements from SEC filings.',
    parameters: z.object({
      symbol: z.string().describe('Stock ticker symbol'),
      freq: z.string().optional().describe('"annual" or "quarterly". Default: annual'),
    }),
    execute: async ({ symbol, freq }) => stringify(await mcpClient.getReportedFinancials(symbol, freq)),
  }),

  tool({
    name: 'get_insider_sentiment',
    description: 'Get insider sentiment ratio for a stock over recent months.',
    parameters: z.object({
      symbol: z.string().describe('Stock ticker symbol'),
      months: z.string().optional().describe('Number of months. Default: 3'),
    }),
    execute: async ({ symbol, months }) => stringify(await mcpClient.getInsiderSentiment(symbol, months ? Number(months) : undefined)),
  }),

  // ── CRM ──
  tool({
    name: 'get_crm_pipeline',
    description: 'Get the CRM investment pipeline — all opportunities with deal stage, value, company, and win probability.',
    parameters: z.object({}),
    execute: async () => stringify(await mcpClient.getCrmPipeline()),
  }),

  tool({
    name: 'get_crm_account',
    description: 'Get CRM account profile for a company — industry, revenue, relationship, contacts, and opportunities.',
    parameters: z.object({ ticker: z.string().describe('Stock ticker symbol, e.g. "AZN"') }),
    execute: async ({ ticker }) => stringify(await mcpClient.getCrmAccounts(ticker)),
  }),

  tool({
    name: 'get_crm_contacts',
    description: 'Get CRM contacts for a company — names, titles, emails, and roles.',
    parameters: z.object({ ticker: z.string().describe('Stock ticker symbol') }),
    execute: async ({ ticker }) => stringify(await mcpClient.getCrmContacts(ticker)),
  }),

  tool({
    name: 'get_crm_opportunities',
    description: 'Get CRM opportunities/deals for a specific company.',
    parameters: z.object({ ticker: z.string().describe('Stock ticker symbol') }),
    execute: async ({ ticker }) => stringify(await mcpClient.callTool(mcpClient.crmEndpoint, 'get-crm-opportunities', { ticker })),
  }),

  // ── Deal Tracking & Compliance ──
  tool({
    name: 'get_deal_tracker',
    description: 'Get the deal tracker — M&A, capital raise, FX hedging, follow-on, and exit deals.',
    parameters: z.object({
      dealType: z.string().optional().describe('Filter: "M&A", "Capital Raise", "FX Hedging", "Follow-on", "Exit"'),
      stage: z.string().optional().describe('Filter by deal stage'),
    }),
    execute: async ({ dealType, stage }) => stringify(await mcpClient.getDealTracker(dealType, stage)),
  }),

  tool({
    name: 'get_revenue_forecast',
    description: 'Get pipeline-weighted revenue forecast — total weighted by win probability, broken down by stage and deal type.',
    parameters: z.object({}),
    execute: async () => stringify(await mcpClient.getRevenueForecast()),
  }),

  tool({
    name: 'get_compliance_status',
    description: 'Get deals with compliance issues — flagged, pending, escalated, or approved.',
    parameters: z.object({
      status: z.string().optional().describe('Filter: "Pending", "Approved", "Flagged", "Escalated"'),
    }),
    execute: async ({ status }) => stringify(await mcpClient.getComplianceStatus(status)),
  }),

  tool({
    name: 'get_ic_calendar',
    description: 'Get upcoming Investment Committee dates and the deals scheduled for review.',
    parameters: z.object({}),
    execute: async () => stringify(await mcpClient.getICCalendar()),
  }),

  // ── Communication ──
  tool({
    name: 'lookup_person',
    description: 'Look up a person by name in the organization directory. Returns their email address. ALWAYS use this before send_email when you only have a display name.',
    parameters: z.object({
      name: z.string().describe('Display name or partial name to search for'),
    }),
    execute: async ({ name }) => {
      const email = await resolveUserEmail(name);
      return email ? `Found: ${name} → ${email}` : `No user found matching "${name}"`;
    },
  }),

  tool({
    name: 'send_email',
    description: 'Send an email via Microsoft Graph. Use lookup_person first if you only have a name, not an email address. NEVER guess email addresses.',
    parameters: z.object({
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe('Email subject line'),
      body: z.string().describe('Email body in plain professional English'),
    }),
    execute: async ({ to, subject, body }) => {
      const sent = await sendEmail({ to, subject, body, isHtml: false });
      return sent ? `Email sent to ${to} with subject "${subject}"` : `Failed to send email to ${to}`;
    },
  }),

  tool({
    name: 'post_to_channel',
    description: 'Post a message to the Finance team Portfolio Alerts channel in Microsoft Teams.',
    parameters: z.object({
      message: z.string().describe('The message to post to the team channel'),
    }),
    execute: async ({ message }) => {
      const posted = await postToChannel(message, false);
      return posted ? 'Message posted to the Finance team alerts channel' : 'Failed to post to channel';
    },
  }),

  // ── Trading & Utility ──
  tool({
    name: 'simulate_trade',
    description: 'Simulate a trade and show projected portfolio impact. E.g. "sell 500 MSFT, buy 1000 TSLA".',
    parameters: z.object({
      description: z.string().describe('Natural language description of the trade'),
    }),
    execute: async ({ description }) => stringify(await simulateTrade(description)),
  }),

  tool({
    name: 'get_current_date',
    description: 'Returns the current date and time.',
    parameters: z.object({}),
    execute: async () => JSON.stringify({ isoDate: new Date().toISOString(), utcString: new Date().toUTCString() }),
  }),

  // ── Action Tracker (PM Interaction) ──
  tool({
    name: 'list_pending_actions',
    description: 'List all open/pending recommendations that need your attention. Shows tracked actions from signals, earnings, and challenge reviews.',
    parameters: z.object({
      symbol: z.string().optional().describe('Filter by ticker symbol (optional)'),
    }),
    execute: async ({ symbol }) => {
      if (symbol) {
        const actions = await getActionsForSymbol(symbol.toUpperCase());
        return stringify(actions);
      }
      const pending = await getPendingActions();
      return stringify(pending);
    },
  }),

  tool({
    name: 'get_action_summary',
    description: 'Get a high-level summary of all tracked actions — counts by status, hit rate, and average time to act.',
    parameters: z.object({}),
    execute: async () => stringify(await getActionSummary()),
  }),

  tool({
    name: 'acknowledge_action',
    description: 'Acknowledge a recommendation — you\'ve seen it and are considering it. Use action ID from list_pending_actions.',
    parameters: z.object({
      actionId: z.string().describe('The action ID to acknowledge'),
    }),
    execute: async ({ actionId }) => {
      const result = await acknowledgeAction(actionId);
      return result ? `Acknowledged action ${actionId} for ${result.symbol}` : `Action ${actionId} not found`;
    },
  }),

  tool({
    name: 'act_on_recommendation',
    description: 'Mark a recommendation as acted upon. Records the price at which you acted and an optional outcome note.',
    parameters: z.object({
      actionId: z.string().describe('The action ID'),
      priceAtAction: z.number().optional().describe('Price you acted at (e.g. 185.50)'),
      note: z.string().optional().describe('What you did (e.g. "Trimmed 200 shares at $185")'),
    }),
    execute: async ({ actionId, priceAtAction, note }) => {
      const result = await markActed(actionId, priceAtAction);
      if (!result) return `Action ${actionId} not found`;
      if (note && priceAtAction) await recordOutcome(actionId, priceAtAction, note);
      return `Marked action ${actionId} as acted: ${result.symbol} — ${note || 'no note'}`;
    },
  }),

  tool({
    name: 'dismiss_action',
    description: 'Dismiss a recommendation — you reviewed it and decided not to act. Provide a reason for the record.',
    parameters: z.object({
      actionId: z.string().describe('The action ID to dismiss'),
      reason: z.string().describe('Why you\'re dismissing it (e.g. "Thesis unchanged, position sizing appropriate")'),
    }),
    execute: async ({ actionId, reason }) => {
      const result = await dismissAction(actionId, reason);
      return result ? `Dismissed action ${actionId} for ${result.symbol}: ${reason}` : `Action ${actionId} not found`;
    },
  }),

  tool({
    name: 'defer_action',
    description: 'Defer a recommendation to revisit later. Specify when to follow up.',
    parameters: z.object({
      actionId: z.string().describe('The action ID to defer'),
      hours: z.number().describe('Hours to defer (e.g. 24 for tomorrow)'),
    }),
    execute: async ({ actionId, hours }) => {
      const result = await deferAction(actionId, hours);
      return result ? `Deferred action ${actionId} for ${result.symbol} — will follow up in ${hours}h` : `Action ${actionId} not found`;
    },
  }),

  tool({
    name: 'get_action_details',
    description: 'Get full details for a specific tracked action including history, price at creation, and escalation count.',
    parameters: z.object({
      actionId: z.string().describe('The action ID'),
    }),
    execute: async ({ actionId }) => {
      const action = await getAction(actionId);
      return action ? stringify(action) : `Action ${actionId} not found`;
    },
  }),

  tool({
    name: 'recent_actions',
    description: 'Get recent actions across all symbols — shows the latest activity including acted, dismissed, and escalated items.',
    parameters: z.object({
      count: z.number().optional().describe('Number of recent actions (default 10)'),
    }),
    execute: async ({ count }) => stringify(await getRecentActions(count || 10)),
  }),

  // ── Workflow Tracking ──
  tool({
    name: 'list_active_workflows',
    description: 'List all active multi-step workflows (earnings prep, position entry, risk remediation, etc.).',
    parameters: z.object({
      symbol: z.string().optional().describe('Filter by ticker symbol (optional)'),
    }),
    execute: async ({ symbol }) => {
      if (symbol) {
        const workflows = await getWorkflowsForSymbol(symbol.toUpperCase());
        return stringify(workflows);
      }
      return stringify(await getActiveWorkflows());
    },
  }),

  tool({
    name: 'get_workflow_details',
    description: 'Get full details for a specific workflow including all steps, their status, and outputs.',
    parameters: z.object({
      workflowId: z.string().describe('The workflow ID'),
    }),
    execute: async ({ workflowId }) => {
      const wf = await getWorkflow(workflowId);
      return wf ? stringify(wf) : `Workflow ${workflowId} not found`;
    },
  }),

  tool({
    name: 'get_workflow_summary',
    description: 'Get a high-level summary of all workflows — active count, completed count, breakdown by type.',
    parameters: z.object({}),
    execute: async () => stringify(await getWorkflowSummary()),
  }),
];
