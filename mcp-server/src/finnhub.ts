/**
 * Finnhub REST API client (free tier).
 * All methods return parsed JSON. Rate limit: 60 calls/min.
 */

const BASE = "https://finnhub.io/api/v1";

function fetchWithTimeout(url: string | URL, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function apiKey(): string {
  return process.env.FINNHUB_API_KEY ?? "";
}

async function get<T = unknown>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("token", apiKey());
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  // Retry once on 429 rate limit
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchWithTimeout(url.toString());
    if (res.status === 429 && attempt === 0) {
      const retryAfter = Math.min(parseInt(res.headers.get('Retry-After') || '1', 10), 10) * 1000;
      console.warn(`[Finnhub] Rate limited on ${path}, retrying after ${retryAfter}ms…`);
      await new Promise((r) => setTimeout(r, retryAfter));
      continue;
    }
    if (!res.ok) throw new Error(`Finnhub ${path}: ${res.status} ${res.statusText}`);
    return res.json() as Promise<T>;
  }
  throw new Error(`Finnhub ${path}: rate limited after retry`);
}

// ── Stock Price ──
export const quote = (symbol: string) => get("/quote", { symbol });
export const marketStatus = (exchange: string) => get("/stock/market-status", { exchange });

// ── Company ──
export const companyProfile2 = (symbol: string) => get("/stock/profile2", { symbol });
export const basicFinancials = (symbol: string) => get("/stock/metric", { symbol, metric: "all" });
export const peers = (symbol: string) => get<string[]>("/stock/peers", { symbol });
export const recommendationTrends = (symbol: string) => get("/stock/recommendation", { symbol });
export const earnings = (symbol: string, limit = 4) => get("/stock/earnings", { symbol, limit });

// ── News ──
export const marketNews = (category = "general", minId = 0) => get("/news", { category, minId });
export const companyNews = (symbol: string, from: string, to: string) =>
  get("/company-news", { symbol, from, to });

// ── Insider ──
export const insiderTransactions = (symbol: string) => get("/stock/insider-transactions", { symbol });
export const insiderSentiment = (symbol: string, from: string, to: string) =>
  get("/stock/insider-sentiment", { symbol, from, to });

// ── Search & Calendar ──
export const symbolLookup = (q: string) => get("/search", { q });
export const ipoCalendar = (from: string, to: string) => get("/calendar/ipo", { from, to });
export const earningsCalendar = (from?: string, to?: string, symbol?: string) => {
  const p: Record<string, string> = {};
  if (from) p.from = from;
  if (to) p.to = to;
  if (symbol) p.symbol = symbol;
  return get("/calendar/earnings", p);
};

// ── SEC ──
export const filings = (symbol: string) => get("/stock/filings", { symbol });
export const financialsReported = (symbol: string, freq = "annual") =>
  get("/stock/financials-reported", { symbol, freq });

// ── Forex (free fallback via Frankfurter API when Finnhub returns 403) ──
export async function forexRates(base = "USD") {
  try {
    const data = await get("/forex/rates", { base });
    // Check if data has actual rates (Finnhub returns {} on free tier)
    if (data && typeof data === "object" && Object.keys(data as Record<string, unknown>).length > 1) return data;
  } catch { /* Finnhub forex is paid-only, fall through */ }
  // Fallback: Frankfurter API (free, ECB data, no key needed)
  const res = await fetchWithTimeout(`https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}`);
  if (!res.ok) throw new Error(`Frankfurter FX API: ${res.status} ${res.statusText}`);
  const fx = await res.json() as { base: string; date: string; rates: Record<string, number> };
  return { base: fx.base, quote: fx.rates };
}

export const forexSymbols = (exchange = "oanda") => get("/forex/symbol", { exchange });

export async function forexCandles(symbol: string, resolution: string, from: number, to: number) {
  try {
    return await get("/forex/candle", { symbol, resolution, from, to });
  } catch {
    // Finnhub forex candles is paid-only
    return { s: "no_data", note: "FX candle history requires Finnhub premium. Use get-fx-rate for live spot rates." };
  }
}

// ── Earnings Calendar ──
export const earningsCalendarRange = (from: string, to: string) =>
  get("/calendar/earnings", { from, to });
export const earningsCalendarSymbol = (symbol: string) =>
  get("/calendar/earnings", { symbol });

// ── IPO Calendar ──
export const ipoCalendarRange = (from: string, to: string) =>
  get("/calendar/ipo", { from, to });
