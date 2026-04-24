// Scheduled API endpoint tests — no browser needed
// These test the Digital Worker's scheduled task endpoints directly.

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.WORKER_URL || 'http://localhost:3978';
const SECRET = process.env.SCHEDULED_SECRET || 'test-secret';

const headers = {
  'x-scheduled-secret': SECRET,
  'Content-Type': 'application/json',
};

test.describe('Scheduled API Endpoints', () => {
  test('health check returns healthy', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/health`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('healthy');
  });

  test('GET /api/scheduled lists all endpoints', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/scheduled`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.endpoints).toBeDefined();
    expect(data.endpoints.length).toBeGreaterThanOrEqual(5);
  });

  test('POST /api/scheduled/monitor — portfolio price monitoring', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/scheduled/monitor`, { headers });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.task).toBe('portfolio-monitor');
    expect(data.status).toBe('complete');
    expect(data.holdingsChecked).toBeGreaterThan(0);
    expect(typeof data.alertCount).toBe('number');
  });

  test('POST /api/scheduled/fx — FX rate monitoring', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/scheduled/fx`, { headers });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.task).toBe('fx-monitor');
    expect(data.status).toBe('complete');
    expect(data.pairsChecked).toBe(10);
  });

  test('POST /api/scheduled/compliance — compliance digest', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/scheduled/compliance`, { headers });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.task).toBe('compliance-digest');
    expect(data.status).toBe('complete');
    expect(data.emailSent).toBe(true);
    expect(data.teamsPosted).toBe(true);
  });

  test('POST /api/scheduled/earnings — earnings check', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/scheduled/earnings`, { headers });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.task).toBe('earnings-check');
    expect(data.status).toBe('complete');
    expect(data.holdingsChecked).toBeGreaterThan(0);
  });

  test('POST /api/scheduled/briefing — morning briefing', async ({ request }) => {
    test.setTimeout(120_000);
    const res = await request.post(`${BASE_URL}/api/scheduled/briefing`, { headers });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.task).toMatch(/briefing/);
    expect(data.status).toBe('complete');
    expect(data.emailSent).toBe(true);
    expect(data.teamsPosted).toBe(true);
  });

  test('rejects unauthorized requests', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/scheduled/monitor`, {
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
  });
});
