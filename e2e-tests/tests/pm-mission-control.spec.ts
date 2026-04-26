import { test, expect } from '@playwright/test';

test.describe('Portfolio Manager — Mission Control', () => {
  test('Mission Control endpoint responds', async ({ page }) => {
    const res = await page.goto('/mission-control.html');
    // Behind JWT auth on deployed instance — accept 200 or 401
    expect([200, 401]).toContain(res?.status());
  });

  test('Mission Control dark theme when accessible', async ({ page }) => {
    const res = await page.goto('/mission-control.html');
    if (res?.status() !== 200) {
      test.skip(true, 'Mission Control behind auth — skipping UI tests');
      return;
    }
    const bg = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor);
    const match = bg.match(/\d+/g);
    expect(match).toBeTruthy();
    if (match) {
      const [r, g, b] = match.map(Number);
      expect(r + g + b).toBeLessThan(200);
    }
  });

  test('Mission Control has content sections when accessible', async ({ page }) => {
    const res = await page.goto('/mission-control.html');
    if (res?.status() !== 200) {
      test.skip(true, 'Mission Control behind auth');
      return;
    }
    const content = await page.content();
    // Should have meaningful content (not just a JSON error)
    expect(content.length).toBeGreaterThan(500);
  });

  test('Mission Control responsive when accessible', async ({ page }) => {
    const res = await page.goto('/mission-control.html');
    if (res?.status() !== 200) {
      test.skip(true, 'Mission Control behind auth');
      return;
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });

  test('Voice HTML endpoint responds', async ({ page }) => {
    const res = await page.goto('/voice.html');
    expect([200, 401, 404]).toContain(res?.status());
  });
});
