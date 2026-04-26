/**
 * Portfolio Manager — Azure Redis Cache
 * Hot-path state management: conversation cache, distributed locks, session state, market data cache.
 * Falls back to in-memory Map when Redis is not configured.
 */

import { createClient, RedisClientType } from 'redis';

// ── Configuration ──
const REDIS_URL = process.env.REDIS_URL || '';
const REDIS_KEY_PREFIX = 'pm:';
const DEFAULT_TTL = 3600; // 1 hour

let redisClient: RedisClientType | null = null;
let connected = false;

// In-memory fallback
const memCache = new Map<string, { value: string; expiresAt: number }>();
const MAX_MEM_CACHE = 5000;

// ── Initialization ──

export async function initRedis(): Promise<void> {
  if (!REDIS_URL) {
    console.log('[Redis] Not configured — using in-memory cache');
    return;
  }

  try {
    redisClient = createClient({ url: REDIS_URL });

    redisClient.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
      connected = false;
    });

    redisClient.on('connect', () => {
      console.log('[Redis] Connected');
      connected = true;
    });

    redisClient.on('reconnecting', () => {
      console.log('[Redis] Reconnecting...');
    });

    await redisClient.connect();
    connected = true;
    console.log('[Redis] Azure Redis Cache connected');
  } catch (err) {
    console.error('[Redis] Connection failed:', (err as Error).message);
    console.log('[Redis] Falling back to in-memory cache');
    redisClient = null;
  }
}

// ── Core Operations ──

export async function cacheGet(key: string): Promise<string | null> {
  const fullKey = `${REDIS_KEY_PREFIX}${key}`;

  if (redisClient && connected) {
    try {
      return await redisClient.get(fullKey);
    } catch (err) {
      console.error('[Redis] GET error:', (err as Error).message);
    }
  }

  const entry = memCache.get(fullKey);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  if (entry) memCache.delete(fullKey);
  return null;
}

export async function cacheSet(key: string, value: string, ttlSeconds: number = DEFAULT_TTL): Promise<void> {
  const fullKey = `${REDIS_KEY_PREFIX}${key}`;

  if (redisClient && connected) {
    try {
      await redisClient.set(fullKey, value, { EX: ttlSeconds });
      return;
    } catch (err) {
      console.error('[Redis] SET error:', (err as Error).message);
    }
  }

  if (memCache.size >= MAX_MEM_CACHE) {
    const oldestKey = memCache.keys().next().value;
    if (oldestKey) memCache.delete(oldestKey);
  }
  memCache.set(fullKey, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheDel(key: string): Promise<void> {
  const fullKey = `${REDIS_KEY_PREFIX}${key}`;

  if (redisClient && connected) {
    try {
      await redisClient.del(fullKey);
    } catch {
      // fallthrough
    }
  }

  memCache.delete(fullKey);
}

// ── Conversation Cache ──

export async function cacheConversation(userId: string, messages: string): Promise<void> {
  await cacheSet(`conv:${userId}`, messages, 1800); // 30 min TTL
}

export async function getCachedConversation(userId: string): Promise<string | null> {
  return cacheGet(`conv:${userId}`);
}

// ── Market Data Cache (PM-specific) ──

export async function cacheMarketData(symbol: string, data: string): Promise<void> {
  await cacheSet(`market:${symbol}`, data, 300); // 5 min TTL
}

export async function getCachedMarketData(symbol: string): Promise<string | null> {
  return cacheGet(`market:${symbol}`);
}

// ── Portfolio Snapshot Cache (PM-specific) ──

export async function cachePortfolioSnapshot(userId: string, snapshot: string): Promise<void> {
  await cacheSet(`portfolio:${userId}`, snapshot, 900); // 15 min TTL
}

export async function getCachedPortfolioSnapshot(userId: string): Promise<string | null> {
  return cacheGet(`portfolio:${userId}`);
}

// ── Distributed Locking ──

export async function acquireLock(lockName: string, ttlSeconds: number = 60): Promise<boolean> {
  const fullKey = `${REDIS_KEY_PREFIX}lock:${lockName}`;
  const lockValue = `${process.pid}-${Date.now()}`;

  if (redisClient && connected) {
    try {
      const result = await redisClient.set(fullKey, lockValue, { NX: true, EX: ttlSeconds });
      return result === 'OK';
    } catch (err) {
      console.error('[Redis] Lock acquire error:', (err as Error).message);
    }
  }

  const existing = memCache.get(fullKey);
  if (existing && existing.expiresAt > Date.now()) return false;
  memCache.set(fullKey, { value: lockValue, expiresAt: Date.now() + ttlSeconds * 1000 });
  return true;
}

export async function releaseLock(lockName: string): Promise<void> {
  const fullKey = `${REDIS_KEY_PREFIX}lock:${lockName}`;

  if (redisClient && connected) {
    try {
      await redisClient.del(fullKey);
    } catch {
      // fallthrough
    }
  }

  memCache.delete(fullKey);
}

// ── Session State ──

export async function setSessionState(sessionId: string, state: Record<string, unknown>): Promise<void> {
  await cacheSet(`session:${sessionId}`, JSON.stringify(state), 7200);
}

export async function getSessionState(sessionId: string): Promise<Record<string, unknown> | null> {
  const data = await cacheGet(`session:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

// ── Cleanup ──

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit().catch(() => {});
    redisClient = null;
    connected = false;
    console.log('[Redis] Connection closed');
  }
}

// ── Status ──

export function getRedisStatus(): {
  enabled: boolean;
  connected: boolean;
  memCacheSize: number;
  keyPrefix: string;
} {
  return {
    enabled: !!REDIS_URL,
    connected,
    memCacheSize: memCache.size,
    keyPrefix: REDIS_KEY_PREFIX,
  };
}
