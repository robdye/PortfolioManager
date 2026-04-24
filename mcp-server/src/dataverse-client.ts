/**
 * Dataverse Portfolio Client — replaces Graph/Excel CRUD with Dataverse tables.
 *
 * Custom tables:
 *   - pm_portfolioholding    — portfolio holdings (replaces Excel rows)
 *   - pm_dealtracker         — M&A / deal pipeline tracking
 *   - pm_compliancereview    — compliance review log
 *   - pm_revenueforecast     — revenue forecast snapshots
 *
 * Supports OBO (On-Behalf-Of) when a user token is provided,
 * falls back to client credentials for app-level access.
 */
import { AsyncLocalStorage } from "async_hooks";
import { getDataverseToken } from "./obo-auth.js";

const CRM_URL = process.env.CRM_URL || "https://orge2a9a349.crm.dynamics.com";
const API_BASE = `${CRM_URL}/api/data/v9.2`;

function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

function validateTicker(ticker: string): void {
  if (!/^[A-Z0-9.\-]{1,10}$/i.test(ticker)) {
    throw new Error(`Invalid ticker format: ${ticker}`);
  }
}

function fetchWithTimeout(url: string | URL, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

/** Per-request user token — set by the MCP handler before calling client methods. */
const userTokenStore = new AsyncLocalStorage<string | null>();

export function setRequestUserToken(token: string | null): void {
  userTokenStore.enterWith(token);
}

async function getToken(): Promise<string> {
  return getDataverseToken(userTokenStore.getStore() ?? null);
}

async function dvGet<T = unknown>(path: string): Promise<T> {
  const token = await getToken();
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Prefer: "odata.include-annotations=*",
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dataverse GET ${res.status}: ${errText}`);
  }
  return res.json() as Promise<T>;
}

async function dvPost<T = unknown>(path: string, body: unknown): Promise<T | null> {
  const token = await getToken();
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dataverse POST ${res.status}: ${errText}`);
  }
  if (res.status === 204) {
    // No content response — return null for compatibility
    return null;
  }
  return res.json() as Promise<T>;
}

async function dvPatch(path: string, body: unknown): Promise<void> {
  const token = await getToken();
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetchWithTimeout(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dataverse PATCH ${res.status}: ${errText}`);
  }
}

async function dvDelete(path: string): Promise<void> {
  const token = await getToken();
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetchWithTimeout(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dataverse DELETE ${res.status}: ${errText}`);
  }
}

// ────────────────────────────────────────────────────────────
// Portfolio Holdings (pm_portfolioholdings)
// ────────────────────────────────────────────────────────────

export interface PortfolioHolding {
  pm_portfolioholdingid?: string;
  pm_company: string;
  pm_ticker: string;
  pm_sector: string;
  pm_shares: number;
  pm_costpershare: number;
  pm_totalcost: number;
  pm_holdingtype: number;       // 100000000 = Client, 100000001 = Prospect
  pm_website?: string;
  pm_mediapress?: string;
  pm_reviewedat?: string;
  pm_currencyexposure?: string; // Primary currency pair e.g. "GBP/USD"
  pm_fxhedged?: boolean;
  pm_revenueattributed?: number;
  pm_marginpercent?: number;
  pm_lastcompliancecheck?: string;
  pm_compliancestatus?: number; // 100000000=Compliant, 100000001=Pending, 100000002=Flagged, 100000003=Escalated
  createdon?: string;
  modifiedon?: string;
}

const HOLDINGS_SELECT = "$select=pm_portfolioholdingid,pm_company,pm_ticker,pm_sector,pm_shares,pm_costpershare,pm_totalcost,pm_holdingtype,pm_website,pm_mediapress,pm_reviewedat,pm_currencyexposure,pm_fxhedged,pm_revenueattributed,pm_marginpercent,pm_lastcompliancecheck,pm_compliancestatus,createdon,modifiedon";

export async function getAllHoldings(): Promise<PortfolioHolding[]> {
  const data = await dvGet<any>(
    `/pm_portfolioholdings?${HOLDINGS_SELECT}&$orderby=pm_company`
  );
  return data.value || [];
}

export async function getHoldingByTicker(ticker: string): Promise<PortfolioHolding | null> {
  validateTicker(ticker);
  const data = await dvGet<any>(
    `/pm_portfolioholdings?${HOLDINGS_SELECT}&$filter=pm_ticker eq '${escapeOData(ticker.toUpperCase())}'&$top=1`
  );
  return data.value?.[0] || null;
}

export async function getActiveHoldings(): Promise<PortfolioHolding[]> {
  const data = await dvGet<any>(
    `/pm_portfolioholdings?${HOLDINGS_SELECT}&$filter=pm_shares gt 0&$orderby=pm_company`
  );
  return data.value || [];
}

export async function getProspects(): Promise<PortfolioHolding[]> {
  const data = await dvGet<any>(
    `/pm_portfolioholdings?${HOLDINGS_SELECT}&$filter=pm_holdingtype eq 100000001&$orderby=pm_company`
  );
  return data.value || [];
}

export async function createHolding(holding: Partial<PortfolioHolding>): Promise<PortfolioHolding | null> {
  return dvPost<PortfolioHolding>("/pm_portfolioholdings", holding);
}

export async function updateHolding(id: string, updates: Partial<PortfolioHolding>): Promise<void> {
  await dvPatch(`/pm_portfolioholdings(${id})`, updates);
}

export async function deleteHolding(id: string): Promise<void> {
  await dvDelete(`/pm_portfolioholdings(${id})`);
}

export async function markHoldingReviewed(ticker: string): Promise<void> {
  validateTicker(ticker);
  const holding = await getHoldingByTicker(ticker);
  if (!holding?.pm_portfolioholdingid) {
    throw new Error(`Holding ${ticker} not found`);
  }
  await dvPatch(`/pm_portfolioholdings(${holding.pm_portfolioholdingid})`, {
    pm_reviewedat: new Date().toISOString(),
  });
}

// ────────────────────────────────────────────────────────────
// Deal Tracker (pm_dealtrackers)
// ────────────────────────────────────────────────────────────

export interface DealRecord {
  pm_dealtrackerid?: string;
  pm_name: string;
  pm_ticker: string;
  pm_dealtype: number;           // 100000000=M&A, 100000001=Capital Raise, 100000002=FX Hedging, 100000003=Follow-on, 100000004=Exit
  pm_dealstage: number;          // 100000000=Origination, 100000001=Qualify, 100000002=Due Diligence, 100000003=IC Approval, 100000004=Execution, 100000005=Closed
  pm_estimatedvalue: number;
  pm_winprobability: number;     // 0-100
  pm_revenueforecast: number;
  pm_marginpercent: number;
  pm_compliancestatus: number;   // 100000000=Pending, 100000001=Approved, 100000002=Flagged, 100000003=Escalated
  pm_riskrating: number;         // 100000000=Low, 100000001=Medium, 100000002=High, 100000003=Critical
  pm_exitstrategy?: string;
  pm_currencyexposure?: string;
  pm_nexticdate?: string;
  pm_boardobserver?: string;
  pm_description?: string;
  pm_lastcompliancereview?: string;
  pm_estimatedclosedate?: string;
  createdon?: string;
  modifiedon?: string;
}

const DEALS_SELECT = "$select=pm_dealtrackerid,pm_name,pm_ticker,pm_dealtype,pm_dealstage,pm_estimatedvalue,pm_winprobability,pm_revenueforecast,pm_marginpercent,pm_compliancestatus,pm_riskrating,pm_exitstrategy,pm_currencyexposure,pm_nexticdate,pm_boardobserver,pm_description,pm_lastcompliancereview,pm_estimatedclosedate,createdon,modifiedon";

const DEAL_TYPE_MAP: Record<number, string> = {
  100000000: "M&A", 100000001: "Capital Raise", 100000002: "FX Hedging",
  100000003: "Follow-on", 100000004: "Exit",
};

const DEAL_STAGE_MAP: Record<number, string> = {
  100000000: "Origination", 100000001: "Qualify", 100000002: "Due Diligence",
  100000003: "IC Approval", 100000004: "Execution", 100000005: "Closed",
};

const COMPLIANCE_MAP: Record<number, string> = {
  100000000: "Pending", 100000001: "Approved", 100000002: "Flagged", 100000003: "Escalated",
};

const RISK_MAP: Record<number, string> = {
  100000000: "Low", 100000001: "Medium", 100000002: "High", 100000003: "Critical",
};

export { DEAL_TYPE_MAP, DEAL_STAGE_MAP, COMPLIANCE_MAP, RISK_MAP };

export async function getAllDeals(): Promise<DealRecord[]> {
  const data = await dvGet<any>(
    `/pm_dealtrackers?${DEALS_SELECT}&$orderby=pm_estimatedvalue desc`
  );
  return data.value || [];
}

export async function getDealsByType(dealType: number): Promise<DealRecord[]> {
  const data = await dvGet<any>(
    `/pm_dealtrackers?${DEALS_SELECT}&$filter=pm_dealtype eq ${dealType}&$orderby=pm_estimatedvalue desc`
  );
  return data.value || [];
}

export async function getDealsByStage(stage: number): Promise<DealRecord[]> {
  const data = await dvGet<any>(
    `/pm_dealtrackers?${DEALS_SELECT}&$filter=pm_dealstage eq ${stage}&$orderby=pm_estimatedvalue desc`
  );
  return data.value || [];
}

export async function getDealsByCompliance(status: number): Promise<DealRecord[]> {
  const data = await dvGet<any>(
    `/pm_dealtrackers?${DEALS_SELECT}&$filter=pm_compliancestatus eq ${status}&$orderby=pm_estimatedvalue desc`
  );
  return data.value || [];
}

export async function getDealsNeedingICApproval(): Promise<DealRecord[]> {
  const now = new Date().toISOString();
  const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString();
  const data = await dvGet<any>(
    `/pm_dealtrackers?${DEALS_SELECT}&$filter=pm_nexticdate ge ${now} and pm_nexticdate le ${thirtyDays}&$orderby=pm_nexticdate`
  );
  return data.value || [];
}

export async function createDeal(deal: Partial<DealRecord>): Promise<DealRecord | null> {
  return dvPost<DealRecord>("/pm_dealtrackers", deal);
}

export async function updateDeal(id: string, updates: Partial<DealRecord>): Promise<void> {
  await dvPatch(`/pm_dealtrackers(${id})`, updates);
}

export async function deleteDeal(id: string): Promise<void> {
  await dvDelete(`/pm_dealtrackers(${id})`);
}

// ────────────────────────────────────────────────────────────
// Compliance Reviews (pm_compliancereviews)
// ────────────────────────────────────────────────────────────

export interface ComplianceReview {
  pm_compliancereviewid?: string;
  pm_ticker: string;
  pm_reviewtype: string;          // "Deal Compliance", "Portfolio Risk", "Regulatory Filing"
  pm_status: number;              // 100000000=Pending, 100000001=Approved, 100000002=Flagged, 100000003=Escalated
  pm_reviewer?: string;
  pm_notes?: string;
  pm_riskfactors?: string;        // JSON array of risk factors
  pm_reviewdate?: string;
  pm_nextreviewdate?: string;
  createdon?: string;
}

export async function getComplianceReviews(ticker?: string): Promise<ComplianceReview[]> {
  if (ticker) validateTicker(ticker);
  const filter = ticker ? `&$filter=pm_ticker eq '${escapeOData(ticker.toUpperCase())}'` : "";
  const data = await dvGet<any>(
    `/pm_compliancereviews?$select=pm_compliancereviewid,pm_ticker,pm_reviewtype,pm_status,pm_reviewer,pm_notes,pm_riskfactors,pm_reviewdate,pm_nextreviewdate,createdon${filter}&$orderby=createdon desc`
  );
  return data.value || [];
}

export async function getPendingComplianceReviews(): Promise<ComplianceReview[]> {
  const data = await dvGet<any>(
    `/pm_compliancereviews?$select=pm_compliancereviewid,pm_ticker,pm_reviewtype,pm_status,pm_reviewer,pm_notes,pm_riskfactors,pm_reviewdate,pm_nextreviewdate,createdon&$filter=pm_status eq 100000000 or pm_status eq 100000002&$orderby=createdon desc`
  );
  return data.value || [];
}

export async function createComplianceReview(review: Partial<ComplianceReview>): Promise<ComplianceReview | null> {
  return dvPost<ComplianceReview>("/pm_compliancereviews", review);
}

export async function updateComplianceReview(id: string, updates: Partial<ComplianceReview>): Promise<void> {
  await dvPatch(`/pm_compliancereviews(${id})`, updates);
}

// ────────────────────────────────────────────────────────────
// Revenue Forecasts (pm_revenueforecasts)
// ────────────────────────────────────────────────────────────

export interface RevenueForecast {
  pm_revenueforecastid?: string;
  pm_ticker: string;
  pm_period: string;              // "2026-Q1", "2026-Q2", etc.
  pm_forecastrevenue: number;
  pm_actualrevenue?: number;
  pm_variance?: number;
  pm_walletshare?: number;        // Percentage of client's total FX/banking business
  pm_marginpercent?: number;
  pm_forecastdate?: string;
  createdon?: string;
}

export async function getRevenueForecasts(ticker?: string, period?: string): Promise<RevenueForecast[]> {
  if (ticker) validateTicker(ticker);
  const filters: string[] = [];
  if (ticker) filters.push(`pm_ticker eq '${escapeOData(ticker.toUpperCase())}'`);
  if (period) filters.push(`pm_period eq '${escapeOData(period)}'`);
  const filter = filters.length > 0 ? `&$filter=${filters.join(" and ")}` : "";
  const data = await dvGet<any>(
    `/pm_revenueforecasts?$select=pm_revenueforecastid,pm_ticker,pm_period,pm_forecastrevenue,pm_actualrevenue,pm_variance,pm_walletshare,pm_marginpercent,pm_forecastdate,createdon${filter}&$orderby=pm_period desc`
  );
  return data.value || [];
}

export async function createRevenueForecast(forecast: Partial<RevenueForecast>): Promise<RevenueForecast | null> {
  return dvPost<RevenueForecast>("/pm_revenueforecasts", forecast);
}

export async function updateRevenueForecast(id: string, updates: Partial<RevenueForecast>): Promise<void> {
  await dvPatch(`/pm_revenueforecasts(${id})`, updates);
}

// ────────────────────────────────────────────────────────────
// Weighted Pipeline Revenue (computed)
// ────────────────────────────────────────────────────────────

export async function getWeightedPipelineRevenue(): Promise<{
  totalWeightedRevenue: number;
  totalUnweightedRevenue: number;
  dealCount: number;
  byStage: Record<string, { count: number; weighted: number; unweighted: number }>;
  byType: Record<string, { count: number; weighted: number; unweighted: number }>;
}> {
  const deals = await getAllDeals();
  const openDeals = deals.filter(d => d.pm_dealstage !== 100000005); // Exclude closed

  let totalWeightedRevenue = 0;
  let totalUnweightedRevenue = 0;
  const byStage: Record<string, { count: number; weighted: number; unweighted: number }> = {};
  const byType: Record<string, { count: number; weighted: number; unweighted: number }> = {};

  for (const deal of openDeals) {
    const value = deal.pm_revenueforecast || deal.pm_estimatedvalue || 0;
    const probability = (deal.pm_winprobability || 0) / 100;
    const weighted = value * probability;

    totalWeightedRevenue += weighted;
    totalUnweightedRevenue += value;

    const stageName = DEAL_STAGE_MAP[deal.pm_dealstage] || "Unknown";
    if (!byStage[stageName]) byStage[stageName] = { count: 0, weighted: 0, unweighted: 0 };
    byStage[stageName].count++;
    byStage[stageName].weighted += weighted;
    byStage[stageName].unweighted += value;

    const typeName = DEAL_TYPE_MAP[deal.pm_dealtype] || "Unknown";
    if (!byType[typeName]) byType[typeName] = { count: 0, weighted: 0, unweighted: 0 };
    byType[typeName].count++;
    byType[typeName].weighted += weighted;
    byType[typeName].unweighted += value;
  }

  return { totalWeightedRevenue, totalUnweightedRevenue, dealCount: openDeals.length, byStage, byType };
}

// ────────────────────────────────────────────────────────────
// Migration helper — import Excel rows into Dataverse
// ────────────────────────────────────────────────────────────

export async function migrateFromExcel(rows: Array<Record<string, any>>): Promise<{ created: number; errors: string[] }> {
  let created = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const shares = parseFloat(row.Shares) || 0;
      await createHolding({
        pm_company: row.Company || row.company || "",
        pm_ticker: (row.Ticker || row.ticker || "").toUpperCase(),
        pm_sector: row.Sector || row.sector || "",
        pm_shares: shares,
        pm_costpershare: parseFloat(row["Cost/Share (USD)"] || row.costPerShare || row["Cost/Share"] || "0") || 0,
        pm_totalcost: parseFloat(row["Total Cost (USD)"] || row.totalCost || row["Total Cost"] || "0") || 0,
        pm_holdingtype: shares > 0 ? 100000000 : 100000001, // Client or Prospect
        pm_website: row.Website || row.website || "",
        pm_mediapress: row["Media/Press Release"] || row.mediaPress || "",
        pm_compliancestatus: 100000000, // Pending
      });
      created++;
    } catch (err) {
      const ticker = row.Ticker || row.ticker || "unknown";
      errors.push(`${ticker}: ${(err as Error).message}`);
    }
  }

  return { created, errors };
}
