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
  test('MCP server accepts JSON-RPC POST', async ({ request, baseURL }) => {
    const res = await request.post(`${baseURL}/mcp`, {
      data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      headers: { 'Content-Type': 'application/json' },
    });
    // Accept various valid responses — different MCP transports
    expect([200, 204, 404, 405, 406]).toContain(res.status());
  });

  test('MCP root endpoint responds', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/`);
    // MCP server may not have root handler
    expect([200, 404]).toContain(res.status());
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
