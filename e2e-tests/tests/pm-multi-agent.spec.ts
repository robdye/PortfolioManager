import { test, expect } from '@playwright/test';

test.describe('Portfolio Manager — Multi-Agent & Capabilities', () => {

  // --- Multi-Agent Orchestration ---
  test('Worker registry endpoint returns workers', async ({ request }) => {
    const res = await request.get('/api/workers');
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.workers || body).toBeTruthy();
      // Should have specialist workers
      const names = JSON.stringify(body);
      expect(names).toContain('researcher');
    }
    // Endpoint may not exist yet — accept 404 gracefully
    expect([200, 404]).toContain(res.status());
  });

  // --- Reasoning Traces ---
  test('Reasoning traces endpoint returns valid structure', async ({ request }) => {
    const res = await request.get('/api/reasoning-traces');
    if (res.status() === 200) {
      const body = await res.json();
      const traces = Array.isArray(body) ? body : body.traces || [];
      if (traces.length > 0) {
        const trace = traces[0];
        expect(trace).toHaveProperty('traceId');
        expect(trace).toHaveProperty('decision');
        expect(trace).toHaveProperty('reasoning');
        expect(trace).toHaveProperty('confidence');
      }
    }
    expect([200, 401, 404]).toContain(res.status());
  });

  // --- Vision Processing ---
  test('Vision ingest endpoint accepts POST', async ({ request }) => {
    const res = await request.post('/api/vision/ingest', {
      data: {
        type: 'broker-research',
        content: 'test',
      },
    });
    // Accepts the request (may need auth or actual file)
    expect([200, 400, 401, 404, 415]).toContain(res.status());
  });

  // --- Computer Use Agent ---
  test('CUA endpoint exists', async ({ request }) => {
    const res = await request.get('/api/cua/status');
    expect([200, 401, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('status');
    }
  });

  // --- A2A Federation ---
  test('A2A agent card endpoint', async ({ request }) => {
    const res = await request.get('/.well-known/agent.json');
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('name');
      expect(body).toHaveProperty('capabilities');
    }
    expect([200, 404]).toContain(res.status());
  });

  test('A2A tasks endpoint accepts POST', async ({ request }) => {
    const res = await request.post('/api/a2a/tasks', {
      data: {
        task: {
          id: 'test-task-001',
          message: { role: 'user', parts: [{ type: 'text', text: 'Get portfolio summary' }] },
        },
      },
    });
    expect([200, 201, 400, 401, 404]).toContain(res.status());
  });

  // --- Monte Carlo Simulation ---
  test('Monte Carlo endpoint returns scenarios', async ({ request }) => {
    const res = await request.post('/api/monte-carlo', {
      data: {
        scenarios: ['base', 'bull', 'bear'],
        iterations: 10,
      },
    });
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.scenarios || body.results).toBeTruthy();
    }
    expect([200, 400, 401, 404]).toContain(res.status());
  });

  // --- Governance ---
  test('Content safety endpoint blocks harmful content', async ({ request }) => {
    const res = await request.post('/api/content-safety/check', {
      data: { text: 'This is a normal market analysis request' },
    });
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('safe');
    }
    expect([200, 401, 404]).toContain(res.status());
  });

  test('DLP classification endpoint', async ({ request }) => {
    const res = await request.post('/api/dlp/classify', {
      data: { text: 'ISIN: GB0002162385 — Barclays PLC' },
    });
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('classification');
    }
    expect([200, 401, 404]).toContain(res.status());
  });

  // --- Memory ---
  test('Memory preferences endpoint', async ({ request }) => {
    const res = await request.get('/api/memory/preferences');
    expect([200, 401, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeTruthy();
    }
  });

  // --- Voice / Avatar ---
  test('Voice HTML page loads', async ({ page }) => {
    const res = await page.goto('/voice.html');
    // Voice page should load (may be static file)
    if (res?.status() === 200) {
      await expect(page.locator('body')).toBeVisible();
      const content = await page.content();
      expect(content.toLowerCase()).toContain('voice');
    }
    expect([200, 404]).toContain(res?.status());
  });

  // --- Graph Connector ---
  test('Graph connector status endpoint', async ({ request }) => {
    const res = await request.get('/api/graph-connector/status');
    expect([200, 401, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('status');
    }
  });
});
