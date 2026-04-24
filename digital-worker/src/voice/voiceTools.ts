// Portfolio Manager Digital Worker — Voice Live tool definitions
// These are formatted for the Voice Live realtime API (function-call schema).
// Tool execution calls the same MCP servers used by the chat handler.
// Tools that need portfolio context (concentration risk, stress test, etc.)
// automatically fetch holdings first to build the required params.

import { mcpClient } from '../mcp-client';
import { sendEmail } from '../email-service';
import { postToChannel } from '../teams-channel';
import { simulateTrade } from '../trade-simulation';

// ── Helper: build portfolio params from holdings data ────────────────────
interface PortfolioParams {
  symbols: string;
  positions: string;
  types: string;
  sectors: string;
}

async function getPortfolioParams(): Promise<PortfolioParams> {
  const raw = await mcpClient.getPortfolioHoldings();
  let holdings: Array<Record<string, unknown>> = [];

  if (typeof raw === 'string') {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) holdings = JSON.parse(match[0]);
  } else if (Array.isArray(raw)) {
    holdings = raw;
  }

  // Filter to actual holdings (Shares > 0)
  const active = holdings.filter((h: any) => h.Ticker && Number(h.Shares) > 0);

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

  return {
    symbols,
    positions: JSON.stringify(positions),
    types: JSON.stringify(types),
    sectors: JSON.stringify(sectors),
  };
}

// ── Voice Live tool definitions ──────────────────────────────────────────
export const VOICE_TOOLS = [
  {
    type: 'function',
    name: 'read_portfolio',
    description:
      'Read all portfolio holdings. Returns ticker symbols, company names, share counts, cost basis, and sectors for every holding.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'get_basic_financials',
    description:
      'Get basic financial metrics for a stock — 52-week high/low, PE ratio, market cap, recent returns, dividend yield.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol, e.g. "MSFT".' },
      },
      required: ['symbol'],
    },
  },
  {
    type: 'function',
    name: 'show_stock_quote',
    description:
      'Get a real-time stock quote with current price, change, percent change, high/low of day.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol.' },
      },
      required: ['symbol'],
    },
  },
  {
    type: 'function',
    name: 'show_company_news',
    description:
      'Get recent news articles for a specific company. Returns headlines, summaries, and sources from the last 14 days.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol.' },
      },
      required: ['symbol'],
    },
  },
  {
    type: 'function',
    name: 'show_news_feed',
    description:
      'Get the latest general market news feed. Returns top financial news headlines.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'get_crm_pipeline',
    description:
      'Get the CRM sales pipeline — all opportunities with deal stage, estimated value, company name, and close probability.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'get_crm_account',
    description:
      'Get CRM account details for a specific company by ticker symbol — industry, revenue, relationship status, and key contacts.',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol, e.g. "AZN".' },
      },
      required: ['ticker'],
    },
  },
  {
    type: 'function',
    name: 'get_crm_contacts',
    description:
      'Get CRM contacts for a company — names, titles, emails, and roles of key people like IR directors, CFO, VP IR.',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol of the account.' },
      },
      required: ['ticker'],
    },
  },
  {
    type: 'function',
    name: 'get_crm_opportunities',
    description:
      'Get CRM opportunities/deals for a specific company — deal names, stages, values, and expected close dates.',
    parameters: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol.' },
      },
      required: ['ticker'],
    },
  },
  {
    type: 'function',
    name: 'show_analyst_consensus',
    description:
      'Get analyst consensus recommendations for a stock — buy/hold/sell ratings and price targets.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol.' },
      },
      required: ['symbol'],
    },
  },
  {
    type: 'function',
    name: 'show_concentration_risk',
    description:
      'Analyse portfolio concentration risk — sector exposure, single-name risk, top holdings by weight, and diversification metrics. Automatically uses all current portfolio holdings.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'show_stress_test',
    description:
      'Run a portfolio stress test. Shows projected P&L impact across different market scenarios (rate hike, recession, tech crash, etc.). Automatically uses all current portfolio holdings.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'show_relative_value',
    description:
      'Compare relative valuation metrics across portfolio holdings — PE ratios, price-to-book, dividend yields, and performance ranked side by side.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'get_peers',
    description:
      'Get peer companies for a stock — similar companies in the same sector for comparison.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol.' },
      },
      required: ['symbol'],
    },
  },
  {
    type: 'function',
    name: 'get_insider_transactions',
    description:
      'Get recent insider trading activity for a stock — buys and sells by executives and directors.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Stock ticker symbol.' },
      },
      required: ['symbol'],
    },
  },
  {
    type: 'function',
    name: 'search_symbol',
    description:
      'Search for a stock by company name, ticker symbol, ISIN, or CUSIP. Use this when the user mentions a company name and you need to find the ticker.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Company name, ticker, ISIN, or CUSIP to search for.' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'send_email',
    description:
      'Send an email to someone. Compose a professional email with a clear subject line.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address.' },
        subject: { type: 'string', description: 'Email subject line.' },
        body: { type: 'string', description: 'Email body text. Write in plain professional English, no markdown.' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    type: 'function',
    name: 'post_to_channel',
    description:
      'Post a message to the Finance team alerts channel in Microsoft Teams. Use this to share portfolio updates, alerts, or briefings with the team.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message to post. Write in clear professional English.' },
      },
      required: ['message'],
    },
  },
  {
    type: 'function',
    name: 'simulate_trade',
    description:
      'Simulate a trade and show the projected impact on the portfolio. Describe the trade in natural language, e.g. "sell 500 shares of MSFT and buy 1000 shares of TSLA".',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Natural language description of the trade to simulate.' },
      },
      required: ['description'],
    },
  },
  {
    type: 'function',
    name: 'get_current_date',
    description: 'Returns the current date and time.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

// ── Tool execution ───────────────────────────────────────────────────────
export async function executeVoiceTool(
  name: string,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'read_portfolio':
      return mcpClient.getPortfolioHoldings();

    case 'get_basic_financials':
      return mcpClient.getBasicFinancials(params.symbol as string);

    case 'show_stock_quote':
      return mcpClient.getQuote(params.symbol as string);

    case 'show_company_news':
      return mcpClient.getCompanyNews(params.symbol as string);

    case 'show_news_feed':
      return mcpClient.getMarketNews();

    case 'get_crm_pipeline':
      return mcpClient.getCrmPipeline();

    case 'get_crm_account':
      return mcpClient.getCrmAccounts(params.ticker as string);

    case 'get_crm_contacts':
      return mcpClient.getCrmContacts(params.ticker as string);

    case 'get_crm_opportunities': {
      const ticker = params.ticker as string;
      return mcpClient.callTool(
        mcpClient.crmEndpoint,
        'get-crm-opportunities',
        { ticker }
      );
    }

    case 'show_analyst_consensus':
      return mcpClient.getRecommendations(params.symbol as string);

    case 'show_concentration_risk': {
      const p = await getPortfolioParams();
      return mcpClient.getConcentrationRisk(p.symbols, p.positions, p.types, p.sectors);
    }

    case 'show_stress_test': {
      const p = await getPortfolioParams();
      return mcpClient.getStressTest(p.symbols, p.positions, p.types, p.sectors);
    }

    case 'show_relative_value': {
      const p = await getPortfolioParams();
      return mcpClient.getRelativeValue(p.symbols, p.positions, p.types, p.sectors);
    }

    case 'get_peers':
      return mcpClient.callTool(
        mcpClient.finnhubEndpoint,
        'get-peers',
        { symbol: params.symbol as string }
      );

    case 'get_insider_transactions':
      return mcpClient.callTool(
        mcpClient.finnhubEndpoint,
        'get-insider-transactions',
        { symbol: params.symbol as string }
      );

    case 'search_symbol':
      return mcpClient.callTool(
        mcpClient.finnhubEndpoint,
        'search-symbol',
        { query: params.query as string }
      );

    case 'get_current_date':
      return { isoDate: new Date().toISOString(), utcString: new Date().toUTCString() };

    case 'send_email': {
      const to = params.to as string;
      const subject = params.subject as string;
      const body = params.body as string;
      const sent = await sendEmail({ to, subject, body, isHtml: false });
      return sent
        ? { success: true, message: `Email sent to ${to} with subject "${subject}"` }
        : { success: false, message: `Failed to send email to ${to}` };
    }

    case 'post_to_channel': {
      const message = params.message as string;
      const posted = await postToChannel(message, false);
      return posted
        ? { success: true, message: 'Message posted to the Finance team alerts channel' }
        : { success: false, message: 'Failed to post to channel' };
    }

    case 'simulate_trade': {
      const description = params.description as string;
      return simulateTrade(description);
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
