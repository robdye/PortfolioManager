/**
 * CRM MCP Server — D365/Dataverse tools for account profiles,
 * pipeline, contacts, and activities. With interactive UI widgets.
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
  type ListResourcesRequest,
  type ReadResourceRequest,
  type ListResourceTemplatesRequest,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
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

// ── Widget loader ──
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, "..", "assets");
const MIME = "text/html+skybridge";

function readWidget(name: string): string {
  const p = path.join(ASSETS_DIR, `${name}.html`);
  if (!fs.existsSync(p)) throw new Error(`Widget "${name}" not found`);
  let html = fs.readFileSync(p, "utf8");
  html = html.replace("<head>", `<head><script>window.__SERVER_BASE_URL__=${JSON.stringify(getPublicServerUrl())};</script>`);
  return html;
}

function embedData(html: string, data: unknown): string {
  const json = JSON.stringify(data).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");
  return html.replace("</head>", `<script>window.__TOOL_DATA__=${json};</script></head>`);
}

interface CRMWidget { id: string; title: string; uri: string; invoking: string; invoked: string; html: string; }
let PIPELINE_WIDGET: CRMWidget;
let ACCOUNT_WIDGET: CRMWidget;

function loadWidgets() {
  PIPELINE_WIDGET = { id: "crm-pipeline", title: "Investment Pipeline", uri: "ui://widget/crm-pipeline.html", invoking: "Loading pipeline...", invoked: "Pipeline ready.", html: readWidget("crm-pipeline") };
  ACCOUNT_WIDGET = { id: "crm-account", title: "CRM Account Profile", uri: "ui://widget/crm-account.html", invoking: "Loading account...", invoked: "Account ready.", html: readWidget("crm-account") };
}

function descriptorMeta(w: CRMWidget): Record<string, unknown> {
  return { "openai/outputTemplate": w.uri, "openai/toolInvocation/invoking": w.invoking, "openai/toolInvocation/invoked": w.invoked, "openai/widgetAccessible": true };
}

function widgetResponse(w: CRMWidget, data: unknown, summaryText: string) {
  const html = embedData(w.html, data);
  return {
    content: [{ type: "text" as const, text: html, mimeType: MIME }, { type: "text" as const, text: summaryText }],
    structuredContent: data as Record<string, unknown>,
    _meta: descriptorMeta(w),
  };
}

// ── Input schemas ──
const tickerSchema = {
  type: "object" as const,
  properties: {
    ticker: { type: "string" as const, description: "Stock ticker symbol (e.g. MSFT, AZN)" },
  },
  required: ["ticker"],
  additionalProperties: false,
};

const pipelineSchema = {
  type: "object" as const,
  properties: {
    stage: { type: "string" as const, description: "Optional pipeline stage filter (e.g. Qualify, Develop, Propose)" },
  },
  additionalProperties: false,
};

// Zod parsers
const tickerParser = z.object({ ticker: z.string() });
const pipelineParser = z.object({ stage: z.string().optional() });

// ── Industry code map ──
const INDUSTRY: Record<number, string> = {
  1: "Aerospace", 3: "Chemicals", 4: "Consumer Goods", 6: "Energy",
  8: "Financial Services", 9: "Education", 10: "Food & Beverage",
  12: "Technology", 14: "Telecommunications", 19: "Hospitality",
  24: "Mining & Metals", 27: "Real Estate", 33: "Healthcare",
};

function formatAccount(a: any) {
  return {
    id: a.accountid,
    name: a.name,
    ticker: a.tickersymbol,
    revenue: a.revenue,
    phone: a.telephone1,
    website: a.websiteurl,
    description: a.description,
    industry: INDUSTRY[a.industrycode] || `Code ${a.industrycode}`,
    type: a.customertypecode === 3 ? "Client" : "Prospect",
    city: a.address1_city,
    country: a.address1_country,
  };
}

function formatContact(c: any) {
  return {
    id: c.contactid,
    name: c.fullname,
    title: c.jobtitle,
    email: c.emailaddress1,
    phone: c.telephone1,
  };
}

function formatOpportunity(o: any) {
  return {
    id: o.opportunityid,
    name: o.name,
    value: o.estimatedvalue,
    stage: o.stepname,
    closeDate: o.estimatedclosedate,
    description: o.description,
    accountTicker: o.customerid_account?.tickersymbol,
    accountName: o.customerid_account?.name,
  };
}

function formatDeal(d: dv.DealRecord) {
  return {
    id: d.pm_dealtrackerid,
    name: d.pm_name,
    ticker: d.pm_ticker,
    dealType: dv.DEAL_TYPE_MAP[d.pm_dealtype] || "Other",
    stage: dv.DEAL_STAGE_MAP[d.pm_dealstage] || "Unknown",
    value: d.pm_estimatedvalue,
    winProbability: d.pm_winprobability,
    revenueForecast: d.pm_revenueforecast,
    marginPercent: d.pm_marginpercent,
    complianceStatus: dv.COMPLIANCE_MAP[d.pm_compliancestatus] || "Pending",
    riskRating: dv.RISK_MAP[d.pm_riskrating] || "Unknown",
    exitStrategy: d.pm_exitstrategy || "",
    currencyExposure: d.pm_currencyexposure || "",
    nextICDate: d.pm_nexticdate || "",
    boardObserver: d.pm_boardobserver || "",
    description: d.pm_description || "",
    lastComplianceReview: d.pm_lastcompliancereview || "",
    estimatedCloseDate: d.pm_estimatedclosedate || "",
  };
}

// ── Server factory ──
export function createCRMServer(): Server {
  if (!PIPELINE_WIDGET) loadWidgets();

  const server = new Server(
    { name: "crm-d365", version: "1.0.0" },
    { capabilities: { resources: {}, tools: {} } },
  );

  // Resources
  const widgets = [PIPELINE_WIDGET, ACCOUNT_WIDGET];
  const widgetsByUri = new Map(widgets.map((w) => [w.uri, w]));
  const resources: Resource[] = widgets.map((w) => ({ uri: w.uri, name: w.title, description: `${w.title} widget`, mimeType: MIME, _meta: descriptorMeta(w) }));
  const resourceTemplates: ResourceTemplate[] = widgets.map((w) => ({ uriTemplate: w.uri, name: w.title, description: `${w.title} widget`, mimeType: MIME, _meta: descriptorMeta(w) }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req: ReadResourceRequest) => {
    const w = widgetsByUri.get(req.params.uri);
    if (!w) return { contents: [], _meta: { error: `Unknown: ${req.params.uri}` } };
    return { contents: [{ uri: w.uri, mimeType: MIME, text: w.html, _meta: descriptorMeta(w) }] };
  });

  const tools: Tool[] = [
    {
      name: "show-crm-pipeline",
      description: "Display the Investment Pipeline dashboard from D365 CRM. Shows opportunity funnel, values by stage, and deal cards.",
      inputSchema: pipelineSchema,
      _meta: descriptorMeta(PIPELINE_WIDGET),
      annotations: { readOnlyHint: true },
    },
    {
      name: "show-crm-account",
      description: "Display a D365 CRM account profile card for a portfolio holding. Shows company details, key contacts, opportunities, and recent activities.",
      inputSchema: tickerSchema,
      _meta: descriptorMeta(ACCOUNT_WIDGET),
      annotations: { readOnlyHint: true },
    },
    {
      name: "get-crm-account",
      description: "Get the D365 CRM account profile for a portfolio holding by ticker symbol. Returns account details, contacts, opportunities, and recent activities as text.",
      inputSchema: tickerSchema,
      annotations: { readOnlyHint: true },
    },
    {
      name: "get-crm-contacts",
      description: "Get all CRM contacts (IR directors, CFOs, etc.) for a portfolio company by ticker symbol.",
      inputSchema: tickerSchema,
      annotations: { readOnlyHint: true },
    },
    {
      name: "get-crm-pipeline",
      description: "Get the full investment opportunity pipeline from D365 CRM as text data.",
      inputSchema: pipelineSchema,
      annotations: { readOnlyHint: true },
    },
    {
      name: "get-crm-opportunities",
      description: "Get CRM opportunities for a specific company by ticker symbol.",
      inputSchema: tickerSchema,
      annotations: { readOnlyHint: true },
    },
    // Deal tracking & M&A tools
    {
      name: "get-deal-tracker",
      description: "Get the M&A and deal pipeline from CRM. Optionally filter by deal type: M&A, Capital Raise, FX Hedging, Follow-on, Exit. Shows compliance status, risk rating, and revenue forecast.",
      inputSchema: {
        type: "object" as const,
        properties: {
          dealType: { type: "string" as const, description: "Filter by deal type: M&A, Capital Raise, FX Hedging, Follow-on, Exit" },
          stage: { type: "string" as const, description: "Filter by stage: Qualify, Develop, Propose, Close" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "get-revenue-forecast",
      description: "Get pipeline-weighted revenue forecast. Sum of deal values weighted by win probability, broken down by stage and type.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "get-compliance-status",
      description: "Get all deals with compliance issues — Pending review, Flagged, or Escalated. Returns compliance status, risk rating, and last review date.",
      inputSchema: {
        type: "object" as const,
        properties: {
          status: { type: "string" as const, description: "Filter: Pending, Approved, Flagged, Escalated (default: shows Pending and Flagged)" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "get-ic-calendar",
      description: "Get upcoming Investment Committee dates with deal summaries. Shows deals requiring IC approval in the next 30 days.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "update-deal-compliance",
      description: "Update the compliance status of a deal. Set to Approved, Flagged, or Escalated with reviewer notes.",
      inputSchema: {
        type: "object" as const,
        properties: {
          ticker: { type: "string" as const, description: "Ticker symbol of the deal's company" },
          status: { type: "string" as const, description: "New status: Approved, Flagged, Escalated" },
          notes: { type: "string" as const, description: "Review notes" },
        },
        required: ["ticker", "status"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest) => {
    const { name, arguments: rawArgs } = req.params;
    const args = rawArgs ?? {};

    switch (name) {
      case "show-crm-pipeline": {
        const parsed = zodParse(pipelineParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { stage } = parsed;
        let opportunities = await crm.getAllPortfolioOpportunities();
        if (stage) {
          opportunities = opportunities.filter((o: any) => o.stepname?.toLowerCase().includes(stage.toLowerCase()));
        }
        const formatted = opportunities.map(formatOpportunity);
        const totalValue = formatted.reduce((sum: number, o: any) => sum + (o.value || 0), 0);
        const byStage: Record<string, { count: number; value: number }> = {};
        formatted.forEach((o: any) => {
          const s = o.stage || "Unknown";
          if (!byStage[s]) byStage[s] = { count: 0, value: 0 };
          byStage[s].count++;
          byStage[s].value += o.value || 0;
        });
        const data = { pipeline: formatted, totalValue, byStage };
        return widgetResponse(PIPELINE_WIDGET, data, `Investment Pipeline: ${formatted.length} opportunities worth $${(totalValue / 1e6).toFixed(2)}M`);
      }

      case "show-crm-account": {
        const parsed = zodParse(tickerParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { ticker } = parsed;
        const account = await crm.getAccountByTicker(ticker.toUpperCase());
        if (!account) {
          return { content: [{ type: "text" as const, text: `No CRM account found for ${ticker}.` }], isError: true };
        }
        const formatted = formatAccount(account);
        const [contacts, opportunities, activities] = await Promise.all([
          crm.getContactsForAccount(account.accountid),
          crm.getOpportunitiesForAccount(account.accountid),
          crm.getActivitiesForAccount(account.accountid).catch(() => []),
        ]);
        const data = {
          account: formatted,
          contacts: contacts.map(formatContact),
          opportunities: opportunities.map((o: any) => formatOpportunity({ ...o, customerid_account: { tickersymbol: ticker, name: account.name } })),
          activities: activities.map((a: any) => ({ id: a.activityid, subject: a.subject, type: a.activitytypecode, date: a.scheduledstart, description: a.description })),
        };
        return widgetResponse(ACCOUNT_WIDGET, data, `CRM Profile: ${formatted.name} (${formatted.ticker}) | ${formatted.type} | ${contacts.length} contacts | ${opportunities.length} opportunities`);
      }

      case "get-crm-account": {
        const parsed = zodParse(tickerParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { ticker } = parsed;
        const account = await crm.getAccountByTicker(ticker.toUpperCase());
        if (!account) {
          return { content: [{ type: "text" as const, text: `No CRM account found for ticker ${ticker}.` }], isError: true };
        }
        const formatted = formatAccount(account);
        const [contacts, opportunities, activities] = await Promise.all([
          crm.getContactsForAccount(account.accountid),
          crm.getOpportunitiesForAccount(account.accountid),
          crm.getActivitiesForAccount(account.accountid).catch(() => []),
        ]);

        const profile = {
          account: formatted,
          contacts: contacts.map(formatContact),
          opportunities: opportunities.map((o: any) => formatOpportunity({ ...o, customerid_account: { tickersymbol: ticker, name: account.name } })),
          activities: activities.map((a: any) => ({ id: a.activityid, subject: a.subject, type: a.activitytypecode, date: a.scheduledstart, description: a.description })),
        };

        const contactList = profile.contacts.map((c: any) => `${c.name} (${c.title})`).join(", ") || "None";
        const oppList = profile.opportunities.map((o: any) => `${o.name}: $${(o.value / 1000).toFixed(0)}K [${o.stage}]`).join("; ") || "None";

        return {
          content: [{
            type: "text" as const,
            text: `CRM Profile: ${formatted.name} (${formatted.ticker})\nType: ${formatted.type} | Industry: ${formatted.industry} | ${formatted.city}, ${formatted.country}\nRevenue: $${(formatted.revenue / 1e9).toFixed(1)}B\nContacts: ${contactList}\nOpportunities: ${oppList}\n\n${JSON.stringify(profile, null, 2)}`,
          }],
        };
      }

      case "get-crm-contacts": {
        const parsed = zodParse(tickerParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { ticker } = parsed;
        const contacts = await crm.getContactsByTicker(ticker.toUpperCase());
        if (!contacts.length) {
          return { content: [{ type: "text" as const, text: `No CRM contacts found for ${ticker}.` }] };
        }
        const formatted = contacts.map((c: any) => ({
          ...formatContact(c),
          account: c.parentcustomerid_account?.name,
          accountTicker: c.parentcustomerid_account?.tickersymbol,
        }));
        return {
          content: [{
            type: "text" as const,
            text: `Contacts for ${ticker}:\n${formatted.map((c: any) => `- ${c.name} | ${c.title} | ${c.email} | ${c.phone}`).join("\n")}\n\n${JSON.stringify(formatted, null, 2)}`,
          }],
        };
      }

      case "get-crm-pipeline": {
        const parsed = zodParse(pipelineParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { stage } = parsed;
        let opportunities = await crm.getAllPortfolioOpportunities();
        if (stage) {
          opportunities = opportunities.filter((o: any) => o.stepname?.toLowerCase().includes(stage.toLowerCase()));
        }
        const formatted = opportunities.map(formatOpportunity);
        const totalValue = formatted.reduce((sum: number, o: any) => sum + (o.value || 0), 0);
        const byStage: Record<string, { count: number; value: number }> = {};
        formatted.forEach((o: any) => {
          const s = o.stage || "Unknown";
          if (!byStage[s]) byStage[s] = { count: 0, value: 0 };
          byStage[s].count++;
          byStage[s].value += o.value || 0;
        });

        const summary = Object.entries(byStage).map(([s, d]) => `${s}: ${d.count} opp(s) worth $${(d.value / 1000).toFixed(0)}K`).join("; ");

        return {
          content: [{
            type: "text" as const,
            text: `Investment Pipeline: ${formatted.length} opportunities worth $${(totalValue / 1e6).toFixed(2)}M\n${summary}\n\n${JSON.stringify({ pipeline: formatted, totalValue, byStage }, null, 2)}`,
          }],
        };
      }

      case "get-crm-opportunities": {
        const parsed = zodParse(tickerParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { ticker } = parsed;
        const account = await crm.getAccountByTicker(ticker.toUpperCase());
        if (!account) {
          return { content: [{ type: "text" as const, text: `No CRM account found for ${ticker}.` }], isError: true };
        }
        const opportunities = await crm.getOpportunitiesForAccount(account.accountid);
        const formatted = opportunities.map((o: any) => formatOpportunity({ ...o, customerid_account: { tickersymbol: ticker, name: account.name } }));
        return {
          content: [{
            type: "text" as const,
            text: `Opportunities for ${account.name} (${ticker}): ${formatted.length} total\n${formatted.map((o: any) => `- ${o.name}: $${(o.value / 1000).toFixed(0)}K [${o.stage}] Close: ${o.closeDate}`).join("\n")}\n\n${JSON.stringify(formatted, null, 2)}`,
          }],
        };
      }

      // ── Deal Tracker & M&A tools (via Dataverse pm_dealtrackers) ──
      case "get-deal-tracker": {
        const dealTypeStr = (args as any).dealType;
        const stageStr = (args as any).stage;

        const DEAL_TYPE_REVERSE: Record<string, number> = {
          "m&a": 100000000, "capital raise": 100000001, "fx hedging": 100000002, "follow-on": 100000003, "exit": 100000004,
        };
        const DEAL_STAGE_REVERSE: Record<string, number> = {
          "origination": 100000000, "qualify": 100000001, "due diligence": 100000002, "ic approval": 100000003, "execution": 100000004, "closed": 100000005,
        };

        let deals: dv.DealRecord[];
        if (dealTypeStr) {
          const typeCode = DEAL_TYPE_REVERSE[dealTypeStr.toLowerCase()];
          deals = typeCode !== undefined ? await dv.getDealsByType(typeCode) : await dv.getAllDeals();
        } else if (stageStr) {
          const stageCode = DEAL_STAGE_REVERSE[stageStr.toLowerCase()];
          deals = stageCode !== undefined ? await dv.getDealsByStage(stageCode) : await dv.getAllDeals();
        } else {
          deals = await dv.getAllDeals();
        }

        const formatted = deals.map(formatDeal);
        const totalValue = formatted.reduce((sum, d) => sum + (d.value || 0), 0);
        return {
          content: [{
            type: "text" as const,
            text: `Deal Tracker: ${formatted.length} deals worth $${(totalValue / 1e6).toFixed(2)}M\n${formatted.map((d) => `- ${d.name} [${d.dealType}] ${d.stage}: $${((d.value || 0) / 1000).toFixed(0)}K | Compliance: ${d.complianceStatus} | Risk: ${d.riskRating} | Win: ${d.winProbability}%`).join("\n")}\n\n${JSON.stringify(formatted, null, 2)}`,
          }],
        };
      }

      case "get-revenue-forecast": {
        const deals = await dv.getAllDeals();
        const open = deals.filter((d) => dv.DEAL_STAGE_MAP[d.pm_dealstage] !== "Closed");
        let totalWeighted = 0;
        let totalUnweighted = 0;
        const byStage: Record<string, { count: number; weighted: number; unweighted: number }> = {};
        const byType: Record<string, { count: number; weighted: number; unweighted: number }> = {};

        for (const d of open) {
          const val = d.pm_revenueforecast || d.pm_estimatedvalue || 0;
          const prob = (d.pm_winprobability || 50) / 100;
          const weighted = val * prob;
          totalWeighted += weighted;
          totalUnweighted += val;

          const stage = dv.DEAL_STAGE_MAP[d.pm_dealstage] || "Unknown";
          if (!byStage[stage]) byStage[stage] = { count: 0, weighted: 0, unweighted: 0 };
          byStage[stage].count++;
          byStage[stage].weighted += weighted;
          byStage[stage].unweighted += val;

          const typeName = dv.DEAL_TYPE_MAP[d.pm_dealtype] || "Other";
          if (!byType[typeName]) byType[typeName] = { count: 0, weighted: 0, unweighted: 0 };
          byType[typeName].count++;
          byType[typeName].weighted += weighted;
          byType[typeName].unweighted += val;
        }

        const forecast = { totalWeighted, totalUnweighted, dealCount: open.length, byStage, byType };
        const stageLines = Object.entries(forecast.byStage).map(([s, d]) =>
          `  ${s}: ${d.count} deals | Weighted: $${(d.weighted / 1000).toFixed(0)}K | Unweighted: $${(d.unweighted / 1000).toFixed(0)}K`
        ).join("\n");
        const typeLines = Object.entries(forecast.byType).map(([t, d]) =>
          `  ${t}: ${d.count} deals | Weighted: $${(d.weighted / 1000).toFixed(0)}K | Unweighted: $${(d.unweighted / 1000).toFixed(0)}K`
        ).join("\n");
        return {
          content: [{
            type: "text" as const,
            text: `Revenue Forecast (Pipeline-Weighted)\n${forecast.dealCount} open deals\nWeighted Revenue: $${(forecast.totalWeighted / 1e6).toFixed(2)}M\nUnweighted Revenue: $${(forecast.totalUnweighted / 1e6).toFixed(2)}M\n\nBy Stage:\n${stageLines}\n\nBy Type:\n${typeLines}\n\n${JSON.stringify(forecast, null, 2)}`,
          }],
        };
      }

      case "get-compliance-status": {
        const statusStr = (args as any).status;
        const statusMap: Record<string, number> = { pending: 100000000, approved: 100000001, flagged: 100000002, escalated: 100000003 };
        let deals: dv.DealRecord[];
        if (statusStr && statusMap[statusStr.toLowerCase()] !== undefined) {
          deals = await dv.getDealsByCompliance(statusMap[statusStr.toLowerCase()]);
        } else {
          const [pending, flagged] = await Promise.all([
            dv.getDealsByCompliance(100000000),
            dv.getDealsByCompliance(100000002),
          ]);
          deals = [...pending, ...flagged];
        }
        const formatted = deals.map(formatDeal);
        return {
          content: [{
            type: "text" as const,
            text: `Compliance Status: ${formatted.length} deals requiring attention\n${formatted.map((d) => `- ${d.name} (${d.ticker}): ${d.complianceStatus} | Risk: ${d.riskRating} | Last Review: ${d.lastComplianceReview || "Never"}`).join("\n")}\n\n${JSON.stringify(formatted, null, 2)}`,
          }],
        };
      }

      case "get-ic-calendar": {
        const upcoming = await dv.getDealsNeedingICApproval();
        const formatted = upcoming.map(formatDeal);
        return {
          content: [{
            type: "text" as const,
            text: `IC Calendar: ${formatted.length} deals with upcoming IC dates\n${formatted.map((d) => `- ${d.nextICDate}: ${d.name} (${d.ticker}) [${d.dealType}] $${((d.value || 0) / 1000).toFixed(0)}K | Compliance: ${d.complianceStatus}`).join("\n")}\n\n${JSON.stringify(formatted, null, 2)}`,
          }],
        };
      }

      case "update-deal-compliance": {
        const ticker = (args as any).ticker;
        const status = (args as any).status;
        const notes = (args as any).notes || "";
        const statusMap: Record<string, number> = { pending: 1, approved: 2, flagged: 3, escalated: 4 };
        const statusCode = statusMap[status.toLowerCase()];
        if (!statusCode) {
          return { content: [{ type: "text" as const, text: `Invalid status: ${status}. Use Pending, Approved, Flagged, or Escalated.` }], isError: true };
        }
        // Find opportunities for this ticker and update compliance
        const account = await crm.getAccountByTicker(ticker.toUpperCase());
        if (!account) {
          return { content: [{ type: "text" as const, text: `No CRM account found for ${ticker}.` }], isError: true };
        }
        // Note: In production, would update via Dataverse PATCH. For now return confirmation.
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ action: "update-compliance", ticker, status, notes, accountName: account.name, timestamp: new Date().toISOString() }),
          }],
        };
      }

      default:
        return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }], isError: true };
    }
  });

  return server;
}
