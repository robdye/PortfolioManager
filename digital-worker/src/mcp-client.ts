// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — MCP Client for connecting to existing MCP servers

import { configDotenv } from 'dotenv';
configDotenv();

import { toolCache, isWriteTool, invalidateAfterWrite } from './tool-cache';
import { withResilience, circuitBreaker } from './circuit-breaker';

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

/**
 * Direct HTTP client for calling existing Portfolio Agent MCP servers.
 * Uses proper MCP JSON-RPC protocol with session initialization.
 * Enhanced with LRU caching + circuit breaker resilience.
 */
export class PortfolioMcpClient {
  public finnhubEndpoint: string;
  public crmEndpoint: string;
  public portfolioEndpoint: string;

  constructor() {
    this.finnhubEndpoint = process.env.MCP_FINNHUB_ENDPOINT || '';
    if (!this.finnhubEndpoint) console.warn('[MCP] MCP_FINNHUB_ENDPOINT not configured');
    this.crmEndpoint = process.env.MCP_CRM_ENDPOINT || '';
    if (!this.crmEndpoint) console.warn('[MCP] MCP_CRM_ENDPOINT not configured');
    this.portfolioEndpoint = process.env.MCP_PORTFOLIO_ENDPOINT || '';
    if (!this.portfolioEndpoint) console.warn('[MCP] MCP_PORTFOLIO_ENDPOINT not configured');
  }

  /**
   * Call an MCP tool with proper session lifecycle:
   * 1. Send initialize request → get session ID from Mcp-Session-Id header
   * 2. Send initialized notification with session ID
   * 3. Send tools/call with session ID
   */
  public async callTool(endpoint: string, toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
    // Check cache for read-only tools
    if (!isWriteTool(toolName)) {
      const cached = toolCache.get(toolName, args);
      if (cached !== null) return cached;
    }

    // Determine circuit breaker service name from endpoint
    const service = endpoint.includes('finnhub') ? 'mcp-finnhub'
      : endpoint.includes('crm') ? 'mcp-crm'
      : endpoint.includes('portfolio') ? 'mcp-portfolio'
      : 'mcp-unknown';

    const result = await withResilience(service, async () => {
      return this._callToolRaw(endpoint, toolName, args);
    });

    // Cache the result for read-only tools
    if (!isWriteTool(toolName)) {
      toolCache.set(toolName, args, result);
    } else {
      invalidateAfterWrite(toolName);
    }

    return result;
  }

  /**
   * Raw MCP tool call with session lifecycle (no cache/circuit breaker).
   */
  private async _callToolRaw(endpoint: string, toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const ACCEPT = 'application/json, text/event-stream';

    // Step 1: Initialize
    const initBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'portfolio-digital-worker', version: '1.0.0' },
      },
    };

    const initRes = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': ACCEPT },
      body: JSON.stringify(initBody),
    });

    if (!initRes.ok) {
      const errText = await initRes.text().catch(() => '');
      throw new Error(`MCP init failed: ${initRes.status} ${initRes.statusText} — ${errText}`);
    }

    const sessionId = initRes.headers.get('mcp-session-id') || initRes.headers.get('Mcp-Session-Id') || '';
    if (!sessionId) {
      console.warn('[MCP] No session ID received from server — stateless mode');
    }

    // Step 2: Send initialized notification
    const notifBody = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    };

    await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': ACCEPT,
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(notifBody),
    });

    // Step 3: Call the tool
    const callBody = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    };

    const callRes = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': ACCEPT,
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(callBody),
    });

    if (!callRes.ok) {
      const errText = await callRes.text().catch(() => '');
      throw new Error(`MCP call ${toolName} failed: ${callRes.status} — ${errText}`);
    }

    const json = await callRes.json() as { result?: { content?: Array<{ text?: string }> }; error?: { message: string } };
    if (json.error) throw new Error(`MCP error: ${json.error.message}`);

    const content = json.result?.content;
    if (content && content.length > 0 && content[0].text) {
      try {
        return JSON.parse(content[0].text);
      } catch {
        return content[0].text;
      }
    }
    return json.result;
  }

  // ── Finnhub/Market Data Tools ──

  async getQuote(symbol: string): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'show-stock-quote', { symbol });
  }

  async getMarketNews(): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'show-news-feed', {});
  }

  async getCompanyNews(symbol: string, from?: string, to?: string): Promise<unknown> {
    const today = new Date();
    const toDate = to || today.toISOString().split('T')[0];
    const fromDate = from || new Date(today.getTime() - 14 * 86400000).toISOString().split('T')[0];
    return this.callTool(this.finnhubEndpoint, 'show-company-news', { symbol, from: fromDate, to: toDate });
  }

  async getRecommendations(symbol: string): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'show-analyst-consensus', { symbol });
  }

  async getMorningBriefing(): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'show-morning-briefing', {});
  }

  async getPortfolioDashboard(symbols?: string, positions?: string, types?: string, sectors?: string): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'show-portfolio-dashboard', {
      symbols: symbols || '', ...(positions ? { positions } : {}),
      ...(types ? { types } : {}), ...(sectors ? { sectors } : {}),
    });
  }

  async getConcentrationRisk(symbols?: string, positions?: string, types?: string, sectors?: string): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'show-concentration-risk', {
      symbols: symbols || '', ...(positions ? { positions } : {}),
      ...(types ? { types } : {}), ...(sectors ? { sectors } : {}),
    });
  }

  async getStressTest(symbols?: string, positions?: string, types?: string, sectors?: string): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'show-stress-test', {
      symbols: symbols || '', ...(positions ? { positions } : {}),
      ...(types ? { types } : {}), ...(sectors ? { sectors } : {}),
    });
  }

  async getRelativeValue(symbols?: string, positions?: string, types?: string, sectors?: string): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'show-relative-value', {
      symbols: symbols || '', ...(positions ? { positions } : {}),
      ...(types ? { types } : {}), ...(sectors ? { sectors } : {}),
    });
  }

  async getRvShifts(symbols?: string, positions?: string, types?: string, sectors?: string): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'show-rv-shifts', {
      symbols: symbols || '', ...(positions ? { positions } : {}),
      ...(types ? { types } : {}), ...(sectors ? { sectors } : {}),
    });
  }

  async getChallengeHoldings(symbols?: string, positions?: string, types?: string, sectors?: string): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'show-challenge-holdings', {
      symbols: symbols || '', ...(positions ? { positions } : {}),
      ...(types ? { types } : {}), ...(sectors ? { sectors } : {}),
    });
  }

  async getBenchmarkComparison(symbols?: string, positions?: string, types?: string, sectors?: string): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'show-benchmark-comparison', {
      symbols: symbols || '', ...(positions ? { positions } : {}),
      ...(types ? { types } : {}), ...(sectors ? { sectors } : {}),
    });
  }

  async getBasicFinancials(symbol: string): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'get-basic-financials', { symbol });
  }

  // ── CRM Tools ──

  async getCrmAccounts(ticker?: string): Promise<unknown> {
    return this.callTool(this.crmEndpoint, 'get-crm-account', ticker ? { ticker } : {});
  }

  async getCrmPipeline(): Promise<unknown> {
    return this.callTool(this.crmEndpoint, 'get-crm-pipeline', {});
  }

  async getCrmContacts(ticker?: string): Promise<unknown> {
    return this.callTool(this.crmEndpoint, 'get-crm-contacts', ticker ? { ticker } : {});
  }

  // ── Portfolio CRUD Tools ──

  async getPortfolioHoldings(filter?: string): Promise<unknown> {
    return this.callTool(this.portfolioEndpoint, 'read-portfolio', filter ? { filter } : {});
  }

  async getActiveHoldings(): Promise<unknown> {
    return this.callTool(this.portfolioEndpoint, 'read-portfolio', { filter: 'active' });
  }

  async getProspects(): Promise<unknown> {
    return this.callTool(this.portfolioEndpoint, 'read-portfolio', { filter: 'prospects' });
  }

  async addPortfolioHolding(holding: { company: string; ticker: string; sector?: string; shares?: string; costPerShare?: string; holdingType?: string; currencyExposure?: string }): Promise<unknown> {
    return this.callTool(this.portfolioEndpoint, 'add-portfolio-holding', holding);
  }

  async updatePortfolioHolding(ticker: string, updates: Record<string, string>): Promise<unknown> {
    return this.callTool(this.portfolioEndpoint, 'update-portfolio-holding', { ticker, ...updates });
  }

  async migrateFromExcel(): Promise<unknown> {
    return this.callTool(this.portfolioEndpoint, 'migrate-from-excel', { source: 'excel' });
  }

  // ── FX & Currency Tools ──

  async getFxRate(base?: string): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'get-fx-rate', { base: base || 'USD' });
  }

  async getFxCandles(symbol: string, resolution?: string, days?: number): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'get-fx-candles', {
      symbol, resolution: resolution || 'D', days: String(days || 30),
    });
  }

  // ── Earnings & Calendar Tools ──

  async getEarningsCalendar(symbol?: string, days?: number): Promise<unknown> {
    const args: Record<string, string> = {};
    if (symbol) args.symbol = symbol;
    if (days) args.days = String(days);
    return this.callTool(this.finnhubEndpoint, 'get-earnings-calendar', args);
  }

  async getIpoCalendar(days?: number): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'get-ipo-calendar', { days: String(days || 30) });
  }

  // ── SEC & Regulatory Tools ──

  async getSecFilings(symbol: string): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'get-sec-filings', { symbol });
  }

  async getReportedFinancials(symbol: string, freq?: string): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'get-reported-financials', { symbol, freq: freq || 'annual' });
  }

  async getInsiderSentiment(symbol: string, months?: number): Promise<unknown> {
    return this.callTool(this.finnhubEndpoint, 'get-insider-sentiment', { symbol, months: String(months || 3) });
  }

  // ── Deal & Compliance Tools (CRM) ──

  async getDealTracker(dealType?: string, stage?: string): Promise<unknown> {
    const args: Record<string, string> = {};
    if (dealType) args.dealType = dealType;
    if (stage) args.stage = stage;
    return this.callTool(this.crmEndpoint, 'get-deal-tracker', args);
  }

  async getRevenueForecast(): Promise<unknown> {
    return this.callTool(this.crmEndpoint, 'get-revenue-forecast', {});
  }

  async getComplianceStatus(status?: string): Promise<unknown> {
    return this.callTool(this.crmEndpoint, 'get-compliance-status', status ? { status } : {});
  }

  async getICCalendar(): Promise<unknown> {
    return this.callTool(this.crmEndpoint, 'get-ic-calendar', {});
  }
}

export const mcpClient = new PortfolioMcpClient();
