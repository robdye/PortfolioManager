/**
 * Microsoft Graph API client for SharePoint Excel CRUD operations.
 * Uses client credentials flow (application permissions).
 */

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

function fetchWithTimeout(url: string | URL, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    const missing = [!tenantId && "GRAPH_TENANT_ID", !clientId && "GRAPH_CLIENT_ID", !clientSecret && "GRAPH_CLIENT_SECRET"].filter(Boolean);
    throw new Error(`Graph auth not configured — missing env vars: ${missing.join(", ")}`);
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetchWithTimeout(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Graph] Token request failed: ${res.status}`, errText);
    throw new Error(`Token error: ${res.status} ${errText}`);
  }
  const data = (await res.json()) as TokenResponse;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function graphCall<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const url = `https://graph.microsoft.com/v1.0${path}`;
  console.log(`[Graph] ${method} ${path}`);
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) {
    const text = await res.text();
    console.error(`[Graph] ${method} ${path} → ${res.status}`, text);
    throw new Error(`Graph ${method} ${path}: ${res.status} ${text}`);
  }
  if (res.status === 204) {
    // No content response — return empty object for compatibility
    return {} as T;
  }
  return res.json() as Promise<T>;
}

// ── Site & Drive resolution ──

let siteId: string | null = null;
let driveId: string | null = null;
let fileId: string | null = null;

const SHAREPOINT_HOST = process.env.SHAREPOINT_HOST || "";
const SHAREPOINT_SITE_PATH = process.env.SHAREPOINT_SITE_PATH || "";
const PORTFOLIO_FILENAME = process.env.PORTFOLIO_FILENAME || "AlphaAnalyzer-Portfolio.xlsx";

async function resolveSite(): Promise<string> {
  if (siteId) return siteId;
  // For root site (no site path), use hostname only; for sub-sites use hostname:/path
  const path = SHAREPOINT_SITE_PATH
    ? `${SHAREPOINT_HOST}:/${SHAREPOINT_SITE_PATH}`
    : SHAREPOINT_HOST;
  console.log(`[Graph] Resolving site: /sites/${path}`);
  const site = await graphCall<any>("GET", `/sites/${path}`);
  siteId = site.id;
  console.log(`[Graph] Site resolved: ${siteId}`);
  return siteId!;
}

async function resolveDrive(): Promise<string> {
  if (driveId) return driveId;
  const sid = await resolveSite();
  const drives = await graphCall<any>("GET", `/sites/${sid}/drives`);
  console.log(`[Graph] Found ${drives.value?.length || 0} drives`);
  // Use the first (default) document library
  driveId = drives.value[0]?.id;
  if (!driveId) throw new Error("No document library found on SharePoint site");
  return driveId;
}

async function resolveFile(): Promise<string> {
  if (fileId) return fileId;
  const did = await resolveDrive();
  console.log(`[Graph] Searching for "${PORTFOLIO_FILENAME}" in drive ${did}`);
  const search = await graphCall<any>("GET", `/drives/${did}/root/children`);
  // First check root
  for (const item of search.value || []) {
    if (item.name === PORTFOLIO_FILENAME) { fileId = item.id; console.log(`[Graph] File found in root: ${fileId}`); return fileId!; }
  }
  // Then check Shared Documents folder
  const shared = await graphCall<any>("GET", `/drives/${did}/root:/Shared%20Documents:/children`).catch((err) => { console.warn("[Graph] Request failed:", (err as Error).message); return { value: [] }; });
  for (const item of (shared as any).value || []) {
    if (item.name === PORTFOLIO_FILENAME) { fileId = item.id; console.log(`[Graph] File found in Shared Documents: ${fileId}`); return fileId!; }
  }
  // Search the entire drive as final fallback
  console.log(`[Graph] File not in root or Shared Documents, searching entire drive...`);
  const searchResult = await graphCall<any>("GET", `/drives/${did}/root/search(q='${encodeURIComponent(PORTFOLIO_FILENAME)}')`).catch((err) => { console.warn("[Graph] Search failed:", (err as Error).message); return { value: [] }; });
  for (const item of (searchResult as any).value || []) {
    if (item.name === PORTFOLIO_FILENAME && !item.folder) {
      fileId = item.id;
      console.log(`[Graph] File found via search: ${fileId}`);
      return fileId!;
    }
  }
  throw new Error(`File "${PORTFOLIO_FILENAME}" not found in SharePoint. Searched root, Shared Documents, and full drive.`);
}

// ── Helpers ──

/** Convert 1-based column index to Excel letter(s): 1→A, 26→Z, 27→AA */
function colLetter(col: number): string {
  let s = "";
  while (col > 0) {
    col--;
    s = String.fromCharCode(65 + (col % 26)) + s;
    col = Math.floor(col / 26);
  }
  return s;
}

/** URL-encode a worksheet name for Graph API paths */
function encSheet(name?: string): string {
  return encodeURIComponent(name || "Sheet1");
}

// ── Excel operations ──

export async function readWorksheet(sheetName?: string): Promise<any> {
  const did = await resolveDrive();
  const fid = await resolveFile();
  const sheet = encSheet(sheetName);
  const result = await graphCall<any>("GET", `/drives/${did}/items/${fid}/workbook/worksheets('${sheet}')/usedRange`);
  return result;
}

export async function readRange(range: string, sheetName?: string): Promise<any> {
  const did = await resolveDrive();
  const fid = await resolveFile();
  const sheet = encSheet(sheetName);
  return graphCall<any>("GET", `/drives/${did}/items/${fid}/workbook/worksheets('${sheet}')/range(address='${range}')`);
}

export async function updateRange(range: string, values: any[][], sheetName?: string): Promise<any> {
  const did = await resolveDrive();
  const fid = await resolveFile();
  const sheet = encSheet(sheetName);
  return graphCall<any>("PATCH", `/drives/${did}/items/${fid}/workbook/worksheets('${sheet}')/range(address='${range}')`, { values });
}

export async function addRow(values: any[], sheetName?: string): Promise<any> {
  const did = await resolveDrive();
  const fid = await resolveFile();
  const sheet = encSheet(sheetName);
  // Find the actual last non-empty row (skip blank rows left by deletes)
  const used = await readWorksheet(sheetName);
  const rows = used.values || [];
  let nextRow = rows.length + 1; // default: append after used range
  // Walk backwards to find the last row that has any non-empty cell
  for (let i = rows.length - 1; i >= 1; i--) {
    const hasData = rows[i].some((cell: any) => cell !== "" && cell != null);
    if (hasData) { nextRow = i + 2; break; } // i is 0-based, Excel rows are 1-based
  }
  const endCol = colLetter(values.length || 1);
  const range = `A${nextRow}:${endCol}${nextRow}`;
  return graphCall<any>("PATCH", `/drives/${did}/items/${fid}/workbook/worksheets('${sheet}')/range(address='${range}')`, { values: [values] });
}

export async function deleteRow(rowNumber: number, sheetName?: string): Promise<any> {
  const did = await resolveDrive();
  const fid = await resolveFile();
  const sheet = encSheet(sheetName);
  // Get column count to build the full row range
  const used = await readWorksheet(sheetName);
  const colCount = used.values?.[0]?.length || 10;
  const endCol = colLetter(colCount);
  const range = `A${rowNumber}:${endCol}${rowNumber}`;
  // Use Graph API's range/delete with shift-up to actually remove the row
  // instead of just clearing cells (which leaves blank rows)
  return graphCall<any>("POST", `/drives/${did}/items/${fid}/workbook/worksheets('${sheet}')/range(address='${range}')/delete`, { shift: "Up" });
}

export async function getWorksheetNames(): Promise<string[]> {
  const did = await resolveDrive();
  const fid = await resolveFile();
  const result = await graphCall<any>("GET", `/drives/${did}/items/${fid}/workbook/worksheets`);
  return (result.value || []).map((ws: any) => ws.name);
}

/** Reset cached file ID (useful after structural changes like row deletion) */
export function resetFileCache(): void {
  fileId = null;
}
