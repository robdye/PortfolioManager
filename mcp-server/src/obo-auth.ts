/**
 * OBO (On-Behalf-Of) Authentication Module for MCP Server.
 *
 * When a user's bearer token is provided (via Authorization header from Copilot),
 * exchanges it via MSAL OBO flow for downstream Dataverse/Graph tokens.
 * Falls back to client credentials when no user token is present (e.g. Digital Worker calls).
 */
import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";

function fetchWithTimeout(url: string | URL, options: RequestInit = {}, timeoutMs = 30000): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

const TENANT_ID = process.env.GRAPH_TENANT_ID || "";
const CLIENT_ID = process.env.GRAPH_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET || "";
const CRM_URL = process.env.CRM_URL || "https://orge2a9a349.crm.dynamics.com";

interface TokenCache {
  token: string;
  expiresAt: number;
}

// Cache OBO tokens per user+resource to avoid excessive token exchanges
const MAX_CACHE_SIZE = 100;
const oboCache = new Map<string, TokenCache>();

/**
 * Extract bearer token from Authorization header.
 */
export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.substring(7);
}

/**
 * Exchange a user's access token for a downstream resource token via OBO flow.
 */
async function exchangeOboToken(userToken: string, scope: string): Promise<string> {
  const tokenHash = createHash("sha256").update(userToken).digest("hex").substring(0, 32);
  const cacheKey = `${tokenHash}:${scope}`;
  const cached = oboCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 60000) {
    return cached.token;
  }

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    assertion: userToken,
    scope: scope,
    requested_token_use: "on_behalf_of",
  });

  const res = await fetchWithTimeout(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[OBO] Token exchange failed for scope ${scope}: ${res.status}`, errText.substring(0, 200));
    throw new Error(`OBO token exchange failed: ${res.status}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  if (oboCache.size >= MAX_CACHE_SIZE) {
    const firstKey = oboCache.keys().next().value!;
    oboCache.delete(firstKey);
  }
  oboCache.set(cacheKey, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

/**
 * Get a client credentials token (fallback when no user token).
 */
const appTokenCache = new Map<string, TokenCache>();

async function getAppToken(scope: string): Promise<string> {
  const cached = appTokenCache.get(scope);
  if (cached && Date.now() < cached.expiresAt - 60000) {
    return cached.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: scope,
  });

  const res = await fetchWithTimeout(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`App token failed: ${res.status} ${errText.substring(0, 200)}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  if (appTokenCache.size >= MAX_CACHE_SIZE) {
    const firstKey = appTokenCache.keys().next().value!;
    appTokenCache.delete(firstKey);
  }
  appTokenCache.set(scope, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

/**
 * Get a Dataverse token — OBO if user token present, client credentials otherwise.
 */
export async function getDataverseToken(userToken?: string | null): Promise<string> {
  const scope = `${CRM_URL}/.default`;
  if (userToken) {
    try {
      return await exchangeOboToken(userToken, scope);
    } catch (err) {
      console.warn("[OBO] Dataverse OBO failed, falling back to app token:", (err as Error).message);
    }
  }
  return getAppToken(scope);
}

/**
 * Get a Graph token — OBO if user token present, client credentials otherwise.
 */
export async function getGraphToken(userToken?: string | null): Promise<string> {
  const scope = "https://graph.microsoft.com/.default";
  if (userToken) {
    try {
      return await exchangeOboToken(userToken, scope);
    } catch (err) {
      console.warn("[OBO] Graph OBO failed, falling back to app token:", (err as Error).message);
    }
  }
  return getAppToken(scope);
}

/**
 * Express middleware: extracts user token from Authorization header and
 * attaches it to req for downstream use.
 */
export function oboMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (token) {
    (req as any).userToken = token;
    console.log("[OBO] User token present — will use delegated access");
  } else {
    console.log("[OBO] No user token — using app credentials");
  }
  next();
}

/**
 * Get the user token from the request (set by middleware).
 */
export function getUserToken(req: Request): string | null {
  return (req as any).userToken || null;
}
