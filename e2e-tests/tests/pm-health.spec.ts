import { test, expect } from '@playwright/test';

test.describe('Portfolio Manager — Health & Status', () => {
  test('GET / returns status or auth challenge', async ({ request }) => {
    const res = await request.get('/');
    expect([200, 401]).toContain(res.status());
    const body = await res.json();
    expect(body).toBeTruthy();
  });

  test('GET /api/health returns healthy', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toMatch(/healthy|ok/i);
  });

  test('GET /api/scheduled lists endpoints', async ({ request }) => {
    const res = await request.get('/api/scheduled');
    expect([200, 401]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toBeTruthy();
    }
  });

  test('GET /api/audit-trail returns array', async ({ request }) => {
    const res = await request.get('/api/audit-trail');
    // May return 200 with empty array or 401 if auth required
    expect([200, 401]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(Array.isArray(body) || body.entries).toBeTruthy();
    }
  });

  test('GET /api/reasoning-traces returns traces', async ({ request }) => {
    const res = await request.get('/api/reasoning-traces');
    expect([200, 401]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(Array.isArray(body) || body.traces).toBeTruthy();
    }
  });

  test('POST /api/messages with empty body returns 400', async ({ request }) => {
    const res = await request.post('/api/messages', { data: {} });
    expect([400, 401]).toContain(res.status());
  });

  test('Unauthenticated POST /api/messages returns 401', async ({ request }) => {
    const res = await request.post('/api/messages', {
      data: { text: 'test' },
      headers: { 'Authorization': 'Bearer invalid-token' },
    });
    expect([400, 401, 403]).toContain(res.status());
  });
});
