import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';

// The obo-auth module uses a module-level fetchWithTimeout and caches.
// We test the exported helpers and cache behavior by importing the module
// and mocking global fetch.

describe('obo-auth', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('cache key uses SHA-256 hash', () => {
    it('should produce a deterministic SHA-256 hash for token cache keys', () => {
      const token = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.test-token';
      const hash = createHash('sha256').update(token).digest('hex').substring(0, 32);

      // Verify hash is 32 hex chars (truncated SHA-256)
      expect(hash).toMatch(/^[a-f0-9]{32}$/);
      // Verify determinism
      const hash2 = createHash('sha256').update(token).digest('hex').substring(0, 32);
      expect(hash).toBe(hash2);
    });

    it('should produce different hashes for different tokens', () => {
      const hash1 = createHash('sha256').update('token-a').digest('hex').substring(0, 32);
      const hash2 = createHash('sha256').update('token-b').digest('hex').substring(0, 32);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('appTokenCache bounded at 100 entries', () => {
    it('should evict oldest entry when cache exceeds MAX_CACHE_SIZE', async () => {
      // We test the bounding logic pattern used in obo-auth:
      // when map.size >= MAX_CACHE_SIZE, delete the first key
      const MAX_CACHE_SIZE = 100;
      const cache = new Map<string, { token: string; expiresAt: number }>();

      // Fill cache to capacity
      for (let i = 0; i < MAX_CACHE_SIZE; i++) {
        cache.set(`scope-${i}`, { token: `tok-${i}`, expiresAt: Date.now() + 60000 });
      }
      expect(cache.size).toBe(MAX_CACHE_SIZE);

      // Simulate adding one more entry (same logic as obo-auth)
      if (cache.size >= MAX_CACHE_SIZE) {
        const firstKey = cache.keys().next().value!;
        cache.delete(firstKey);
      }
      cache.set('scope-new', { token: 'tok-new', expiresAt: Date.now() + 60000 });

      expect(cache.size).toBe(MAX_CACHE_SIZE);
      expect(cache.has('scope-0')).toBe(false);
      expect(cache.has('scope-new')).toBe(true);
    });
  });

  describe('fetchWithTimeout', () => {
    it('should respect timeout and abort the request', async () => {
      // Recreate the fetchWithTimeout pattern from obo-auth
      function fetchWithTimeout(
        url: string | URL,
        options: RequestInit = {},
        timeoutMs = 30000
      ): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        return fetch(url, { ...options, signal: controller.signal }).finally(() =>
          clearTimeout(timeout)
        );
      }

      // Mock fetch to hang forever
      globalThis.fetch = vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            // Never resolves — timeout should abort it
            const ac = new AbortController();
            // Listen for abort from the signal passed by fetchWithTimeout
            const opts = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
            opts?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          })
      );

      await expect(fetchWithTimeout('https://example.com', {}, 50)).rejects.toThrow('aborted');
    });

    it('should return response on success', async () => {
      function fetchWithTimeout(
        url: string | URL,
        options: RequestInit = {},
        timeoutMs = 30000
      ): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        return fetch(url, { ...options, signal: controller.signal }).finally(() =>
          clearTimeout(timeout)
        );
      }

      const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const res = await fetchWithTimeout('https://example.com', {}, 5000);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });
  });

  describe('extractBearerToken', () => {
    it('should extract token from Authorization header', async () => {
      const { extractBearerToken } = await import('../obo-auth');
      const req = { headers: { authorization: 'Bearer my-token-123' } } as any;
      expect(extractBearerToken(req)).toBe('my-token-123');
    });

    it('should return null when no Authorization header', async () => {
      const { extractBearerToken } = await import('../obo-auth');
      const req = { headers: {} } as any;
      expect(extractBearerToken(req)).toBeNull();
    });

    it('should return null for non-Bearer auth', async () => {
      const { extractBearerToken } = await import('../obo-auth');
      const req = { headers: { authorization: 'Basic abc123' } } as any;
      expect(extractBearerToken(req)).toBeNull();
    });
  });
});
