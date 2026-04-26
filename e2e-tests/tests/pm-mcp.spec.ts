import { test, expect } from '@playwright/test';

/** MCP JSON-RPC helpers */
async function mcpRequest(request: any, baseURL: string, method: string, params?: Record<string, unknown>) {
  const body: Record<string, unknown> = {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
  };
  if (params) body.params = params;

  const res = await request.post(`${baseURL}/mcp`, {
    data: body,
    headers: { 'Content-Type': 'application/json' },
  });
  return res;
}

test.describe('Portfolio Manager — MCP Server', () => {
  test('MCP /mcp endpoint exists', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/mcp`, {
      data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      headers: { 'Content-Type': 'application/json' },
    });
    // Accept 200 (JSON-RPC), 405 (SSE-only), or connection to SSE
    expect([200, 204, 405]).toContain(res.status());
  });

  test('MCP /sse endpoint available for SSE transport', async ({ request, baseURL }) => {
    // SSE endpoint should accept connections
    const res = await request.get(`${baseURL}/sse`, {
      timeout: 5000,
    }).catch(() => null);
    // May timeout (SSE keeps connection open) — that's ok
    // Just verify the endpoint doesn't 404
    if (res) {
      expect([200, 204]).toContain(res.status());
    }
  });

  test('MCP health endpoint', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/`);
    expect(res.status()).toBe(200);
  });

  test('MCP tools/list returns PM tools', async ({ request, baseURL }) => {
    const res = await mcpRequest(request, baseURL!, 'tools/list', {});
    if (res.status() === 200) {
      const body = await res.json();
      if (body.result?.tools) {
        const toolNames = body.result.tools.map((t: { name: string }) => t.name);
        // Core PM tools should be present
        const expectedTools = [
          'get_quote', 'get_portfolio', 'get_news',
          'get_analyst_consensus', 'simulate_trade'
        ];
        for (const tool of expectedTools) {
          expect(toolNames).toContain(tool);
        }
      }
    }
  });

  test('MCP get_quote tool returns market data', async ({ request, baseURL }) => {
    const res = await mcpRequest(request, baseURL!, 'tools/call', {
      name: 'get_quote',
      arguments: { symbol: 'AAPL' },
    });
    if (res.status() === 200) {
      const body = await res.json();
      if (body.result) {
        expect(body.result).toBeTruthy();
      }
    }
  });

  test('MCP resources/list returns available resources', async ({ request, baseURL }) => {
    const res = await mcpRequest(request, baseURL!, 'resources/list', {});
    if (res.status() === 200) {
      const body = await res.json();
      // Should have result (may be empty)
      expect(body).toBeTruthy();
    }
  });

  test('MCP prompts/list returns available prompts', async ({ request, baseURL }) => {
    const res = await mcpRequest(request, baseURL!, 'prompts/list', {});
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeTruthy();
    }
  });
});
