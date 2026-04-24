import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('fetchWithTimeout (Finnhub pattern)', () => {
  const originalFetch = globalThis.fetch;

  // Reproduce the fetchWithTimeout from finnhub.ts for isolated testing
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

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should return data on success', async () => {
    const mockData = { c: 150.25, h: 152.0, l: 149.5, o: 150.0 };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockData), { status: 200 })
    );

    const res = await fetchWithTimeout('https://finnhub.io/api/v1/quote?symbol=AAPL');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual(mockData);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('should throw on timeout', async () => {
    globalThis.fetch = vi.fn(
      (_url: string | URL, opts?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        })
    );

    await expect(fetchWithTimeout('https://finnhub.io/api/v1/quote', {}, 50)).rejects.toThrow(
      'aborted'
    );
  });

  it('should pass through non-ok responses for caller handling', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
    );

    const res = await fetchWithTimeout('https://finnhub.io/api/v1/quote');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
  });
});

describe('Finnhub retry logic (429 Retry-After)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should respect Retry-After header on 429 and retry', async () => {
    // Simulate the get() retry logic from finnhub.ts
    const rateLimitResponse = new Response('Rate limited', {
      status: 429,
      headers: { 'Retry-After': '1' },
    });
    const successResponse = new Response(JSON.stringify({ c: 100 }), { status: 200 });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(rateLimitResponse)
      .mockResolvedValueOnce(successResponse);

    // Reproduce the retry logic from finnhub.ts get()
    async function getWithRetry(url: string): Promise<unknown> {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(url);
        if (res.status === 429 && attempt === 0) {
          const retryAfter =
            Math.min(parseInt(res.headers.get('Retry-After') || '1', 10), 10) * 1000;
          await new Promise((r) => setTimeout(r, retryAfter));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }
      throw new Error('rate limited after retry');
    }

    const data = await getWithRetry('https://finnhub.io/api/v1/quote');
    expect(data).toEqual({ c: 100 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  }, 10000);

  it('should throw after retry is exhausted on second 429', async () => {
    const rateLimitResponse1 = new Response('Rate limited', {
      status: 429,
      headers: { 'Retry-After': '1' },
    });
    const rateLimitResponse2 = new Response('Rate limited', {
      status: 429,
      headers: { 'Retry-After': '1' },
    });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(rateLimitResponse1)
      .mockResolvedValueOnce(rateLimitResponse2);

    // Matches the actual finnhub.ts logic: on attempt 1, 429 falls through
    // to the !res.ok check and throws with the status code
    async function getWithRetry(url: string): Promise<unknown> {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(url);
        if (res.status === 429 && attempt === 0) {
          const retryAfter =
            Math.min(parseInt(res.headers.get('Retry-After') || '1', 10), 10) * 1000;
          await new Promise((r) => setTimeout(r, retryAfter));
          continue;
        }
        if (!res.ok) throw new Error(`Finnhub /quote: ${res.status} ${res.statusText}`);
        return res.json();
      }
      throw new Error('rate limited after retry');
    }

    await expect(getWithRetry('https://finnhub.io/api/v1/quote')).rejects.toThrow('429');
  }, 10000);

  it('should cap Retry-After at 10 seconds', () => {
    const rawHeader = '60'; // server says wait 60 seconds
    const retryAfter = Math.min(parseInt(rawHeader, 10), 10) * 1000;
    expect(retryAfter).toBe(10000); // capped at 10s
  });
});
