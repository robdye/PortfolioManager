/**
 * Portfolio Agent MCP Server factory.
 *
 * Creates a low-level MCP Server with full _meta control for the
 * OpenAI Apps SDK widget protocol (text/html+skybridge resources,
 * openai/outputTemplate, structuredContent).
 *
 * Architecture mirrors microsoft/mcp-interactiveUI-samples (Trey Research).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  type CallToolRequest,
  type ListToolsRequest,
  type ListResourcesRequest,
  type ReadResourceRequest,
  type ListResourceTemplatesRequest,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as finnhub from "./finnhub.js";
import * as crm from "./crm-client.js";
import * as dv from "./dataverse-client.js";
import { getPublicServerUrl } from "./index.js";

function zodParse<T>(parser: z.ZodType<T>, args: unknown): T | { __zodError: true; response: any } {
  try {
    return parser.parse(args);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const errors = err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      return { __zodError: true, response: { content: [{ type: "text" as const, text: `Invalid input: ${errors}` }], isError: true } };
    }
    throw err;
  }
}

// ── Widget HTML loader ──────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, "..", "assets");
const MIME = "text/html+skybridge";

function readWidgetHtml(name: string): string {
  if (!fs.existsSync(ASSETS_DIR)) {
    throw new Error(`Widget assets not found at ${ASSETS_DIR}. Run "npm run build:widgets" first.`);
  }
  const p = path.join(ASSETS_DIR, `${name}.html`);
  if (!fs.existsSync(p)) throw new Error(`Widget "${name}" not found in ${ASSETS_DIR}.`);
  let html = fs.readFileSync(p, "utf8");
  // Inject server URL so widgets can call back
  const injection = `<script>window.__SERVER_BASE_URL__=${JSON.stringify(getPublicServerUrl())};</script>`;
  html = html.replace("<head>", `<head>${injection}`);
  return html;
}

/** Create widget HTML with embedded tool data — makes the widget self-contained
 *  so it doesn't depend on window.openai.toolOutput being populated. */
function embedDataInHtml(html: string, data: unknown): string {
  // Escape sequences that break HTML script parsing
  const json = JSON.stringify(data).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");
  const script = `<script>window.__TOOL_DATA__=${json};</script>`;
  return html.replace("</head>", `${script}</head>`);
}

// ── Widget definitions ──────────────────────────────────────
interface Widget {
  id: string;
  title: string;
  uri: string;
  invoking: string;
  invoked: string;
  html: string;
}

let DASHBOARD: Widget;
let QUOTE_CARD: Widget;
let NEWS_FEED: Widget;
let RECS_CHART: Widget;
let BRIEFING: Widget;
let STRESS_TEST: Widget;
let CONCENTRATION_RISK: Widget;
let RELATIVE_VALUE: Widget;
let CRUD_FORM: Widget;
let CLIENT_360: Widget;
let RV_SHIFT: Widget;
let CHALLENGE_HOLDINGS: Widget;
let BENCHMARK_COMPARISON: Widget;

function loadWidgets() {
  DASHBOARD = {
    id: "portfolio-dashboard",
    title: "Portfolio Command Center",
    uri: "ui://widget/portfolio-dashboard.html",
    invoking: "Loading portfolio command center…",
    invoked: "Command center ready.",
    html: readWidgetHtml("portfolio-dashboard"),
  };
  QUOTE_CARD = {
    id: "stock-quote",
    title: "Stock Quote",
    uri: "ui://widget/stock-quote.html",
    invoking: "Fetching stock quote…",
    invoked: "Quote ready.",
    html: readWidgetHtml("stock-quote"),
  };
  NEWS_FEED = {
    id: "news-feed",
    title: "Intelligence Feed",
    uri: "ui://widget/news-feed.html",
    invoking: "Loading intelligence feed…",
    invoked: "Feed ready.",
    html: readWidgetHtml("news-feed"),
  };
  RECS_CHART = {
    id: "analyst-consensus",
    title: "Analyst Consensus",
    uri: "ui://widget/analyst-consensus.html",
    invoking: "Loading analyst consensus…",
    invoked: "Consensus ready.",
    html: readWidgetHtml("analyst-consensus"),
  };
  BRIEFING = {
    id: "morning-briefing",
    title: "Morning Briefing",
    uri: "ui://widget/morning-briefing.html",
    invoking: "Compiling morning briefing\u2026",
    invoked: "Briefing ready.",
    html: readWidgetHtml("morning-briefing"),
  };
  STRESS_TEST = {
    id: "stress-test",
    title: "Macro Stress Test",
    uri: "ui://widget/stress-test.html",
    invoking: "Running stress test scenarios\u2026",
    invoked: "Stress test ready.",
    html: readWidgetHtml("stress-test"),
  };
  CONCENTRATION_RISK = {
    id: "concentration-risk",
    title: "Concentration & Counterparty Risk",
    uri: "ui://widget/concentration-risk.html",
    invoking: "Analyzing concentration risk\u2026",
    invoked: "Risk analysis ready.",
    html: readWidgetHtml("concentration-risk"),
  };
  RELATIVE_VALUE = {
    id: "relative-value",
    title: "Relative Value Analysis",
    uri: "ui://widget/relative-value.html",
    invoking: "Computing relative valuations\u2026",
    invoked: "Relative value analysis ready.",
    html: readWidgetHtml("relative-value"),
  };
  CRUD_FORM = {
    id: "crud-form",
    title: "Portfolio Action",
    uri: "ui://widget/crud-form.html",
    invoking: "Preparing form\u2026",
    invoked: "Form ready.",
    html: readWidgetHtml("crud-form"),
  };
  CLIENT_360 = {
    id: "client-360",
    title: "Client 360 View",
    uri: "ui://widget/client-360.html",
    invoking: "Building 360 view\u2026",
    invoked: "360 view ready.",
    html: readWidgetHtml("client-360"),
  };
  RV_SHIFT = {
    id: "rv-shift",
    title: "RV Shift Detection",
    uri: "ui://widget/rv-shift.html",
    invoking: "Detecting relative value shifts\u2026",
    invoked: "RV shift analysis ready.",
    html: readWidgetHtml("rv-shift"),
  };
  CHALLENGE_HOLDINGS = {
    id: "challenge-holdings",
    title: "Challenge Your Holdings",
    uri: "ui://widget/challenge-holdings.html",
    invoking: "Challenging your positions\u2026",
    invoked: "Holdings challenge ready.",
    html: readWidgetHtml("challenge-holdings"),
  };
  BENCHMARK_COMPARISON = {
    id: "benchmark-comparison",
    title: "Benchmark Comparison",
    uri: "ui://widget/benchmark-comparison.html",
    invoking: "Comparing against benchmark\u2026",
    invoked: "Benchmark comparison ready.",
    html: readWidgetHtml("benchmark-comparison"),
  };
}

function allWidgets(): Widget[] {
  return [DASHBOARD, QUOTE_CARD, NEWS_FEED, RECS_CHART, BRIEFING, STRESS_TEST, CONCENTRATION_RISK, RELATIVE_VALUE, CRUD_FORM, CLIENT_360, RV_SHIFT, CHALLENGE_HOLDINGS, BENCHMARK_COMPARISON];
}

// ── _meta helpers ───────────────────────────────────────────
function descriptorMeta(w: Widget): Record<string, unknown> {
  return {
    "openai/outputTemplate": w.uri,
    "openai/toolInvocation/invoking": w.invoking,
    "openai/toolInvocation/invoked": w.invoked,
    "openai/widgetAccessible": true,
  };
}

/** Meta attached to call_tool responses — matches descriptorMeta to ensure
 *  platform renders the widget correctly via outputTemplate + structuredContent. */
function invocationMeta(w: Widget): Record<string, unknown> {
  return {
    "openai/outputTemplate": w.uri,
    "openai/toolInvocation/invoking": w.invoking,
    "openai/toolInvocation/invoked": w.invoked,
    "openai/widgetAccessible": true,
  };
}

/** Build a tool response with embedded widget HTML + structuredContent.
 *  content[0]: self-contained HTML with __TOOL_DATA__ embedded (primary rendering path)
 *  content[1]: plain text summary for the LLM
 *  structuredContent: data object → populates window.openai.toolOutput (backup path) */
function widgetResponse(w: Widget, data: unknown, summaryText: string) {
  const html = embedDataInHtml(w.html, data);
  return {
    content: [
      { type: "text" as const, text: html, mimeType: MIME },
      { type: "text" as const, text: summaryText },
    ],
    structuredContent: data as Record<string, unknown>,
    _meta: invocationMeta(w),
  };
}

// ── Tool input schemas ──────────────────────────────────────
const symbolSchema = {
  type: "object" as const,
  properties: {
    symbol: { type: "string" as const, description: "Stock ticker symbol (e.g. AAPL, MSFT)" },
  },
  required: ["symbol"],
  additionalProperties: false,
};

const dashboardSchema = {
  type: "object" as const,
  properties: {
    symbols: {
      type: "string" as const,
      description: "Comma-separated list of ticker symbols for the portfolio dashboard (e.g. AAPL,MSFT,GOOGL)",
    },
    positions: {
      type: "string" as const,
      description: 'JSON object mapping ticker to {shares, costPerShare} e.g. {"AAPL":{"shares":500,"costPerShare":142.50}}',
    },
    types: {
      type: "string" as const,
      description: 'JSON object mapping ticker to Client or Prospect e.g. {"AAPL":"Client","MSFT":"Prospect"}',
    },
    sectors: {
      type: "string" as const,
      description: 'JSON object mapping ticker to sector from the portfolio spreadsheet e.g. {"AAPL":"Technology","BP":"Oil and Gas"}',
    },
  },
  required: ["symbols"],
  additionalProperties: false,
};

const newsSchema = {
  type: "object" as const,
  properties: {
    category: { type: "string" as const, description: "News category: general, forex, crypto, or merger." },
  },
  additionalProperties: false,
};

const companyNewsSchema = {
  type: "object" as const,
  properties: {
    symbol: { type: "string" as const, description: "Stock ticker" },
    from: { type: "string" as const, description: "From date YYYY-MM-DD" },
    to: { type: "string" as const, description: "To date YYYY-MM-DD" },
  },
  required: ["symbol", "from", "to"],
  additionalProperties: false,
};

const searchSchema = {
  type: "object" as const,
  properties: {
    query: { type: "string" as const, description: "Search query — symbol, company name, ISIN, or CUSIP" },
  },
  required: ["query"],
  additionalProperties: false,
};

// Zod parsers
const symbolParser = z.object({ symbol: z.string() });
const dashboardParser = z.object({ symbols: z.string(), positions: z.string().optional(), types: z.string().optional(), sectors: z.string().optional() });
const newsParser = z.object({ category: z.string().optional() });
const companyNewsParser = z.object({ symbol: z.string(), from: z.string(), to: z.string() });
const searchParser = z.object({ query: z.string() });

const briefingSchema = {
  type: "object" as const,
  properties: {
    prospects: { type: "string" as const, description: "Comma-separated ticker symbols for Prospect companies" },
    clients: { type: "string" as const, description: "Comma-separated ticker symbols for Client companies" },
    industry_keywords: { type: "string" as const, description: "Industry focus keywords (default: financial services, wealth platform, AI)" },
  },
  additionalProperties: false,
};
const briefingParser = z.object({
  prospects: z.string().optional(),
  clients: z.string().optional(),
  industry_keywords: z.string().optional(),
});

const prepareAddSchema = {
  type: "object" as const,
  properties: {
    company: { type: "string" as const, description: "Company name e.g. Tesla" },
    ticker: { type: "string" as const, description: "Ticker symbol e.g. TSLA" },
    sector: { type: "string" as const, description: "Industry sector" },
    shares: { type: "string" as const, description: "Number of shares (0 for prospects)" },
    costPerShare: { type: "string" as const, description: "Cost per share in USD" },
    totalCost: { type: "string" as const, description: "Total cost in USD" },
    holdingType: { type: "string" as const, description: "Client or Prospect" },
    website: { type: "string" as const, description: "Company website URL" },
    mediaPress: { type: "string" as const, description: "Media/press release URL" },
    currencyExposure: { type: "string" as const, description: "Primary currency pair e.g. GBP/USD" },
  },
  additionalProperties: false,
};
const prepareAddParser = z.object({
  company: z.string().optional(), ticker: z.string().optional(),
  sector: z.string().optional(), shares: z.string().optional(), costPerShare: z.string().optional(),
  totalCost: z.string().optional(), holdingType: z.string().optional(), website: z.string().optional(),
  mediaPress: z.string().optional(), currencyExposure: z.string().optional(),
});

const prepareUpdateSchema = {
  type: "object" as const,
  properties: {
    ticker: { type: "string" as const, description: "Ticker symbol of the holding to update" },
    company: { type: "string" as const, description: "Company name" },
    currentRow: { type: "string" as const, description: "Dataverse record ID (from read-portfolio id field)" },
    sector: { type: "string" as const, description: "Current or new sector value" },
    shares: { type: "string" as const, description: "Current or new shares value" },
    costPerShare: { type: "string" as const, description: "Current or new cost per share" },
    totalCost: { type: "string" as const, description: "Current or new total cost" },
    holdingType: { type: "string" as const, description: "Client or Prospect" },
    website: { type: "string" as const, description: "Current or new website" },
    mediaPress: { type: "string" as const, description: "Current or new media/press URL" },
    currencyExposure: { type: "string" as const, description: "Currency exposure e.g. GBP/USD" },
    fxHedged: { type: "string" as const, description: "Is position FX hedged? true/false" },
    revenueAttributed: { type: "string" as const, description: "Revenue attributed to this holding" },
    marginPercent: { type: "string" as const, description: "Margin percentage" },
  },
  required: ["ticker"],
  additionalProperties: false,
};
const prepareUpdateParser = z.object({
  ticker: z.string(), company: z.string().optional(), currentRow: z.string().optional(),
  sector: z.string().optional(), shares: z.string().optional(), costPerShare: z.string().optional(),
  totalCost: z.string().optional(), holdingType: z.string().optional(), website: z.string().optional(),
  mediaPress: z.string().optional(), currencyExposure: z.string().optional(), fxHedged: z.string().optional(),
  revenueAttributed: z.string().optional(), marginPercent: z.string().optional(),
});

// ── Server factory ──────────────────────────────────────────
export function createPortfolioServer(): Server {
  if (!DASHBOARD) loadWidgets();

  const server = new Server(
    { name: "portfolio-agent", version: "1.0.0" },
    { capabilities: { resources: {}, tools: {} } },
  );

  // ────── Resources ──────
  const widgets = allWidgets();
  const widgetsByUri = new Map(widgets.map((w) => [w.uri, w]));

  const resources: Resource[] = widgets.map((w) => ({
    uri: w.uri,
    name: w.title,
    description: `${w.title} widget markup`,
    mimeType: MIME,
    _meta: {
      ...descriptorMeta(w),
      "openai/widgetCSP": {
        connect_domains: [new URL(getPublicServerUrl()).hostname, "finnhub.io"],
      },
    },
  }));

  const resourceTemplates: ResourceTemplate[] = widgets.map((w) => ({
    uriTemplate: w.uri,
    name: w.title,
    description: `${w.title} widget markup`,
    mimeType: MIME,
    _meta: {
      ...descriptorMeta(w),
      "openai/widgetCSP": {
        connect_domains: [new URL(getPublicServerUrl()).hostname, "finnhub.io"],
      },
    },
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req: ReadResourceRequest) => {
    const w = widgetsByUri.get(req.params.uri);
    if (!w) return { contents: [], _meta: { error: `Unknown resource: ${req.params.uri}` } };
    return {
      contents: [{ uri: w.uri, mimeType: MIME, text: w.html, _meta: descriptorMeta(w) }],
    };
  });

  // ────── Tools ──────
  const tools: Tool[] = [
    {
      name: "show-portfolio-dashboard",
      description: "Display the Portfolio Command Center — a treemap of holdings, intelligence feed, and analyst consensus. Provide comma-separated ticker symbols.",
      inputSchema: dashboardSchema,
      _meta: descriptorMeta(DASHBOARD),
      annotations: { readOnlyHint: true },
    },
    {
      name: "show-stock-quote",
      description: "Show a detailed stock quote card with price, change, financials, and company profile for a single ticker.",
      inputSchema: symbolSchema,
      _meta: descriptorMeta(QUOTE_CARD),
      annotations: { readOnlyHint: true },
    },
    {
      name: "show-news-feed",
      description: "Display the latest market or company news in an interactive intelligence feed.",
      inputSchema: newsSchema,
      _meta: descriptorMeta(NEWS_FEED),
      annotations: { readOnlyHint: true },
    },
    {
      name: "show-company-news",
      description: "Show recent news for a specific company.",
      inputSchema: companyNewsSchema,
      _meta: descriptorMeta(NEWS_FEED),
      annotations: { readOnlyHint: true },
    },
    {
      name: "show-analyst-consensus",
      description: "Display analyst recommendation trends (Strong Buy / Buy / Hold / Sell) for a stock.",
      inputSchema: symbolSchema,
      _meta: descriptorMeta(RECS_CHART),
      annotations: { readOnlyHint: true },
    },
    {
      name: "show-morning-briefing",
      description: "Generate the Morning Briefing — Industry Overview, Prospects with news, Clients with news, C-Suite moves, FNZ news, executive commentary, and appendix of companies with no material news. Provide prospect and client tickers.",
      inputSchema: briefingSchema,
      _meta: descriptorMeta(BRIEFING),
      annotations: { readOnlyHint: true },
    },
    {
      name: "show-stress-test",
      description: "Display the Macro Stress Test dashboard — scenario modeling with sliders for Market Volatility, Interest Rate changes, and Oil Price shocks. Shows waterfall chart of sector impact and per-holding stress analysis. Provide portfolio tickers and positions.",
      inputSchema: dashboardSchema,
      _meta: descriptorMeta(STRESS_TEST),
      annotations: { readOnlyHint: true },
    },
    {
      name: "show-concentration-risk",
      description: "Display the Concentration & Counterparty Risk dashboard — HHI concentration index, sector allocation, geographic dependencies, supply chain risk, correlation network graph, and risk heatmap. Provide portfolio tickers and positions.",
      inputSchema: dashboardSchema,
      _meta: descriptorMeta(CONCENTRATION_RISK),
      annotations: { readOnlyHint: true },
    },
    {
      name: "show-relative-value",
      description: "Display the Relative Value Analysis dashboard — P/E vs Revenue Growth scatter plot, opportunity signals (Strong Buy/Switch), and peer comparison cards. Identifies prospects trading at a discount to clients in the same sector. Provide portfolio tickers and positions.",
      inputSchema: dashboardSchema,
      _meta: descriptorMeta(RELATIVE_VALUE),
      annotations: { readOnlyHint: true },
    },
    {
      name: "show-rv-shifts",
      description: "Display Relative Value Shift Detection — tracks how P/E ratios and valuations have shifted over the last 7 days. Shows which holdings became expensive or cheap, analyst rating changes, and sector-level RV movement. Highlights what has CHANGED rather than current snapshot.",
      inputSchema: dashboardSchema,
      _meta: descriptorMeta(RV_SHIFT),
      annotations: { readOnlyHint: true },
    },
    {
      name: "show-challenge-holdings",
      description: "Display the Challenge Your Holdings view — flags expensive positions with analyst overlay and asks 'why are you still holding this?'. Ranks positions by urgency with severity indicators, challenge reasons, and key metrics. Helps identify positions that may need trimming or exiting.",
      inputSchema: dashboardSchema,
      _meta: descriptorMeta(CHALLENGE_HOLDINGS),
      annotations: { readOnlyHint: true },
    },
    {
      name: "show-benchmark-comparison",
      description: "Display Benchmark Comparison dashboard — compares fund sector weights vs benchmark, shows overweight/underweight positions, active share, tracking error, and models the impact of benchmark changes. Provide portfolio tickers and positions.",
      inputSchema: dashboardSchema,
      _meta: descriptorMeta(BENCHMARK_COMPARISON),
      annotations: { readOnlyHint: true },
    },
    // Data-only tools (no widget)
    {
      name: "get-basic-financials",
      description: "Get key financial metrics: P/E, 52-week range, margins, beta, dividend yield.",
      inputSchema: symbolSchema,
      annotations: { readOnlyHint: true },
    },
    {
      name: "get-peers",
      description: "Get peer companies in the same sector/industry.",
      inputSchema: symbolSchema,
      annotations: { readOnlyHint: true },
    },
    {
      name: "get-insider-transactions",
      description: "Get recent insider buying/selling activity.",
      inputSchema: symbolSchema,
      annotations: { readOnlyHint: true },
    },
    {
      name: "search-symbol",
      description: "Search for stock symbols by name, ticker, ISIN, or CUSIP.",
      inputSchema: searchSchema,
      annotations: { readOnlyHint: true },
    },
    // FX & Currency tools
    {
      name: "get-fx-rate",
      description: "Get live FX exchange rates for a base currency. Returns rates for all major pairs (USD, EUR, GBP, JPY, CHF, etc.).",
      inputSchema: {
        type: "object" as const,
        properties: {
          base: { type: "string" as const, description: "Base currency code e.g. USD, GBP, EUR (default: USD)" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "get-fx-candles",
      description: "Get FX price history candles for a currency pair. Resolution: 1, 5, 15, 30, 60, D, W, M.",
      inputSchema: {
        type: "object" as const,
        properties: {
          symbol: { type: "string" as const, description: "FX pair symbol e.g. OANDA:GBP_USD, OANDA:EUR_USD" },
          resolution: { type: "string" as const, description: "Candle resolution: 1, 5, 15, 30, 60, D, W, M (default: D)" },
          days: { type: "string" as const, description: "Number of days of history (default: 30)" },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    // Earnings & Calendar tools
    {
      name: "get-earnings-calendar",
      description: "Get upcoming earnings dates. Provide a symbol for one company, or leave blank for all upcoming earnings in the next 7 days.",
      inputSchema: {
        type: "object" as const,
        properties: {
          symbol: { type: "string" as const, description: "Optional: stock ticker to check specific company earnings" },
          days: { type: "string" as const, description: "Number of days ahead to check (default: 7)" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "get-ipo-calendar",
      description: "Get upcoming IPOs in the next 30 days.",
      inputSchema: {
        type: "object" as const,
        properties: {
          days: { type: "string" as const, description: "Number of days ahead (default: 30)" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    // SEC & Regulatory tools
    {
      name: "get-sec-filings",
      description: "Get recent SEC filings (10-K, 10-Q, 8-K, proxy statements) for a company.",
      inputSchema: symbolSchema,
      annotations: { readOnlyHint: true },
    },
    {
      name: "get-reported-financials",
      description: "Get reported financial statements (revenue, net income, EPS, cash flow) from SEC filings. Frequency: annual or quarterly.",
      inputSchema: {
        type: "object" as const,
        properties: {
          symbol: { type: "string" as const, description: "Stock ticker symbol" },
          freq: { type: "string" as const, description: "Frequency: annual or quarterly (default: annual)" },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "get-insider-sentiment",
      description: "Get insider sentiment (net buying/selling ratio) for a stock over a date range.",
      inputSchema: {
        type: "object" as const,
        properties: {
          symbol: { type: "string" as const, description: "Stock ticker symbol" },
          months: { type: "string" as const, description: "Number of months of history (default: 3)" },
        },
        required: ["symbol"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "prepare-add-holding",
      description: "Open an interactive form to add a new holding to the portfolio. Pre-fills any information mentioned in conversation. The user can review and edit before submitting.",
      inputSchema: prepareAddSchema,
      _meta: descriptorMeta(CRUD_FORM),
      annotations: { readOnlyHint: true },
    },
    {
      name: "prepare-update-holding",
      description: "Open an interactive form to update an existing holding in the portfolio. Pre-fills current and new values. The user can review and edit before submitting.",
      inputSchema: prepareUpdateSchema,
      _meta: descriptorMeta(CRUD_FORM),
      annotations: { readOnlyHint: true },
    },
    {
      name: "show-client-360",
      description: "Display the Client 360 View — a unified dashboard combining live market data (price, analyst consensus, news, metrics) with CRM relationship data (contacts, opportunities, activities) for one or all portfolio companies. Includes a company selector dropdown.",
      inputSchema: { type: "object" as const, properties: { symbols: { type: "string" as const, description: "Comma-separated ticker symbols (or a single ticker)" }, positions: { type: "string" as const, description: "Optional JSON positions" }, selected: { type: "string" as const, description: "Optional: pre-select this ticker in the dropdown" } }, required: ["symbols"], additionalProperties: false },
      _meta: descriptorMeta(CLIENT_360),
      annotations: { readOnlyHint: true },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  // ────── Call Tool ──────
  server.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest) => {
    const { name, arguments: rawArgs } = req.params;
    const args = rawArgs ?? {};

    switch (name) {
      case "show-portfolio-dashboard": {
        const parsed = zodParse(dashboardParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const bDashArgs = parsed;
        const tickers = bDashArgs.symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

        // Auto-fetch portfolio data from Dataverse so we don't rely on LLM passing it
        let positionsMap: Record<string, { shares: number; costPerShare: number }> = {};
        let bTypesMap: Record<string, string> = {};
        let bSectorsMap: Record<string, string> = {};
        let holdingExtras: Record<string, { CurrencyExposure?: string; FXHedged?: boolean; ComplianceStatus?: string; MarginPercent?: number }> = {};

        if (bDashArgs.positions) {
          try { positionsMap = JSON.parse(bDashArgs.positions); } catch { /* ignore */ }
        }
        if (bDashArgs.types) {
          try { bTypesMap = JSON.parse(bDashArgs.types); } catch { /* ignore */ }
        }
        if (bDashArgs.sectors) {
          try { bSectorsMap = JSON.parse(bDashArgs.sectors); } catch { /* ignore */ }
        }

        // If LLM didn't pass positions/types, read directly from Dataverse
        const needsDvFetch = Object.keys(positionsMap).length === 0 || Object.keys(bTypesMap).length === 0;
        if (needsDvFetch) {
          try {
            const dvHoldings = await dv.getAllHoldings();
            for (const h of dvHoldings) {
              const t = h.pm_ticker?.toUpperCase();
              if (!t) continue;
              // Add missing tickers (e.g. prospects the LLM skipped)
              if (!tickers.includes(t)) {
                tickers.push(t);
              }
              if (!positionsMap[t]) {
                positionsMap[t] = { shares: h.pm_shares || 0, costPerShare: h.pm_costpershare || 0 };
              }
              if (!bTypesMap[t]) {
                bTypesMap[t] = h.pm_holdingtype === 100000000 ? "Client" : "Prospect";
              }
              if (!bSectorsMap[t]) {
                bSectorsMap[t] = h.pm_sector || "";
              }
              holdingExtras[t] = {
                CurrencyExposure: h.pm_currencyexposure || "",
                FXHedged: h.pm_fxhedged || false,
                ComplianceStatus: dv.COMPLIANCE_MAP[h.pm_compliancestatus || 100000000] || "Pending",
                MarginPercent: h.pm_marginpercent || 0,
              };
            }
          } catch (err) {
            console.warn("[Dashboard] Dataverse auto-fetch failed:", (err as Error).message);
          }
        }

        // Fetch enriched data: quote + profile + recommendations + recent news + key metrics
        const today = new Date().toISOString().slice(0, 10);
        const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
        const holdings = await Promise.all(
          tickers.slice(0, 30).map(async (sym) => {
            const [q, profile, recs, news, metrics] = await Promise.all([
              finnhub.quote(sym).catch(() => ({ c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0 })),
              finnhub.companyProfile2(sym).catch(() => ({})),
              finnhub.recommendationTrends(sym).catch(() => []),
              finnhub.companyNews(sym, twoWeeksAgo, today).catch(() => []),
              finnhub.basicFinancials(sym).catch(() => ({})),
            ]);
            const p = profile as any;
            const rawMetrics = (metrics as any).metric || {};
            const newsItems = (news as any[]).slice(0, 3).map((a: any) => ({
              headline: a.headline, source: a.source, url: a.url, datetime: a.datetime,
              image: a.image, summary: (a.summary || '').slice(0, 120),
            }));
            return {
              symbol: sym,
              quote: q,
              profile: { name: p.name, ticker: p.ticker, exchange: p.exchange, finnhubIndustry: p.finnhubIndustry, logo: p.logo, weburl: p.weburl, marketCapitalization: p.marketCapitalization, country: p.country },
              recommendation: Array.isArray(recs) ? recs[0] : null,
              news: newsItems,
              metrics: { peBasicExclExtraTTM: rawMetrics.peBasicExclExtraTTM, '52WeekHigh': rawMetrics['52WeekHigh'], '52WeekLow': rawMetrics['52WeekLow'], beta: rawMetrics.beta, dividendYieldIndicatedAnnual: rawMetrics.dividendYieldIndicatedAnnual, epsBasicExclExtraItemsTTM: rawMetrics.epsBasicExclExtraItemsTTM, roeTTM: rawMetrics.roeTTM, revenueGrowthTTMYoy: rawMetrics.revenueGrowthTTMYoy },
            };
          }),
        );

        // Parse positions data if provided
        // (Already parsed above with Dataverse fallback)

        // Calculate portfolio-level metrics
        let totalCurrentValue = 0;
        let totalCostBasis = 0;
        let totalDayChange = 0;
        const enrichedHoldings = holdings.map((h) => {
          const q = h.quote as any;
          const pos = positionsMap[h.symbol];
          const shares = pos?.shares || 0;
          const costPerShare = pos?.costPerShare || 0;
          const currentValue = shares * (q?.c || 0);
          const costBasis = shares * costPerShare;
          const dayPnL = shares * (q?.d || 0);
          totalCurrentValue += currentValue;
          totalCostBasis += costBasis;
          totalDayChange += dayPnL;
          return {
            ...h,
            shares,
            costPerShare,
            currentValue,
            costBasis,
            dayPnL,
            totalReturn: costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0,
            type: bTypesMap[h.symbol] || '',
            portfolioSector: bSectorsMap[h.symbol] || '',
            ...(holdingExtras[h.symbol] || {}),
          };
        });

        const totalReturn = totalCostBasis > 0 ? ((totalCurrentValue - totalCostBasis) / totalCostBasis) * 100 : 0;
        const dayReturnPct = totalCurrentValue > 0 ? (totalDayChange / (totalCurrentValue - totalDayChange)) * 100 : 0;

        const data = {
          holdings: enrichedHoldings,
          count: enrichedHoldings.length,
          portfolio: {
            totalCurrentValue,
            totalCostBasis,
            totalDayChange,
            dayReturnPct,
            totalReturn,
            totalGainLoss: totalCurrentValue - totalCostBasis,
          },
        };
        return widgetResponse(DASHBOARD, data, `Portfolio dashboard loaded with ${holdings.length} holdings. Total value: $${totalCurrentValue.toFixed(2)}`);
      }

      case "show-stock-quote": {
        const parsed = zodParse(symbolParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { symbol } = parsed;
        const [q, profile, metrics] = await Promise.all([
          finnhub.quote(symbol),
          finnhub.companyProfile2(symbol),
          finnhub.basicFinancials(symbol),
        ]);
        const data = { symbol, quote: q, profile, metrics };
        return widgetResponse(QUOTE_CARD, data, `${symbol}: $${(q as any).c ?? "N/A"}`);
      }

      case "show-news-feed": {
        const parsed = zodParse(newsParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { category } = parsed;
        const articles = await finnhub.marketNews(category ?? "general");
        const data = { articles: (articles as any[]).slice(0, 20), category: category ?? "general" };
        return widgetResponse(NEWS_FEED, data, `${data.articles.length} market news articles loaded.`);
      }

      case "show-company-news": {
        const parsed = zodParse(companyNewsParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { symbol, from, to } = parsed;
        const articles = await finnhub.companyNews(symbol, from, to);
        const data = { articles: (articles as any[]).slice(0, 20), symbol };
        return widgetResponse(NEWS_FEED, data, `${data.articles.length} news articles for ${symbol}.`);
      }

      case "show-analyst-consensus": {
        const parsed = zodParse(symbolParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { symbol } = parsed;
        const recs = await finnhub.recommendationTrends(symbol);
        const data = { recommendations: recs, symbol };
        return widgetResponse(RECS_CHART, data, `Analyst recommendations for ${symbol} loaded.`);
      }

      case "show-morning-briefing": {
        const parsed = zodParse(briefingParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const bArgs = parsed;
        const today = new Date().toISOString().slice(0, 10);
        const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
        let prospectTickers = (bArgs.prospects || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
        let clientTickers = (bArgs.clients || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

        // Auto-fetch from Dataverse if LLM didn't pass tickers
        if (prospectTickers.length === 0 && clientTickers.length === 0) {
          try {
            const dvHoldings = await dv.getAllHoldings();
            for (const h of dvHoldings) {
              const t = h.pm_ticker?.toUpperCase();
              if (!t) continue;
              if (h.pm_holdingtype === 100000000) {
                clientTickers.push(t);
              } else {
                prospectTickers.push(t);
              }
            }
            console.log(`[Briefing] Auto-fetched from Dataverse: ${clientTickers.length} clients, ${prospectTickers.length} prospects`);
          } catch (err) {
            console.warn("[Briefing] Dataverse auto-fetch failed:", (err as Error).message);
          }
        }

        // Fetch industry news (financial services / wealth / AI focus)
        const industryNews = ((await finnhub.marketNews("general")) as any[]).slice(0, 12);

        // Helper: fetch enriched company data (profile + quote + news)
        async function fetchCompany(sym: string) {
          const [profile, q, news] = await Promise.all([
            finnhub.companyProfile2(sym).catch(() => ({})),
            finnhub.quote(sym).catch(() => ({})),
            finnhub.companyNews(sym, twoWeeksAgo, today).catch(() => []),
          ]);
          const p = profile as any;
          const quote = q as any;
          return {
            symbol: sym,
            name: p.name || sym,
            industry: p.finnhubIndustry || "",
            logo: p.logo || "",
            weburl: p.weburl || "",
            price: quote.c || null,
            prevClose: quote.pc || null,
            changePercent: quote.dp || null,
            news: (news as any[]).slice(0, 4).map((a: any) => ({
              headline: a.headline, source: a.source, url: a.url,
              datetime: a.datetime, summary: (a.summary || '').slice(0, 100),
            })),
          };
        }

        const prospects = await Promise.all(prospectTickers.map(fetchCompany));
        const clients = await Promise.all(clientTickers.map(fetchCompany));

        // C-Suite news — filter for leadership keywords
        const csuiteKeywords = /ceo|cfo|cto|chief|appoint|resign|depart|executive|board|director|leadership|hire|step.?down|successor/i;
        const allCompanyNews = [...prospects, ...clients].flatMap((c) => c.news || []);
        const csuiteNews = allCompanyNews.filter((a: any) => csuiteKeywords.test(a.headline || "") || csuiteKeywords.test(a.summary || "")).slice(0, 10);

        // FNZ news — search multiple terms
        const fnzNewsRaw = await finnhub.companyNews("FNZ.L", twoWeeksAgo, today).catch(() => []);
        const fnzNews = (fnzNewsRaw as any[]).slice(0, 8);

        const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
        const briefingData = {
          date: dateStr,
          industryNews,
          prospects,
          clients,
          csuiteNews,
          fnzNews,
          commentary: "",
        };

        const pWithNews = prospects.filter((p) => p.news.length > 0).length;
        const cWithNews = clients.filter((c) => c.news.length > 0).length;

        return widgetResponse(BRIEFING, briefingData, `Morning Briefing for ${dateStr}: ${clients.length} clients, ${prospects.length} prospects. ${cWithNews}/${clients.length} clients have material news. ${csuiteNews.length} C-suite moves detected. Top movers: ${[...clients, ...prospects].sort((a: any, b: any) => Math.abs(b.changePercent || 0) - Math.abs(a.changePercent || 0)).slice(0, 3).map((c: any) => `${c.symbol} ${(c.changePercent || 0) >= 0 ? '+' : ''}${(c.changePercent || 0).toFixed(1)}%`).join(', ')}. Write a 3-4 paragraph executive commentary below the widget covering: (1) key themes across the portfolio today, (2) any client positions requiring attention, (3) prospect timing signals, and (4) recommended actions for the day.`);
      }

      case "show-stress-test":
      case "show-concentration-risk":
      case "show-relative-value":
      case "show-rv-shifts":
      case "show-challenge-holdings":
      case "show-benchmark-comparison": {
        const parsed = zodParse(dashboardParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const dashArgs = parsed;
        const tickers = dashArgs.symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

        // Auto-fetch from Dataverse (same pattern as dashboard)
        let positionsMap: Record<string, { shares: number; costPerShare: number }> = {};
        let typesMap: Record<string, string> = {};
        let sectorsMap: Record<string, string> = {};
        if (dashArgs.positions) {
          try { positionsMap = JSON.parse(dashArgs.positions); } catch { /* ignore */ }
        }
        if (dashArgs.types) {
          try { typesMap = JSON.parse(dashArgs.types); } catch { /* ignore */ }
        }
        if (dashArgs.sectors) {
          try { sectorsMap = JSON.parse(dashArgs.sectors); } catch { /* ignore */ }
        }
        if (Object.keys(positionsMap).length === 0 || Object.keys(typesMap).length === 0) {
          try {
            const dvHoldings = await dv.getAllHoldings();
            for (const h of dvHoldings) {
              const t = h.pm_ticker?.toUpperCase();
              if (!t) continue;
              if (!positionsMap[t]) positionsMap[t] = { shares: h.pm_shares || 0, costPerShare: h.pm_costpershare || 0 };
              if (!typesMap[t]) typesMap[t] = h.pm_holdingtype === 100000000 ? "Client" : "Prospect";
              if (!sectorsMap[t]) sectorsMap[t] = h.pm_sector || "";
            }
          } catch (err) { console.warn("[StressTest] Dataverse auto-fetch failed:", (err as Error).message); }
        }

        const today = new Date().toISOString().slice(0, 10);
        const holdings = await Promise.all(
          tickers.slice(0, 30).map(async (sym) => {
            const [q, profile, recs, metrics] = await Promise.all([
              finnhub.quote(sym).catch(() => ({ c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0 })),
              finnhub.companyProfile2(sym).catch(() => ({})),
              finnhub.recommendationTrends(sym).catch(() => []),
              finnhub.basicFinancials(sym).catch(() => ({})),
            ]);
            return {
              symbol: sym,
              quote: q,
              profile,
              recommendation: Array.isArray(recs) ? recs[0] : null,
              metrics: (metrics as any).metric || {},
            };
          }),
        );

        let totalCurrentValue = 0;
        let totalCostBasis = 0;
        const enrichedHoldings = holdings.map((h) => {
          const q = h.quote as any;
          const pos = positionsMap[h.symbol];
          const shares = pos?.shares || 0;
          const costPerShare = pos?.costPerShare || 0;
          const currentValue = shares * (q?.c || 0);
          const costBasis = shares * costPerShare;
          totalCurrentValue += currentValue;
          totalCostBasis += costBasis;
          return {
            ...h,
            shares,
            costPerShare,
            currentValue,
            costBasis,
            totalReturn: costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0,
            type: typesMap[h.symbol] || '',
            portfolioSector: sectorsMap[h.symbol] || '',
          };
        });

        const data = {
          holdings: enrichedHoldings,
          count: enrichedHoldings.length,
          portfolio: { totalCurrentValue, totalCostBasis },
        };

        const widgetMap: Record<string, Widget> = {
          "show-stress-test": STRESS_TEST,
          "show-concentration-risk": CONCENTRATION_RISK,
          "show-relative-value": RELATIVE_VALUE,
          "show-rv-shifts": RV_SHIFT,
          "show-challenge-holdings": CHALLENGE_HOLDINGS,
          "show-benchmark-comparison": BENCHMARK_COMPARISON,
        };
        const widget = widgetMap[name];
        const labels: Record<string, string> = {
          "show-stress-test": "Stress test",
          "show-concentration-risk": "Concentration risk analysis",
          "show-relative-value": "Relative value analysis",
          "show-rv-shifts": "RV shift detection",
          "show-challenge-holdings": "Holdings challenge",
          "show-benchmark-comparison": "Benchmark comparison",
        };
        return widgetResponse(widget, data, `${labels[name]} loaded with ${holdings.length} holdings.`);
      }

      case "get-basic-financials": {
        const parsed = zodParse(symbolParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { symbol } = parsed;
        const data = await finnhub.basicFinancials(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      case "get-peers": {
        const parsed = zodParse(symbolParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { symbol } = parsed;
        const data = await finnhub.peers(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
      }

      case "get-insider-transactions": {
        const parsed = zodParse(symbolParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { symbol } = parsed;
        const data = await finnhub.insiderTransactions(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      case "search-symbol": {
        const parsed = zodParse(searchParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { query } = parsed;
        const data = await finnhub.symbolLookup(query);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      // ── FX & Currency tools ──
      case "get-fx-rate": {
        const base = (args as any).base || "USD";
        const data = await finnhub.forexRates(base);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      case "get-fx-candles": {
        const symbol = (args as any).symbol;
        const resolution = (args as any).resolution || "D";
        const days = parseInt((args as any).days || "30", 10);
        const to = Math.floor(Date.now() / 1000);
        const from = to - days * 86400;
        const data = await finnhub.forexCandles(symbol, resolution, from, to);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      // ── Earnings & Calendar tools ──
      case "get-earnings-calendar": {
        const sym = (args as any).symbol;
        const days = parseInt((args as any).days || "7", 10);
        let data;
        if (sym) {
          data = await finnhub.earningsCalendarSymbol(sym);
        } else {
          const from = new Date().toISOString().slice(0, 10);
          const to = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
          data = await finnhub.earningsCalendarRange(from, to);
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      case "get-ipo-calendar": {
        const days = parseInt((args as any).days || "30", 10);
        const from = new Date().toISOString().slice(0, 10);
        const to = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
        const data = await finnhub.ipoCalendarRange(from, to);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      // ── SEC & Regulatory tools ──
      case "get-sec-filings": {
        const parsed = zodParse(symbolParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { symbol } = parsed;
        const data = await finnhub.filings(symbol);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      case "get-reported-financials": {
        const symbol = (args as any).symbol;
        const freq = (args as any).freq || "annual";
        const data = await finnhub.financialsReported(symbol, freq);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      case "get-insider-sentiment": {
        const symbol = (args as any).symbol;
        const months = parseInt((args as any).months || "3", 10);
        const to = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - months * 30 * 86400000).toISOString().slice(0, 10);
        const data = await finnhub.insiderSentiment(symbol, from, to);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      case "prepare-add-holding": {
        const parsed = zodParse(prepareAddParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const addArgs = parsed;
        const formData = {
          mode: "add",
          company: addArgs.company || '',
          ticker: addArgs.ticker || '',
          sector: addArgs.sector || '',
          holdingType: addArgs.holdingType || (addArgs.shares === '0' ? 'Prospect' : 'Client'),
          shares: addArgs.shares || '0',
          costPerShare: addArgs.costPerShare || '0',
          totalCost: addArgs.totalCost || '0',
          website: addArgs.website || (addArgs.ticker ? `www.${(addArgs.company || addArgs.ticker || '').toLowerCase().replace(/[^a-z]/g, '')}.com` : ''),
          mediaPress: addArgs.mediaPress || addArgs.website || (addArgs.ticker ? `www.${(addArgs.company || addArgs.ticker || '').toLowerCase().replace(/[^a-z]/g, '')}.com/press` : ''),
          currencyExposure: addArgs.currencyExposure || '',
        };
        return widgetResponse(CRUD_FORM, formData, `Add holding form ready${addArgs.ticker ? ` for ${addArgs.ticker}` : ""}.`);
      }

      case "prepare-update-holding": {
        const parsed = zodParse(prepareUpdateParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const updArgs = parsed;
        const formData = {
          mode: "update",
          ticker: updArgs.ticker,
          company: updArgs.company || '',
          currentRow: updArgs.currentRow || '',
          sector: updArgs.sector || '',
          holdingType: updArgs.holdingType || '',
          shares: updArgs.shares || '',
          costPerShare: updArgs.costPerShare || '',
          totalCost: updArgs.totalCost || '',
          website: updArgs.website || '',
          mediaPress: updArgs.mediaPress || '',
          currencyExposure: updArgs.currencyExposure || '',
          fxHedged: updArgs.fxHedged || '',
          revenueAttributed: updArgs.revenueAttributed || '',
          marginPercent: updArgs.marginPercent || '',
        };
        return widgetResponse(CRUD_FORM, formData, `Update form ready for ${updArgs.ticker}.`);
      }

      case "show-client-360": {
        const c360Schema = z.object({ symbols: z.string(), positions: z.string().optional(), selected: z.string().optional() });
        const parsed = zodParse(c360Schema, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const c360Args = parsed;
        const tickers = c360Args.symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
        const today = new Date().toISOString().slice(0, 10);
        const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);

        let positionsMap: Record<string, { shares: number; costPerShare: number }> = {};
        if (c360Args.positions) { try { positionsMap = JSON.parse(c360Args.positions); } catch { /* ignore */ } }

        const companies = await Promise.all(tickers.slice(0, 25).map(async (sym) => {
          const [q, profile, recs, news, metrics] = await Promise.all([
            finnhub.quote(sym).catch(() => ({ c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0 })),
            finnhub.companyProfile2(sym).catch(() => ({})),
            finnhub.recommendationTrends(sym).catch(() => []),
            finnhub.companyNews(sym, twoWeeksAgo, today).catch(() => []),
            finnhub.basicFinancials(sym).catch(() => ({})),
          ]);
          const p = profile as any;
          const rawMetrics = (metrics as any).metric || {};

          // CRM data
          let crmData: any = { account: {}, contacts: [], opportunities: [], activities: [] };
          try {
            const account = await crm.getAccountByTicker(sym);
            if (account) {
              const [contacts, opportunities, activities] = await Promise.all([
                crm.getContactsForAccount(account.accountid),
                crm.getOpportunitiesForAccount(account.accountid),
                crm.getActivitiesForAccount(account.accountid).catch(() => []),
              ]);
              crmData = {
                account: { id: account.accountid, name: account.name, ticker: account.tickersymbol, revenue: account.revenue, industry: account.industrycode, type: account.customertypecode === 3 ? "Client" : "Prospect", city: account.address1_city, country: account.address1_country, website: account.websiteurl, description: account.description },
                contacts: contacts.map((c: any) => ({ id: c.contactid, name: c.fullname, title: c.jobtitle, email: c.emailaddress1, phone: c.telephone1 })),
                opportunities: opportunities.map((o: any) => ({ id: o.opportunityid, name: o.name, value: o.estimatedvalue, stage: o.stepname, closeDate: o.estimatedclosedate, description: o.description })),
                activities: activities.map((a: any) => ({ id: a.activityid, subject: a.subject, type: a.activitytypecode, date: a.scheduledstart })),
              };
            }
          } catch { /* CRM unavailable — continue with market data only */ }

          const pos = positionsMap[sym];
          const shares = pos?.shares || 0;
          const costPerShare = pos?.costPerShare || 0;
          const currentValue = shares * ((q as any).c || 0);
          const costBasis = shares * costPerShare;

          return {
            symbol: sym, quote: q,
            profile: { name: p.name, ticker: p.ticker, exchange: p.exchange, finnhubIndustry: p.finnhubIndustry, logo: p.logo, weburl: p.weburl, marketCapitalization: p.marketCapitalization },
            recommendation: Array.isArray(recs) ? recs[0] : null,
            news: (news as any[]).slice(0, 3).map((a: any) => ({ headline: a.headline, source: a.source, url: a.url, datetime: a.datetime })),
            metrics: { peBasicExclExtraTTM: rawMetrics.peBasicExclExtraTTM, '52WeekHigh': rawMetrics['52WeekHigh'], '52WeekLow': rawMetrics['52WeekLow'], beta: rawMetrics.beta, dividendYieldIndicatedAnnual: rawMetrics.dividendYieldIndicatedAnnual, epsBasicExclExtraItemsTTM: rawMetrics.epsBasicExclExtraItemsTTM },
            shares, costPerShare, currentValue, costBasis,
            totalReturn: costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0,
            crm: crmData,
          };
        }));

        const data = { companies, selectedSymbol: c360Args.selected?.toUpperCase() || (tickers.length === 1 ? tickers[0] : undefined) };
        return widgetResponse(CLIENT_360, data, `Client 360 loaded for ${companies.length} companies.`);
      }

      default:
        return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }], isError: true };
    }
  });

  return server;
}
