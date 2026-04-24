/**
 * Dynamics 365 / Dataverse API client.
 * Supports OBO (On-Behalf-Of) when a user token is provided,
 * falls back to client credentials for app-level access.
 */
import { AsyncLocalStorage } from "async_hooks";
import { getDataverseToken } from "./obo-auth.js";

const CRM_URL = process.env.CRM_URL || "";
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

/** Per-request user token — set by the MCP handler. */
const userTokenStore = new AsyncLocalStorage<string | null>();

export function setRequestUserToken(token: string | null): void {
  userTokenStore.enterWith(token);
}

async function getToken(): Promise<string> {
  return getDataverseToken(userTokenStore.getStore() ?? null);
}

async function crmCall<T = unknown>(path: string): Promise<T> {
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
    throw new Error(`CRM API ${res.status}: ${errText}`);
  }
  return res.json() as Promise<T>;
}

// ── Accounts ──
export async function getAccountByTicker(ticker: string) {
  validateTicker(ticker);
  const data = await crmCall<any>(
    `/accounts?$filter=tickersymbol eq '${escapeOData(ticker)}'&$select=accountid,name,tickersymbol,revenue,telephone1,websiteurl,description,industrycode,customertypecode,address1_city,address1_country&$top=1`
  );
  return data.value?.[0] || null;
}

export async function createAccount(account: { name: string; tickersymbol: string; websiteurl?: string; description?: string; customertypecode?: number }) {
  const token = await getToken();
  const res = await fetchWithTimeout(`${API_BASE}/accounts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
    },
    body: JSON.stringify(account),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`CRM create account ${res.status}: ${errText}`);
  }
  return true;
}

export async function getAllPortfolioAccounts() {
  const data = await crmCall<any>(
    `/accounts?$filter=tickersymbol ne null&$select=accountid,name,tickersymbol,revenue,telephone1,websiteurl,description,industrycode,customertypecode,address1_city,address1_country&$orderby=name`
  );
  return data.value || [];
}

// ── Contacts ──
export async function getContactsForAccount(accountId: string) {
  const data = await crmCall<any>(
    `/contacts?$filter=_parentcustomerid_value eq '${escapeOData(accountId)}'&$select=contactid,fullname,firstname,lastname,jobtitle,emailaddress1,telephone1&$orderby=fullname`
  );
  return data.value || [];
}

export async function getContactsByTicker(ticker: string) {
  validateTicker(ticker);
  const data = await crmCall<any>(
    `/contacts?$select=contactid,fullname,jobtitle,emailaddress1,telephone1&$expand=parentcustomerid_account($select=tickersymbol,name)&$filter=parentcustomerid_account/tickersymbol eq '${escapeOData(ticker)}'&$orderby=fullname`
  );
  return data.value || [];
}

// ── Opportunities (standard D365 columns only) ──
export async function getOpportunitiesForAccount(accountId: string) {
  const data = await crmCall<any>(
    `/opportunities?$filter=_customerid_value eq '${escapeOData(accountId)}'&$select=opportunityid,name,estimatedvalue,stepname,estimatedclosedate,description&$orderby=estimatedvalue desc`
  );
  return data.value || [];
}

export async function getAllPortfolioOpportunities() {
  const data = await crmCall<any>(
    `/opportunities?$select=opportunityid,name,estimatedvalue,stepname,estimatedclosedate,description&$expand=customerid_account($select=tickersymbol,name)&$filter=customerid_account/tickersymbol ne null&$orderby=estimatedvalue desc`
  );
  return data.value || [];
}

// Deal-type queries now use pm_dealtrackers Dataverse table — see dataverse-client.ts

// ── Activities ──
export async function getActivitiesForAccount(accountId: string) {
  const data = await crmCall<any>(
    `/activitypointers?$filter=_regardingobjectid_value eq '${escapeOData(accountId)}'&$select=activityid,subject,activitytypecode,scheduledstart,description&$orderby=scheduledstart desc&$top=10`
  );
  return data.value || [];
}
