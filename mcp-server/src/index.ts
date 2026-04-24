/**
 * Portfolio Agent MCP Server — Express + Streamable HTTP.
 * Mirrors microsoft/mcp-interactiveUI-samples architecture.
 * Supports OBO auth — user tokens from Copilot are exchanged for Dataverse/Graph tokens.
 */
import express, { type Request, type Response } from "express";
import { randomUUID } from "crypto";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPortfolioServer as createFinnhubServer } from "./mcp-server.js";
import { createPortfolioServer as createPortfolioCRUDServer } from "./portfolio-server.js";
import { createCRMServer } from "./crm-server.js";
import { oboMiddleware, extractBearerToken } from "./obo-auth.js";
import { setRequestUserToken as setDvUserToken } from "./dataverse-client.js";
import { setRequestUserToken as setCrmUserToken } from "./crm-client.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

const app = express();

// ── CORS ──
const ALLOWED_SUFFIXES = [
  ".microsoft.com", ".cloud.microsoft", ".office.com", ".office365.com",
  ".sharepoint.com", ".live.com", ".microsoft365.com", ".teams.microsoft.com",
  ".chatgpt.com", ".openai.com", ".devtunnels.ms", ".widgetcopilot.net",
  ".widget-renderer.usercontent.microsoft.com",
];

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // Same-origin requests
  if (origin === "null") return process.env.ALLOW_NULL_ORIGIN === "true";
  if (origin.startsWith("http://localhost") || origin.startsWith("https://localhost")) return true;
  if (origin.startsWith("http://127.0.0.1") || origin.startsWith("https://127.0.0.1")) return true;
  if (origin.startsWith("vscode-webview://")) return true;
  const extra = process.env.ADDITIONAL_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()) ?? [];
  for (const suffix of [...ALLOWED_SUFFIXES, ...extra]) {
    try {
      const hostname: string = new URL(origin).hostname;
      if (suffix.startsWith(".") && (hostname.endsWith(suffix) || hostname === suffix.slice(1))) return true;
      if (origin === suffix) return true;
    } catch { /* ignore */ }
  }
  return false;
}

app.use(cors({
  origin: (origin, cb) => { cb(null, isOriginAllowed(origin) ? (origin ?? true) : false); },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "Mcp-Session-Id", "mcp-session-id", "Last-Event-ID", "Mcp-Protocol-Version", "mcp-protocol-version"],
  exposedHeaders: ["Mcp-Session-Id"],
  credentials: false,
}));
app.options("*", cors());
app.use(express.json());

// Structured request logging
app.use((req, res, next) => {
  const requestId = randomUUID();
  const start = Date.now();
  res.setHeader('X-Request-ID', requestId);
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(JSON.stringify({
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      timestamp: new Date().toISOString()
    }));
  });
  next();
});

/** Public-facing URL of this server */
export function getPublicServerUrl(): string {
  const base = process.env.SERVER_BASE_URL;
  if (base) return base.replace(/\/+$/, "");
  return `http://localhost:${PORT}`;
}

// ── Health ──
app.get("/health", (_req, res) => {
  const checks: Record<string, string> = {
    finnhub: process.env.FINNHUB_API_KEY ? "configured" : "missing-key",
    dataverse: process.env.CRM_URL || process.env.GRAPH_CLIENT_ID ? "configured" : "missing-config",
  };
  const healthy = !Object.values(checks).some(v => v.includes("missing"));

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    servers: ["finnhub", "portfolio", "crm"],
    checks,
    uptime: process.uptime(),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    timestamp: new Date().toISOString()
  });
});

// ── Helper: create MCP handler for a given server factory ──
function mcpHandler(createServer: () => any) {
  return async (req: Request, res: Response) => {
    try {
      // Extract user token and set it for downstream clients (OBO)
      const userToken = extractBearerToken(req);
      setDvUserToken(userToken);
      setCrmUserToken(userToken);

      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { transport.close().catch((err: unknown) => { console.warn("[MCP] Transport close error:", (err as Error).message); }); server.close().catch((err: unknown) => { console.warn("[MCP] Server close error:", (err as Error).message); }); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP error:", err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  };
}

// ── Finnhub MCP (market data + widgets) at /finnhub/mcp ──
app.post("/finnhub/mcp", mcpHandler(createFinnhubServer));
app.get("/finnhub/mcp", mcpHandler(createFinnhubServer));
app.delete("/finnhub/mcp", mcpHandler(createFinnhubServer));

// ── Portfolio CRUD MCP (Graph API) at /portfolio/mcp ──
app.post("/portfolio/mcp", mcpHandler(createPortfolioCRUDServer));
app.get("/portfolio/mcp", mcpHandler(createPortfolioCRUDServer));
app.delete("/portfolio/mcp", mcpHandler(createPortfolioCRUDServer));

// ── Legacy: keep /mcp pointing to Finnhub for backward compat ──
app.post("/mcp", mcpHandler(createFinnhubServer));
app.get("/mcp", mcpHandler(createFinnhubServer));
app.delete("/mcp", mcpHandler(createFinnhubServer));

// ── CRM MCP (D365 Dataverse) at /crm/mcp ──
app.post("/crm/mcp", mcpHandler(createCRMServer));
app.get("/crm/mcp", mcpHandler(createCRMServer));
app.delete("/crm/mcp", mcpHandler(createCRMServer));

// ── Start ──
const server = app.listen(PORT, () => {
  const pub = getPublicServerUrl();
  console.log(`\n  Portfolio Manager MCP Server`);
  console.log(`  Finnhub:    ${pub}/finnhub/mcp`);
  console.log(`  Portfolio:  ${pub}/portfolio/mcp`);
  console.log(`  CRM:        ${pub}/crm/mcp`);
  console.log(`  Health:     ${pub}/health\n`);
});

function gracefulShutdown(signal: string) {
  console.log(`[Server] ${signal} received — shutting down gracefully...`);
  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 10s if stuck
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
