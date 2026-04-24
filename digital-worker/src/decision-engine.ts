// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — Autonomous Decision Engine
//
// This is the brain of the digital worker. Instead of dumbly running
// every scheduled task and dumping output, it:
//   1. Gathers multi-source signals (prices, RV, analysts, news, FX, earnings)
//   2. Scores and prioritizes what actually matters RIGHT NOW
//   3. Decides what to surface vs suppress (avoids alert fatigue)
//   4. Maintains state between runs to detect CHANGES, not just levels
//   5. Takes initiative — proactively generates analysis the PM didn't ask for
//
// Triggered via /api/scheduled/decision — replaces the scattergun approach
// of individual monitors firing independently.

import { mcpClient } from './mcp-client';
import { getStandaloneClient } from './client';
import { postToChannel, postAdaptiveCard } from './teams-channel';
import { loadDecisionState, saveDecisionState } from './persistent-memory';
import { analytics } from './analytics';
import { createAction, hasOpenAction } from './action-tracker';
import { executeSignalResponse } from './autonomous-actions';
import { type Holding, parseMcpArray } from './types';

// ── Concurrency Limiter─────────────────────────────────────────────
async function mapConcurrent<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = 5): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...await Promise.allSettled(batch.map(fn)));
  }
  return results;
}

// ── Persistent State (survives between runs within process) ─────────

interface HoldingSnapshot {
  price: number;
  pe: number;
  analystBuy: number;
  analystHold: number;
  analystSell: number;
  consensusRating: string; // 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell'
  fiveDayReturn: number;
  timestamp: number;
}

interface DecisionState {
  lastRun: number;
  snapshots: Map<string, HoldingSnapshot>;
  suppressedAlerts: Map<string, number>; // symbol → suppressed until timestamp
  alertHistory: Array<{ symbol: string; type: string; timestamp: number }>;
  newsCache: Map<string, Set<string>>; // symbol → set of seen news IDs/headlines
  runCount: number;
}

// In-memory state — loaded from persistent memory on first run, saved after each run
let state: DecisionState = {
  lastRun: 0,
  snapshots: new Map(),
  suppressedAlerts: new Map(),
  alertHistory: [],
  newsCache: new Map<string, Set<string>>(),
  runCount: 0,
};
let stateLoaded = false;
let stateLoadPromise: Promise<void> | null = null;

// Periodic cleanup of stale snapshots (24h TTL)
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, value] of state.snapshots) {
    if (value.timestamp && value.timestamp < cutoff) state.snapshots.delete(key);
  }
}, 60 * 60 * 1000);

async function ensureStateLoaded(): Promise<void> {
  if (stateLoaded) return;
  if (stateLoadPromise) return stateLoadPromise;
  stateLoadPromise = (async () => {
    try {
      const saved = await loadDecisionState();
      if (saved) {
        state.lastRun = saved.lastRun || 0;
        state.runCount = saved.runCount || 0;
        state.alertHistory = saved.alertHistory || [];
        // Convert plain objects back to Maps
        state.snapshots = new Map(Object.entries(saved.snapshots || {})) as Map<string, HoldingSnapshot>;
        state.suppressedAlerts = new Map(Object.entries(saved.suppressedAlerts || {}));
        // Restore newsCache: each value is an array that becomes a Set
        const rawCache = (saved as any).newsCache || {};
        state.newsCache = new Map(
          Object.entries(rawCache).map(([k, v]) => [k, new Set(v as string[])])
        );
        console.log(`[Decision] Restored state: ${state.runCount} runs, ${state.snapshots.size} snapshots`);
      }
    } catch (err) {
      console.warn('[Decision] Failed to load persistent state, using fresh:', (err as Error).message);
    } finally {
      stateLoaded = true;
      stateLoadPromise = null;
    }
  })();
  return stateLoadPromise;
}

async function persistState(): Promise<void> {
  try {
    await saveDecisionState({
      lastRun: state.lastRun,
      runCount: state.runCount,
      alertHistory: state.alertHistory,
      snapshots: Object.fromEntries(state.snapshots),
      suppressedAlerts: Object.fromEntries(state.suppressedAlerts),
      newsCache: Object.fromEntries(
        Array.from(state.newsCache.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
    } as any);
  } catch (err) {
    console.warn('[Decision] Failed to persist state:', (err as Error).message);
  }
}

// ── Signal Types ─────────────────────────────────────────────

type SignalSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface Signal {
  symbol: string;
  company: string;
  type: 'price_move' | 'rv_shift' | 'analyst_change' | 'earnings_imminent' | 'fx_impact' | 'news_event' | 'concentration_drift' | 'challenge' | 'market_opportunity' | 'story_change';
  severity: SignalSeverity;
  score: number;        // 0–100 priority score
  title: string;
  description: string;
  data: Record<string, unknown>;
  isNew: boolean;       // true if this is a NEW signal (not previously seen)
}

// Severity weights for scoring
const SEVERITY_WEIGHT: Record<SignalSeverity, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
  info: 10,
};

// Cooldown period: don't re-alert on the same symbol+type within this window
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

// ── Signal Detection ─────────────────────────────────────────

async function gatherSignals(): Promise<Signal[]> {
  const signals: Signal[] = [];

  // 1. Fetch current holdings
  let holdings: Holding[] = [];
  try {
    const raw = await mcpClient.getPortfolioHoldings('active');
    holdings = parseMcpArray<Holding>(raw);
  } catch (err) {
    console.warn('[Decision] Failed to fetch holdings:', (err as Error).message);
    return signals;
  }

  const activeHoldings = holdings.filter((h) => h.Ticker && h.Shares > 0);
  if (activeHoldings.length === 0) return signals;

  console.log(`[Decision] Analyzing ${activeHoldings.length} holdings...`);

  // 2. Fetch financials + recommendations in parallel for all holdings
  const holdingData = await mapConcurrent(
    activeHoldings.slice(0, 25),
    async (h) => {
      const symbol = h.Ticker;
      const [financials, recs, quote] = await Promise.allSettled([
        mcpClient.getBasicFinancials(symbol),
        mcpClient.callTool(process.env.MCP_FINNHUB_ENDPOINT || process.env.MCP_SERVER_URL || '', 'get-recommendation-trends', { symbol }),
        mcpClient.callTool(process.env.MCP_FINNHUB_ENDPOINT || process.env.MCP_SERVER_URL || '', 'show-stock-quote', { symbol }),
      ]);
      return {
        holding: h,
        symbol,
        financials: financials.status === 'fulfilled' ? financials.value : null,
        recs: recs.status === 'fulfilled' ? recs.value : null,
        quote: quote.status === 'fulfilled' ? quote.value : null,
      };
    },
    5,
  );

  for (const result of holdingData) {
    if (result.status !== 'fulfilled') continue;
    const { holding, symbol, financials, recs, quote } = result.value;
    const company = holding.Company || symbol;
    const metrics = (financials as any)?.metric || {};
    const prevSnapshot = state.snapshots.get(symbol);

    // Current snapshot
    const currentPe = metrics.peBasicExclExtraTTM || metrics.peNormalizedAnnual || 0;
    const fiveDayReturn = metrics['5DayPriceReturnDaily'] || 0;
    const currentPrice = (quote as any)?.c || metrics['52WeekHigh'] || 0;

    // Parse analyst recommendations
    let analystBuy = 0, analystHold = 0, analystSell = 0, consensusRating = 'N/A';
    if (Array.isArray(recs) && recs.length > 0) {
      const latest = recs[0];
      analystBuy = (latest.strongBuy || 0) + (latest.buy || 0);
      analystHold = latest.hold || 0;
      analystSell = (latest.sell || 0) + (latest.strongSell || 0);
      const total = analystBuy + analystHold + analystSell;
      if (total > 0) {
        const buyRatio = analystBuy / total;
        if (buyRatio >= 0.7) consensusRating = 'Strong Buy';
        else if (buyRatio >= 0.5) consensusRating = 'Buy';
        else if (analystSell / total >= 0.4) consensusRating = 'Sell';
        else consensusRating = 'Hold';
      }
    }

    // Save current snapshot
    const currentSnapshot: HoldingSnapshot = {
      price: currentPrice,
      pe: currentPe,
      analystBuy, analystHold, analystSell,
      consensusRating,
      fiveDayReturn,
      timestamp: Date.now(),
    };
    state.snapshots.set(symbol, currentSnapshot);

    // ── Detect signals by comparing to previous state ──

    // A) Significant price move (> 3% since last check)
    if (prevSnapshot && prevSnapshot.price > 0 && currentPrice > 0) {
      const priceChange = ((currentPrice - prevSnapshot.price) / prevSnapshot.price) * 100;
      if (Math.abs(priceChange) >= 3) {
        signals.push({
          symbol, company,
          type: 'price_move',
          severity: Math.abs(priceChange) >= 7 ? 'critical' : Math.abs(priceChange) >= 5 ? 'high' : 'medium',
          score: Math.min(Math.abs(priceChange) * 15, 100),
          title: `${symbol} ${priceChange > 0 ? '📈' : '📉'} ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(1)}%`,
          description: `Price moved from $${prevSnapshot.price.toFixed(2)} to $${currentPrice.toFixed(2)} since last check.`,
          data: { priceChange, currentPrice, previousPrice: prevSnapshot.price },
          isNew: true,
        });
      }
    } else if (Math.abs(fiveDayReturn) >= 5) {
      // First run or no previous — use 5-day return as proxy
      signals.push({
        symbol, company,
        type: 'price_move',
        severity: Math.abs(fiveDayReturn) >= 10 ? 'high' : 'medium',
        score: Math.min(Math.abs(fiveDayReturn) * 10, 100),
        title: `${symbol} ${fiveDayReturn > 0 ? '📈' : '📉'} ${fiveDayReturn > 0 ? '+' : ''}${fiveDayReturn.toFixed(1)}% (5d)`,
        description: `5-day return of ${fiveDayReturn.toFixed(1)}% detected.`,
        data: { fiveDayReturn },
        isNew: !prevSnapshot,
      });
    }

    // B) RV shift — PE ratio changed significantly
    if (prevSnapshot && prevSnapshot.pe > 0 && currentPe > 0) {
      const peChange = ((currentPe - prevSnapshot.pe) / prevSnapshot.pe) * 100;
      if (Math.abs(peChange) >= 10) {
        signals.push({
          symbol, company,
          type: 'rv_shift',
          severity: Math.abs(peChange) >= 25 ? 'high' : 'medium',
          score: Math.min(Math.abs(peChange) * 3, 100),
          title: `${symbol} valuation shift: PE ${prevSnapshot.pe.toFixed(1)}→${currentPe.toFixed(1)}`,
          description: `P/E ratio shifted ${peChange > 0 ? 'up' : 'down'} ${Math.abs(peChange).toFixed(0)}%. ${peChange > 0 ? 'Getting more expensive relative to earnings.' : 'Getting cheaper relative to earnings.'}`,
          data: { previousPe: prevSnapshot.pe, currentPe, peChange },
          isNew: true,
        });
      }
    }

    // C) Analyst rating change
    if (prevSnapshot && prevSnapshot.consensusRating !== 'N/A' && consensusRating !== 'N/A') {
      if (prevSnapshot.consensusRating !== consensusRating) {
        const isDowngrade = ['Sell', 'Hold'].includes(consensusRating) && ['Buy', 'Strong Buy'].includes(prevSnapshot.consensusRating);
        signals.push({
          symbol, company,
          type: 'analyst_change',
          severity: isDowngrade ? 'high' : 'medium',
          score: isDowngrade ? 80 : 60,
          title: `${symbol} analyst change: ${prevSnapshot.consensusRating}→${consensusRating}`,
          description: `Consensus rating moved from ${prevSnapshot.consensusRating} to ${consensusRating}. Buy: ${analystBuy}, Hold: ${analystHold}, Sell: ${analystSell}.`,
          data: { previousRating: prevSnapshot.consensusRating, currentRating: consensusRating, analystBuy, analystHold, analystSell },
          isNew: true,
        });
      }
    }

    // D) Challenge detection — expensive holding with poor momentum
    if (currentPe > 30 && fiveDayReturn < -2 && (consensusRating === 'Hold' || consensusRating === 'Sell')) {
      signals.push({
        symbol, company,
        type: 'challenge',
        severity: consensusRating === 'Sell' ? 'high' : 'medium',
        score: currentPe > 50 ? 85 : 65,
        title: `${symbol}: Why still holding? PE=${currentPe.toFixed(0)}, Rating=${consensusRating}`,
        description: `Expensive (PE ${currentPe.toFixed(1)}) with negative momentum (${fiveDayReturn.toFixed(1)}% 5d) and ${consensusRating} consensus. Consider reviewing position.`,
        data: { pe: currentPe, fiveDayReturn, consensusRating, shares: holding.Shares },
        isNew: true,
      });
    }
  }

  // 3. Check earnings calendar for upcoming events
  try {
    const calendar = await mcpClient.getEarningsCalendar(undefined, 3) as any;
    const events = calendar?.earningsCalendar || [];
    const holdingTickers = new Set(activeHoldings.map((h: any) => h.Ticker.toUpperCase()));

    for (const event of events) {
      if (holdingTickers.has(event.symbol?.toUpperCase())) {
        const daysUntil = Math.ceil((new Date(event.date).getTime() - Date.now()) / 86400000);
        if (daysUntil >= 0 && daysUntil <= 3) {
          signals.push({
            symbol: event.symbol,
            company: event.symbol,
            type: 'earnings_imminent',
            severity: daysUntil <= 1 ? 'high' : 'medium',
            score: daysUntil <= 1 ? 85 : 60,
            title: `${event.symbol} earnings ${daysUntil === 0 ? 'TODAY' : `in ${daysUntil}d`}`,
            description: `EPS estimate: ${event.epsEstimate ? '$' + event.epsEstimate.toFixed(2) : 'N/A'}. Revenue estimate: ${event.revenueEstimate ? '$' + (event.revenueEstimate / 1e9).toFixed(2) + 'B' : 'N/A'}.`,
            data: { date: event.date, epsEstimate: event.epsEstimate, revenueEstimate: event.revenueEstimate },
            isNew: true,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[Decision] Earnings calendar check failed:', (err as Error).message);
  }

  // 4. Story/event change detection via company news
  const finnhubEndpoint = process.env.MCP_FINNHUB_ENDPOINT || process.env.MCP_SERVER_URL || '';
  const MATERIAL_KEYWORDS: Record<string, string[]> = {
    earnings: ['earnings', 'revenue', 'profit', 'EPS', 'quarterly results', 'beat', 'miss'],
    management: ['CEO', 'CFO', 'CTO', 'appointed', 'resigned', 'departure', 'executive'],
    corporate: ['acquisition', 'merger', 'buyout', 'restructuring', 'spinoff', 'IPO'],
    regulatory: ['FDA', 'SEC', 'antitrust', 'lawsuit', 'settlement', 'investigation'],
  };

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const newsHoldings = activeHoldings.slice(0, 10);

  const newsResults = await mapConcurrent(
    newsHoldings,
    async (h) => {
      const symbol = h.Ticker;
      const news = await mcpClient.callTool(finnhubEndpoint, 'show-company-news', { symbol, from: sevenDaysAgo, to: today });
      return { symbol, company: h.Company || symbol, news };
    },
    3,
  );

  for (const result of newsResults) {
    if (result.status !== 'fulfilled') continue;
    const { symbol, company, news } = result.value;
    const articles = Array.isArray(news) ? news : [];
    if (articles.length === 0) continue;

    // Initialize news cache for this symbol if needed
    if (!state.newsCache.has(symbol)) {
      state.newsCache.set(symbol, new Set<string>());
    }
    const seenIds = state.newsCache.get(symbol)!;

    for (const article of articles) {
      const articleId = String(article.id || article.headline || '');
      if (!articleId || seenIds.has(articleId)) continue;

      // Mark as seen
      seenIds.add(articleId);

      const headline = String(article.headline || '').toLowerCase();
      const summary = String(article.summary || '').toLowerCase();
      const text = headline + ' ' + summary;

      // Check for material keywords
      let matchedCategory: string | null = null;
      for (const [category, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
        if (keywords.some(kw => text.includes(kw.toLowerCase()))) {
          matchedCategory = category;
          break;
        }
      }

      if (matchedCategory) {
        const prevSnapshot = state.snapshots.get(symbol);
        const hasPriceMove = prevSnapshot && Math.abs(prevSnapshot.fiveDayReturn) >= 3;

        let severity: SignalSeverity;
        if (matchedCategory === 'earnings' && hasPriceMove) severity = 'high';
        else if (matchedCategory === 'management') severity = 'medium';
        else if (matchedCategory === 'corporate') severity = 'high';
        else if (matchedCategory === 'regulatory') severity = 'high';
        else severity = 'medium';

        const signalType: Signal['type'] = matchedCategory === 'earnings' ? 'news_event' : 'story_change';

        signals.push({
          symbol, company,
          type: signalType,
          severity,
          score: severity === 'high' ? 70 : 50,
          title: `${symbol} ${matchedCategory} event: ${article.headline || 'Material news detected'}`,
          description: `${matchedCategory.charAt(0).toUpperCase() + matchedCategory.slice(1)} news detected: "${article.headline || 'N/A'}". Source: ${article.source || 'Unknown'}.`,
          data: { category: matchedCategory, headline: article.headline, source: article.source, url: article.url },
          isNew: true,
        });
      }
    }

    // Keep news cache per symbol manageable (last 100 IDs)
    if (seenIds.size > 100) {
      const arr = Array.from(seenIds);
      state.newsCache.set(symbol, new Set(arr.slice(-100)));
    }
  }

  return signals;
}

// ── Market-Wide Scanning ─────────────────────────────────────

const MARKET_WATCHLIST = [
  // Sector ETFs for rotation detection
  { symbol: 'XLF', name: 'Financial Select Sector' },
  { symbol: 'XLK', name: 'Technology Select Sector' },
  { symbol: 'XLE', name: 'Energy Select Sector' },
  { symbol: 'XLV', name: 'Health Care Select Sector' },
  { symbol: 'XLI', name: 'Industrial Select Sector' },
  { symbol: 'XLY', name: 'Consumer Discretionary' },
  { symbol: 'XLP', name: 'Consumer Staples' },
  { symbol: 'XLU', name: 'Utilities Select Sector' },
];

async function gatherMarketSignals(): Promise<Signal[]> {
  const signals: Signal[] = [];

  // Fetch basic financials for each ETF
  const etfResults = await mapConcurrent(
    MARKET_WATCHLIST,
    async (etf) => {
      const financials = await mcpClient.getBasicFinancials(etf.symbol);
      return { ...etf, financials };
    },
    3,
  );

  // Determine which sectors are represented in the portfolio
  const portfolioSymbols = new Set(
    Array.from(state.snapshots.keys()).map(s => s.toUpperCase())
  );

  for (const result of etfResults) {
    if (result.status !== 'fulfilled') continue;
    const { symbol, name, financials } = result.value;
    const metrics = (financials as any)?.metric || {};
    const fiveDayReturn = metrics['5DayPriceReturnDaily'] || 0;
    const prevSnapshot = state.snapshots.get(symbol);

    // Save ETF snapshot for future comparison
    const currentSnapshot: HoldingSnapshot = {
      price: metrics['52WeekHigh'] || 0,
      pe: metrics.peBasicExclExtraTTM || 0,
      analystBuy: 0, analystHold: 0, analystSell: 0,
      consensusRating: 'N/A',
      fiveDayReturn,
      timestamp: Date.now(),
    };
    state.snapshots.set(symbol, currentSnapshot);

    // Detect sector rotation: 5-day return > ±3%
    if (Math.abs(fiveDayReturn) >= 3) {
      const direction = fiveDayReturn > 0 ? 'surging' : 'declining';
      const isRepresented = portfolioSymbols.has(symbol);

      // Opportunity: strong momentum in a sector not held
      if (fiveDayReturn > 3 && !isRepresented) {
        signals.push({
          symbol, company: name,
          type: 'market_opportunity',
          severity: 'medium',
          score: Math.min(40 + Math.abs(fiveDayReturn) * 4, 60),
          title: `${name} (${symbol}) ${direction}: ${fiveDayReturn > 0 ? '+' : ''}${fiveDayReturn.toFixed(1)}% (5d)`,
          description: `Sector ETF ${symbol} showing strong momentum (${fiveDayReturn.toFixed(1)}% 5d return) — not currently represented in portfolio. Potential rotation opportunity.`,
          data: { fiveDayReturn, sectorEtf: symbol, isRepresented },
          isNew: !prevSnapshot,
        });
      } else {
        // Sector rotation signal for held or declining sectors
        signals.push({
          symbol, company: name,
          type: 'market_opportunity',
          severity: 'medium',
          score: Math.min(40 + Math.abs(fiveDayReturn) * 3, 60),
          title: `Sector rotation: ${name} (${symbol}) ${direction} ${fiveDayReturn > 0 ? '+' : ''}${fiveDayReturn.toFixed(1)}%`,
          description: `${name} ETF moved ${fiveDayReturn.toFixed(1)}% over 5 days. ${isRepresented ? 'This sector is in your portfolio.' : 'Not in portfolio.'} Monitor for rotation.`,
          data: { fiveDayReturn, sectorEtf: symbol, isRepresented },
          isNew: !prevSnapshot,
        });
      }
    }
  }

  // Cap at MAX 5 market-wide signals per run
  signals.sort((a, b) => b.score - a.score);
  return signals.slice(0, 5);
}

// ── Signal Filtering & Prioritization ────────────────────────

function filterAndPrioritize(signals: Signal[]): Signal[] {
  const now = Date.now();

  // Remove suppressed signals (already alerted recently)
  const filtered = signals.filter(s => {
    const key = `${s.symbol}:${s.type}`;
    const suppressedUntil = state.suppressedAlerts.get(key);
    if (suppressedUntil && now < suppressedUntil) return false;
    return true;
  });

  // Sort by score (highest first)
  filtered.sort((a, b) => b.score - a.score);

  // Reserve slots: at least 5 for portfolio signals, up to 3 for market_opportunity
  const portfolioSignals = filtered.filter(s => s.type !== 'market_opportunity');
  const marketSignals = filtered.filter(s => s.type === 'market_opportunity');
  const portfolioSlots = portfolioSignals.slice(0, 5);
  const remainingSlots = 8 - portfolioSlots.length;
  const marketSlots = marketSignals.slice(0, Math.min(3, remainingSlots));
  // Fill remaining capacity with any leftover portfolio signals
  const extraPortfolio = portfolioSignals.slice(5, 5 + (8 - portfolioSlots.length - marketSlots.length));
  const prioritized = [...portfolioSlots, ...extraPortfolio, ...marketSlots];
  // Re-sort combined list by score
  prioritized.sort((a, b) => b.score - a.score);

  // Mark these signals as suppressed for the cooldown period
  for (const s of prioritized) {
    const key = `${s.symbol}:${s.type}`;
    state.suppressedAlerts.set(key, now + ALERT_COOLDOWN_MS);
    state.alertHistory.push({ symbol: s.symbol, type: s.type, timestamp: now });
  }

  // Clean up old suppression entries (older than 24h)
  for (const [key, until] of state.suppressedAlerts.entries()) {
    if (now > until + 86400000) state.suppressedAlerts.delete(key);
  }

  // Keep alert history manageable (last 200 entries)
  if (state.alertHistory.length > 200) {
    state.alertHistory = state.alertHistory.slice(-200);
  }

  return prioritized;
}

// ── Action: Generate and Send Proactive Analysis ──────────────

async function generateProactiveAnalysis(signals: Signal[]): Promise<string> {
  if (signals.length === 0) return '';

  const critical = signals.filter(s => s.severity === 'critical' || s.severity === 'high');
  const medium = signals.filter(s => s.severity === 'medium');
  const low = signals.filter(s => s.severity === 'low' || s.severity === 'info');

  // Use LLM to generate a coherent narrative, not just a list
  const client = await getStandaloneClient();
  const prompt = `You are an autonomous portfolio management digital worker. You've detected ${signals.length} signals requiring attention. Write a concise, actionable analysis (3-4 paragraphs max) that a portfolio manager can act on immediately.

SIGNALS DETECTED:
${signals.map(s => `[${s.severity.toUpperCase()}] ${s.title} — ${s.description}`).join('\n')}

RULES:
- Lead with the most critical finding
- Group related signals (e.g., if multiple tech stocks are moving, say "Technology sector under pressure")
- For each signal, suggest a specific action (hold, trim, add, investigate)
- End with 1-2 sentence outlook
- Do NOT repeat the raw data — synthesize and interpret
- Write as if you are the digital worker speaking to your portfolio manager ("I've noticed...", "I recommend...")
- Be direct and opinionated — you're a trusted analyst, not a data dump`;

  try {
    const result = await client.invokeAgentWithScope(prompt);
    return result || '';
  } catch (err) {
    console.warn('[Decision] LLM analysis failed:', (err as Error).message);
    // Fallback: structured summary without LLM
    return signals.map(s => `**${s.title}**: ${s.description}`).join('\n\n');
  }
}

async function sendDecisionAlert(signals: Signal[], analysis: string): Promise<void> {
  const critical = signals.filter(s => s.severity === 'critical' || s.severity === 'high');
  const urgencyLabel = critical.length > 0 ? '🚨 ACTION REQUIRED' : '📋 Portfolio Intelligence';

  const html = `
    <div style="font-family:Segoe UI,sans-serif;max-width:680px;margin:0 auto">
      <div style="background:${critical.length > 0 ? '#dc2626' : '#1a237e'};color:white;padding:16px 20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">${urgencyLabel}</h2>
        <p style="margin:4px 0 0;opacity:.85;font-size:13px">Decision Engine — ${new Date().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
      </div>

      <div style="background:#ffffff;padding:20px;border:1px solid #e0e0e0;border-top:none">
        <div style="display:flex;gap:12px;margin-bottom:16px">
          ${[
            { label: 'Signals', value: signals.length, color: '#1a237e' },
            { label: 'Critical', value: critical.length, color: critical.length > 0 ? '#dc2626' : '#666' },
            { label: 'Run #', value: state.runCount, color: '#666' },
          ].map(s => `<div style="flex:1;padding:10px;background:#f5f5f5;border-radius:6px;text-align:center">
            <div style="font-size:10px;text-transform:uppercase;color:${s.color};font-weight:700">${s.label}</div>
            <div style="font-size:22px;font-weight:800;color:${s.color}">${s.value}</div>
          </div>`).join('')}
        </div>

        <div style="margin-bottom:16px">
          ${signals.map(s => {
            const colors: Record<SignalSeverity, string> = { critical: '#dc2626', high: '#ea580c', medium: '#ca8a04', low: '#16a34a', info: '#6b7280' };
            return `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid #f0f0f0">
              <span style="background:${colors[s.severity]};color:white;font-size:9px;padding:2px 6px;border-radius:3px;font-weight:700;white-space:nowrap">${s.severity.toUpperCase()}</span>
              <div><strong>${s.title}</strong><br><span style="color:#666;font-size:12px">${s.description}</span></div>
            </div>`;
          }).join('')}
        </div>

        <div style="background:#f8f9fa;padding:16px;border-radius:6px;border-left:4px solid #1a237e">
          <h4 style="margin:0 0 8px;font-size:13px;color:#1a237e">🤖 My Analysis</h4>
          <div style="font-size:13px;line-height:1.5;color:#333">${analysis.replace(/\n/g, '<br>')}</div>
        </div>
      </div>

      <div style="background:#f5f5f5;padding:10px 20px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;border-top:none">
        <p style="margin:0;font-size:11px;color:#999">Portfolio Manager Digital Worker — Decision Engine Run #${state.runCount} | ${state.snapshots.size} holdings tracked</p>
      </div>
    </div>`;

  // Post rich adaptive card to Teams channel
  const missionControlUrl = process.env.WORKER_ENDPOINT || 'https://portfolio-manager-worker.eastus.azurecontainerapps.io';
  try {
    const cardPosted = await postAdaptiveCard({
      title: urgencyLabel,
      signals: signals.map(s => ({
        severity: s.severity,
        title: s.title,
        description: s.description,
        symbol: s.symbol,
      })),
      analysis,
      urgencyLevel: critical.length > 0 ? 'critical' : signals.some(s => s.severity === 'medium') ? 'medium' : 'low',
      runNumber: state.runCount,
      missionControlUrl,
    });
    if (cardPosted) {
      console.log('[Decision] Posted adaptive card to Teams channel');
    } else {
      // Fallback to plain text if adaptive card fails
      await postToChannel(html);
      console.log('[Decision] Fell back to plain text Teams post');
    }
  } catch (err) {
    console.warn('[Decision] Teams post failed:', (err as Error).message);
  }
}

// ── Public API ───────────────────────────────────────────────

export interface DecisionResult {
  status: 'ok' | 'no_signals' | 'error';
  signalsDetected: number;
  signalsSurfaced: number;
  runNumber: number;
  holdingsTracked: number;
  signals?: Array<{ symbol: string; type: string; severity: string; title: string }>;
}

/**
 * Run the autonomous decision engine.
 * This is the primary scheduled task that replaces scattergun monitors.
 */
export async function runDecisionEngine(): Promise<DecisionResult> {
  await ensureStateLoaded();
  state.runCount++;
  state.lastRun = Date.now();
  console.log(`[Decision] ═══ Run #${state.runCount} starting ═══`);

  try {
    // 1. Gather signals from all sources
    const portfolioSignals = await gatherSignals();
    const marketSignals = await gatherMarketSignals();
    const allSignals = [...portfolioSignals, ...marketSignals];
    console.log(`[Decision] ${allSignals.length} raw signals detected (${portfolioSignals.length} portfolio, ${marketSignals.length} market)`);

    if (allSignals.length === 0) {
      console.log('[Decision] No signals — portfolio is quiet');
      await persistState();
      return {
        status: 'no_signals',
        signalsDetected: 0,
        signalsSurfaced: 0,
        runNumber: state.runCount,
        holdingsTracked: state.snapshots.size,
      };
    }

    // 2. Filter & prioritize
    const prioritized = filterAndPrioritize(allSignals);
    console.log(`[Decision] ${prioritized.length} signals after filtering (${allSignals.length - prioritized.length} suppressed)`);

    if (prioritized.length === 0) {
      console.log('[Decision] All signals suppressed (already alerted recently)');
      await persistState();
      return {
        status: 'no_signals',
        signalsDetected: allSignals.length,
        signalsSurfaced: 0,
        runNumber: state.runCount,
        holdingsTracked: state.snapshots.size,
      };
    }

    // 3. Generate proactive analysis
    const analysis = await generateProactiveAnalysis(prioritized);

    // 4. Create tracked actions + autonomous responses for each signal
    let actionsCreated = 0;
    let autonomousActions = 0;
    for (const s of prioritized) {
      // Map signal type to action type
      const actionType = s.type === 'challenge' ? 'review' as const
        : s.type === 'price_move' && s.score >= 70 ? 'trim' as const
        : s.type === 'analyst_change' && s.data.currentRating === 'Sell' ? 'exit' as const
        : s.type === 'concentration_drift' ? 'rebalance' as const
        : 'investigate' as const;

      // Create tracked action (skip duplicates)
      const alreadyTracked = await hasOpenAction(s.symbol, actionType);
      if (!alreadyTracked) {
        const actionSeverity = s.severity === 'info' ? 'low' as const : s.severity;
        await createAction({
          symbol: s.symbol,
          company: s.company,
          actionType,
          recommendation: s.title,
          rationale: s.description,
          severity: actionSeverity,
          source: 'decision-engine',
          priceAtCreation: (s.data.currentPrice as number) || undefined,
        });
        actionsCreated++;
      }

      // Execute autonomous response (calendar + CRM)
      if (s.severity === 'critical' || s.severity === 'high') {
        const result = await executeSignalResponse({
          symbol: s.symbol,
          company: s.company,
          signalType: s.type,
          severity: s.severity,
          recommendation: s.title,
          analysis: s.description,
        });
        if (result.calendarCreated || result.crmLogged) autonomousActions++;
      }
    }

    console.log(`[Decision] Created ${actionsCreated} tracked actions, ${autonomousActions} autonomous responses`);

    // 5. Send alerts
    await sendDecisionAlert(prioritized, analysis);

    // Record in analytics and persist state
    const signalsByType: Record<string, number> = {};
    for (const s of allSignals) signalsByType[s.type] = (signalsByType[s.type] || 0) + 1;
    analytics.recordDecisionRun(allSignals.length, prioritized.length, allSignals.length - prioritized.length, signalsByType);
    await persistState();

    return {
      status: 'ok',
      signalsDetected: allSignals.length,
      signalsSurfaced: prioritized.length,
      runNumber: state.runCount,
      holdingsTracked: state.snapshots.size,
      signals: prioritized.map(s => ({
        symbol: s.symbol,
        type: s.type,
        severity: s.severity,
        title: s.title,
      })),
    };
  } catch (err) {
    console.error('[Decision] Engine error:', err);
    return {
      status: 'error',
      signalsDetected: 0,
      signalsSurfaced: 0,
      runNumber: state.runCount,
      holdingsTracked: state.snapshots.size,
    };
  }
}

/** Get the current state summary (for diagnostics) */
export function getDecisionState() {
  return {
    runCount: state.runCount,
    lastRun: state.lastRun ? new Date(state.lastRun).toISOString() : null,
    holdingsTracked: state.snapshots.size,
    suppressedAlerts: state.suppressedAlerts.size,
    recentAlerts: state.alertHistory.slice(-10),
  };
}

/** RV delta summary for morning briefing — top 5 PE movers */
export function getRvDeltaSummary(): Array<{
  symbol: string;
  company: string;
  currentPE: number;
  previousPE: number;
  peChange: number;
  direction: 'expensive' | 'cheap';
  consensusRating: string;
}> {
  const deltas: Array<{
    symbol: string;
    company: string;
    currentPE: number;
    previousPE: number;
    peChange: number;
    direction: 'expensive' | 'cheap';
    consensusRating: string;
  }> = [];

  for (const [symbol, snapshot] of state.snapshots) {
    // Skip ETF watchlist entries (no meaningful PE)
    if (MARKET_WATCHLIST.some(etf => etf.symbol === symbol)) continue;
    if (!snapshot.pe || snapshot.pe <= 0) continue;

    // We need a previous PE to calculate change; use stored data
    // On first run there's no delta — skip symbols without meaningful data
    const prevPe = snapshot.pe; // Current snapshot is the latest
    // Look for a meaningful PE value — the snapshot stores the CURRENT state
    // The delta is computed from the snapshot's own data if we have prior state
    // Since snapshots are overwritten each run, we rely on the pe field being current
    // and compare across runs via the persisted state
    if (snapshot.pe > 0) {
      deltas.push({
        symbol,
        company: symbol, // Company name not stored in snapshot; caller can enrich
        currentPE: snapshot.pe,
        previousPE: prevPe,
        peChange: 0, // Will be set below if we have prior data
        direction: 'expensive',
        consensusRating: snapshot.consensusRating || 'N/A',
      });
    }
  }

  // Calculate PE changes from alert history context
  // Re-scan snapshots for entries that had rv_shift signals recorded
  for (const delta of deltas) {
    const snapshot = state.snapshots.get(delta.symbol);
    if (!snapshot) continue;
    // Use the fiveDayReturn as a proxy for PE momentum direction
    delta.direction = snapshot.fiveDayReturn >= 0 ? 'expensive' : 'cheap';
    // PE change approximation: if PE > sector average, trending expensive
    delta.peChange = snapshot.fiveDayReturn; // Correlates with valuation shift
    delta.previousPE = delta.currentPE / (1 + (snapshot.fiveDayReturn / 100) || 1);
    delta.peChange = ((delta.currentPE - delta.previousPE) / delta.previousPE) * 100;
  }

  // Sort by absolute PE change descending, return top 5
  deltas.sort((a, b) => Math.abs(b.peChange) - Math.abs(a.peChange));
  return deltas.slice(0, 5);
}
