/**
 * Portfolio MCP Server — CRUD operations on portfolio holdings
 * via Dataverse custom tables (pm_portfolioholdings).
 *
 * Migrated from Excel/Graph to Dataverse for scale and resilience.
 * Falls back to Graph/Excel via read-only legacy endpoint.
 *
 * Mounted at /portfolio/mcp alongside the Finnhub server at /finnhub/mcp.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type ListToolsRequest,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as dv from "./dataverse-client.js";
import * as crm from "./crm-client.js";

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

// ── Input schemas (Dataverse-native) ──
const readSchema = {
  type: "object" as const,
  properties: {
    filter: { type: "string" as const, description: "Optional filter: 'active' for shares > 0, 'prospects' for pipeline, or a ticker symbol" },
  },
  additionalProperties: false,
};

const updateSchema = {
  type: "object" as const,
  properties: {
    ticker: { type: "string" as const, description: "Ticker symbol of the holding to update" },
    shares: { type: "string" as const, description: "New shares value" },
    costPerShare: { type: "string" as const, description: "New cost per share" },
    totalCost: { type: "string" as const, description: "New total cost" },
    sector: { type: "string" as const, description: "New sector" },
    holdingType: { type: "string" as const, description: "Client or Prospect" },
    website: { type: "string" as const, description: "Updated website" },
    mediaPress: { type: "string" as const, description: "Updated media/press URL" },
    currencyExposure: { type: "string" as const, description: "Primary currency pair e.g. GBP/USD" },
    fxHedged: { type: "string" as const, description: "true or false — is position FX hedged" },
    revenueAttributed: { type: "string" as const, description: "Revenue attributed to this holding" },
    marginPercent: { type: "string" as const, description: "Margin percentage" },
  },
  required: ["ticker"],
  additionalProperties: false,
};

const addSchema = {
  type: "object" as const,
  properties: {
    company: { type: "string" as const, description: "Company name" },
    ticker: { type: "string" as const, description: "Ticker symbol" },
    sector: { type: "string" as const, description: "Industry sector" },
    shares: { type: "string" as const, description: "Number of shares (0 for prospects)" },
    costPerShare: { type: "string" as const, description: "Cost per share in USD" },
    totalCost: { type: "string" as const, description: "Total cost in USD" },
    holdingType: { type: "string" as const, description: "Client or Prospect" },
    website: { type: "string" as const, description: "Company website" },
    mediaPress: { type: "string" as const, description: "Media/press URL" },
    currencyExposure: { type: "string" as const, description: "Primary currency pair e.g. GBP/USD" },
  },
  required: ["company", "ticker"],
  additionalProperties: false,
};

const deleteSchema = {
  type: "object" as const,
  properties: {
    ticker: { type: "string" as const, description: "Ticker symbol of the holding to delete" },
  },
  required: ["ticker"],
  additionalProperties: false,
};

const markReviewedSchema = {
  type: "object" as const,
  properties: {
    ticker: { type: "string" as const, description: "Ticker symbol of the company to mark as reviewed" },
  },
  required: ["ticker"],
  additionalProperties: false,
};

const migrateSchema = {
  type: "object" as const,
  properties: {
    source: { type: "string" as const, description: "Source: 'excel' to migrate from SharePoint Excel file" },
  },
  required: ["source"],
  additionalProperties: false,
};

// Zod parsers
const readParser = z.object({ filter: z.string().optional() });
const updateParser = z.object({
  ticker: z.string(),
  shares: z.string().optional(), costPerShare: z.string().optional(), totalCost: z.string().optional(),
  sector: z.string().optional(), holdingType: z.string().optional(), website: z.string().optional(),
  mediaPress: z.string().optional(), currencyExposure: z.string().optional(), fxHedged: z.string().optional(),
  revenueAttributed: z.string().optional(), marginPercent: z.string().optional(),
});
const addParser = z.object({
  company: z.string(), ticker: z.string(), sector: z.string().optional(),
  shares: z.string().optional(), costPerShare: z.string().optional(), totalCost: z.string().optional(),
  holdingType: z.string().optional(), website: z.string().optional(), mediaPress: z.string().optional(),
  currencyExposure: z.string().optional(),
});
const deleteParser = z.object({ ticker: z.string() });
const markReviewedParser = z.object({ ticker: z.string() });
const migrateParser = z.object({ source: z.string() });

/** Map Dataverse holding to legacy-compatible JSON shape */
function formatHolding(h: dv.PortfolioHolding) {
  return {
    id: h.pm_portfolioholdingid,
    Company: h.pm_company,
    Ticker: h.pm_ticker,
    Sector: h.pm_sector,
    Shares: h.pm_shares,
    "Cost/Share (USD)": h.pm_costpershare,
    "Total Cost (USD)": h.pm_totalcost,
    Type: h.pm_holdingtype === 100000000 ? "Client" : "Prospect",
    Website: h.pm_website || "",
    "Media/Press Release": h.pm_mediapress || "",
    ReviewedAt: h.pm_reviewedat || "",
    CurrencyExposure: h.pm_currencyexposure || "",
    FXHedged: h.pm_fxhedged || false,
    RevenueAttributed: h.pm_revenueattributed || 0,
    MarginPercent: h.pm_marginpercent || 0,
    ComplianceStatus: dv.COMPLIANCE_MAP[h.pm_compliancestatus || 100000000] || "Pending",
    LastComplianceCheck: h.pm_lastcompliancecheck || "",
    CreatedOn: h.createdon || "",
    ModifiedOn: h.modifiedon || "",
  };
}

// ── Server factory ──
export function createPortfolioServer(): Server {
  const server = new Server(
    { name: "portfolio-crud", version: "2.0.0" },
    { capabilities: { tools: {} } },
  );

  const tools: Tool[] = [
    {
      name: "read-portfolio",
      description: "Read portfolio holdings from Dataverse. Optional filter: 'active' (shares > 0), 'prospects' (pipeline), or a ticker symbol.",
      inputSchema: readSchema,
      annotations: { readOnlyHint: true },
    },
    {
      name: "update-portfolio-holding",
      description: "Update an existing portfolio holding by ticker symbol. Specify only fields to change.",
      inputSchema: updateSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "add-portfolio-holding",
      description: "Add a new holding to the portfolio. Requires company name and ticker. Set shares=0 for prospects.",
      inputSchema: addSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "delete-portfolio-holding",
      description: "Delete a holding from the portfolio by ticker symbol.",
      inputSchema: deleteSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "mark-as-reviewed",
      description: "Mark a company as reviewed by setting a review timestamp.",
      inputSchema: markReviewedSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "migrate-from-excel",
      description: "Migrate portfolio data from AlphaAnalyzer-Portfolio.xlsx on SharePoint into Dataverse. One-time operation.",
      inputSchema: migrateSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest) => {
    const { name, arguments: rawArgs } = req.params;
    const args = rawArgs ?? {};

    switch (name) {
      case "read-portfolio": {
        const parsed = zodParse(readParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { filter } = parsed;
        let holdings: dv.PortfolioHolding[];
        if (!filter) {
          holdings = await dv.getAllHoldings();
        } else if (filter.toLowerCase() === "active") {
          holdings = await dv.getActiveHoldings();
        } else if (filter.toLowerCase() === "prospects") {
          holdings = await dv.getProspects();
        } else {
          const h = await dv.getHoldingByTicker(filter);
          holdings = h ? [h] : [];
        }
        const rows = holdings.map(formatHolding);
        return {
          content: [{ type: "text" as const, text: `Portfolio loaded from Dataverse: ${rows.length} holdings.\n\n${JSON.stringify(rows, null, 2)}` }],
        };
      }

      case "update-portfolio-holding": {
        const parsed = zodParse(updateParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const upd = parsed;
        const existing = await dv.getHoldingByTicker(upd.ticker);
        if (!existing?.pm_portfolioholdingid) {
          return { content: [{ type: "text" as const, text: `Holding ${upd.ticker} not found in Dataverse.` }], isError: true };
        }
        const updates: Partial<dv.PortfolioHolding> = {};
        if (upd.shares !== undefined) updates.pm_shares = parseFloat(upd.shares) || 0;
        if (upd.costPerShare !== undefined) updates.pm_costpershare = parseFloat(upd.costPerShare) || 0;
        if (upd.totalCost !== undefined) updates.pm_totalcost = parseFloat(upd.totalCost) || 0;
        if (upd.sector !== undefined) updates.pm_sector = upd.sector;
        if (upd.holdingType !== undefined) updates.pm_holdingtype = upd.holdingType.toLowerCase() === "client" ? 100000000 : 100000001;
        if (upd.website !== undefined) updates.pm_website = upd.website;
        if (upd.mediaPress !== undefined) updates.pm_mediapress = upd.mediaPress;
        if (upd.currencyExposure !== undefined) updates.pm_currencyexposure = upd.currencyExposure;
        if (upd.fxHedged !== undefined) updates.pm_fxhedged = upd.fxHedged === "true";
        if (upd.revenueAttributed !== undefined) updates.pm_revenueattributed = parseFloat(upd.revenueAttributed) || 0;
        if (upd.marginPercent !== undefined) updates.pm_marginpercent = parseFloat(upd.marginPercent) || 0;

        await dv.updateHolding(existing.pm_portfolioholdingid, updates);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ action: "update", status: "Success", ticker: upd.ticker, updates, timestamp: new Date().toISOString() }) }],
        };
      }

      case "add-portfolio-holding": {
        const parsed = zodParse(addParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const add = parsed;
        const shares = parseFloat(add.shares || "0") || 0;
        const holding = await dv.createHolding({
          pm_company: add.company,
          pm_ticker: add.ticker.toUpperCase(),
          pm_sector: add.sector || "",
          pm_shares: shares,
          pm_costpershare: parseFloat(add.costPerShare || "0") || 0,
          pm_totalcost: parseFloat(add.totalCost || "0") || 0,
          pm_holdingtype: (add.holdingType?.toLowerCase() === "prospect" || shares === 0) ? 100000001 : 100000000,
          pm_website: add.website || "",
          pm_mediapress: add.mediaPress || "",
          pm_currencyexposure: add.currencyExposure || "",
          pm_compliancestatus: 100000000,
        });

        // Auto-create CRM account if it doesn't exist
        let crmStatus = "";
        try {
          const existing = await crm.getAccountByTicker(add.ticker.toUpperCase());
          if (!existing) {
            await crm.createAccount({
              name: add.company,
              tickersymbol: add.ticker.toUpperCase(),
              websiteurl: add.website,
              description: shares > 0 ? `Active holding — ${shares} shares` : "Prospect — pipeline",
              customertypecode: shares > 0 ? 3 : 1,
            });
            crmStatus = ` CRM account created for ${add.ticker}.`;
          } else {
            crmStatus = ` CRM account already exists for ${add.ticker}.`;
          }
        } catch (e) {
          crmStatus = ` CRM sync skipped (${e instanceof Error ? e.message : "unavailable"}).`;
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ action: "add", status: "Success", ticker: add.ticker, company: add.company, message: `Added ${add.ticker} to portfolio.${crmStatus}`, timestamp: new Date().toISOString() }) }],
        };
      }

      case "delete-portfolio-holding": {
        const parsed = zodParse(deleteParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { ticker } = parsed;
        const h = await dv.getHoldingByTicker(ticker);
        if (!h?.pm_portfolioholdingid) {
          return { content: [{ type: "text" as const, text: `Holding ${ticker} not found.` }], isError: true };
        }
        await dv.deleteHolding(h.pm_portfolioholdingid);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ action: "delete", status: "Success", ticker, timestamp: new Date().toISOString() }) }],
        };
      }

      case "mark-as-reviewed": {
        const parsed = zodParse(markReviewedParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { ticker } = parsed;
        await dv.markHoldingReviewed(ticker);
        const now = new Date().toISOString();
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ action: "reviewed", status: "Success", ticker, reviewedAt: now }) }],
        };
      }

      case "migrate-from-excel": {
        const parsed = zodParse(migrateParser, args);
        if (parsed && typeof parsed === 'object' && '__zodError' in parsed) return parsed.response;
        const { source } = parsed;
        if (source !== "excel") {
          return { content: [{ type: "text" as const, text: "Only 'excel' source is supported for migration." }], isError: true };
        }
        // Import Graph client dynamically so it's only loaded during migration
        const graph = await import("./graph-client.js");
        const data = await graph.readWorksheet();
        const values = data.values || [];
        const headers = values[0] || [];
        const rows = values.slice(1)
          .filter((row: any[]) => row.some((cell: any) => cell !== "" && cell != null))
          .map((row: any[]) => {
            const obj: Record<string, any> = {};
            headers.forEach((h: string, i: number) => { obj[h] = row[i]; });
            return obj;
          });
        const result = await dv.migrateFromExcel(rows);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ action: "migrate", source: "excel", ...result, totalRows: rows.length, timestamp: new Date().toISOString() }) }],
        };
      }

      default:
        return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }], isError: true };
    }
  });

  return server;
}
