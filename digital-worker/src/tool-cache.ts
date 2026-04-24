// Portfolio Manager Digital Worker — Tool Result Cache
//
// LRU cache with TTL for read-only MCP tool results.
// Avoids redundant API calls during multi-signal analysis
// where the same stock quote / financials are fetched repeatedly.
//
// Inspired by CorpGen's caching layer.
// Config: 500 entries max, 60s default TTL, per-tool TTL overrides.

import { analytics } from './analytics';

interface CacheEntry {
  key: string;
  value: unknown;
  expiresAt: number;
  createdAt: number;
  accessCount: number;
  lastAccessedAt: number;
}

// ── TTL Configuration per Tool ──────────────────────────────────────

const TOOL_TTL_SECONDS: Record<string, number> = {
  // Market data — short TTL (prices change frequently)
  'show-stock-quote': 30,
  'get-basic-financials': 60,
  'get-forex-rates': 120,

  // Analyst/research — longer TTL (changes daily at most)
  'get-recommendation-trends': 300,
  'get-company-news': 180,
  'get-market-news': 120,
  'search-symbol': 600,
  'get-peers': 3600,
  'get-insider-transactions': 300,
  'get-insider-sentiment': 300,
  'get-sec-filings': 600,
  'get-reported-financials': 3600,

  // Portfolio data — medium TTL (changes with trades)
  'get-portfolio-holdings': 60,
  'get-concentration-risk': 120,
  'get-stress-test': 120,
  'get-relative-value': 120,
  'get-rv-shifts': 120,
  'get-challenge-holdings': 120,
  'get-benchmark-comparison': 120,

  // CRM data — longer TTL
  'get-crm-pipeline': 300,
  'get-crm-account': 300,
  'get-crm-contacts': 300,
  'get-deal-tracker': 300,
  'get-earnings-calendar': 300,
  'get-ipo-calendar': 3600,
};

const DEFAULT_TTL_SECONDS = 60;
const MAX_ENTRIES = 500;

// ── LRU Cache Implementation ───────────────────────────────────────

class ToolCache {
  private cache = new Map<string, CacheEntry>();
  private hitCount = 0;
  private missCount = 0;

  /**
   * Generate a cache key from tool name and arguments.
   */
  private makeKey(toolName: string, args: Record<string, unknown>): string {
    const sortedArgs = Object.keys(args)
      .sort()
      .map(k => `${k}=${JSON.stringify(args[k])}`)
      .join('&');
    return `${toolName}?${sortedArgs}`;
  }

  /**
   * Get a cached result, or null if not cached / expired.
   */
  get(toolName: string, args: Record<string, unknown>): unknown | null {
    const key = this.makeKey(toolName, args);
    const entry = this.cache.get(key);

    if (!entry) {
      this.missCount++;
      return null;
    }

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }

    // LRU: move to end (Map preserves insertion order)
    this.cache.delete(key);
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();
    this.cache.set(key, entry);
    this.hitCount++;

    return entry.value;
  }

  /**
   * Store a tool result in the cache.
   */
  set(toolName: string, args: Record<string, unknown>, value: unknown): void {
    const key = this.makeKey(toolName, args);
    const ttl = (TOOL_TTL_SECONDS[toolName] || DEFAULT_TTL_SECONDS) * 1000;

    // Evict oldest entries if at capacity
    while (this.cache.size >= MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      key,
      value,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessedAt: Date.now(),
    });
  }

  /**
   * Invalidate all entries for a specific tool (e.g., after a write operation).
   */
  invalidateTool(toolName: string): void {
    const prefix = `${toolName}?`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  /**
   * Get cache statistics for analytics.
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitCount: number;
    missCount: number;
    hitRate: number;
    oldestEntryAge: number;
  } {
    const total = this.hitCount + this.missCount;
    let oldestAge = 0;
    const firstEntry = this.cache.values().next().value as CacheEntry | undefined;
    if (firstEntry) {
      oldestAge = Date.now() - firstEntry.createdAt;
    }

    return {
      size: this.cache.size,
      maxSize: MAX_ENTRIES,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: total > 0 ? this.hitCount / total : 0,
      oldestEntryAge: oldestAge,
    };
  }
}

// Singleton
export const toolCache = new ToolCache();

// ── Write-Through Cache Wrapper ─────────────────────────────────────
// Tools that modify data should invalidate related caches

const WRITE_TOOLS = new Set([
  'upsert-holding', 'delete-holding',
  'upsert-deal', 'update-compliance',
]);

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName);
}

export function invalidateAfterWrite(toolName: string): void {
  if (toolName.includes('holding')) {
    toolCache.invalidateTool('get-portfolio-holdings');
    toolCache.invalidateTool('get-concentration-risk');
    toolCache.invalidateTool('get-stress-test');
    toolCache.invalidateTool('get-relative-value');
    toolCache.invalidateTool('get-rv-shifts');
    toolCache.invalidateTool('get-challenge-holdings');
    toolCache.invalidateTool('get-benchmark-comparison');
  } else if (toolName.includes('deal') || toolName.includes('compliance')) {
    toolCache.invalidateTool('get-crm-pipeline');
    toolCache.invalidateTool('get-deal-tracker');
    toolCache.invalidateTool('get-compliance-status');
  }
}
