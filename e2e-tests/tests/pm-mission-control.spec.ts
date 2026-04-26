import { test, expect } from '@playwright/test';

test.describe('Portfolio Manager — Mission Control', () => {
  test('Mission Control HTML loads', async ({ page }) => {
    const res = await page.goto('/mission-control.html');
    expect(res?.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
  });

  test('Mission Control has dark theme', async ({ page }) => {
    await page.goto('/mission-control.html');
    const bg = await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor);
    // Dark theme: rgb values should be low
    const match = bg.match(/\d+/g);
    expect(match).toBeTruthy();
    if (match) {
      const [r, g, b] = match.map(Number);
      expect(r + g + b).toBeLessThan(200); // dark background
    }
  });

  test('Mission Control has navigation sidebar', async ({ page }) => {
    await page.goto('/mission-control.html');
    // Look for nav links or sidebar
    const nav = page.locator('nav, .sidebar, .nav, [class*="sidebar"], [class*="nav"]');
    await expect(nav.first()).toBeVisible();
  });

  test('Mission Control has stats row', async ({ page }) => {
    await page.goto('/mission-control.html');
    // Stats cards should be visible
    const stats = page.locator('.stat-card, .stats, [class*="stat"], [class*="kpi"]');
    await expect(stats.first()).toBeVisible();
  });

  test('Mission Control has agent panels', async ({ page }) => {
    await page.goto('/mission-control.html');
    // Should have panels for multi-agent view
    const panels = page.locator('.panel, .card, [class*="panel"], [class*="agent"]');
    const count = await panels.count();
    expect(count).toBeGreaterThan(0);
  });

  test('Mission Control has Activity Feed section', async ({ page }) => {
    await page.goto('/mission-control.html');
    const content = await page.content();
    expect(content.toLowerCase()).toContain('activity');
  });

  test('Mission Control has Agent Mind / Reasoning section', async ({ page }) => {
    await page.goto('/mission-control.html');
    const content = await page.content();
    // Should have reasoning traces or agent mind section
    const hasReasoning = content.toLowerCase().includes('reason') ||
      content.toLowerCase().includes('agent mind') ||
      content.toLowerCase().includes('trace');
    expect(hasReasoning).toBeTruthy();
  });

  test('Mission Control responsive — no horizontal scroll at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/mission-control.html');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5); // 5px tolerance
  });
});
