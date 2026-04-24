// Portfolio Manager Agent — E2E Tests via Teams
// Tests the Digital Worker's interactive capabilities through the Teams UI.

import { test, expect } from '@playwright/test';
import { openAgentChat, sendMessageAndWait, cooldown } from './helpers';

test.describe.serial('Portfolio Manager Agent', () => {
  test.beforeAll(async ({ browser }) => {
    // Ensure we have an authenticated session
    const context = await browser.newContext({ storageState: './auth/teams-session.json' });
    const page = await context.newPage();
    await page.goto('https://teams.microsoft.com');
    await page.waitForTimeout(5000);
    await page.close();
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('https://teams.microsoft.com');
    await page.waitForTimeout(3000);
    await openAgentChat(page);
  });

  // ── Portfolio Data Tests ──

  test('can read portfolio holdings', async ({ page }) => {
    const response = await sendMessageAndWait(
      page,
      'What holdings are in my portfolio?',
      'holding'
    );
    // Should mention real tickers
    expect(response).toMatch(/AZN|NVDA|MSFT|BP|GSK/);
  });

  test('can get stock quote', async ({ page }) => {
    await cooldown(page);
    const response = await sendMessageAndWait(
      page,
      'Get me a stock quote for NVDA',
      'nvda'
    );
    // Should contain price data
    expect(response).toMatch(/\$[\d,.]+|price|change/i);
  });

  test('can get company news', async ({ page }) => {
    await cooldown(page);
    const response = await sendMessageAndWait(
      page,
      'Show me the latest news for Microsoft',
      'microsoft'
    );
    expect(response.length).toBeGreaterThan(50);
  });

  // ── CRM Tests ──

  test('can query CRM pipeline', async ({ page }) => {
    await cooldown(page);
    const response = await sendMessageAndWait(
      page,
      'Show me the CRM pipeline',
      'pipeline'
    );
    expect(response).toMatch(/deal|opportunity|stage|revenue/i);
  });

  test('can get CRM contacts', async ({ page }) => {
    await cooldown(page);
    const response = await sendMessageAndWait(
      page,
      'Who are my contacts at AstraZeneca?',
      'astrazeneca'
    );
    expect(response).toMatch(/contact|name|email|title/i);
  });

  // ── Deal & Compliance Tests ──

  test('can check compliance status', async ({ page }) => {
    await cooldown(page);
    const response = await sendMessageAndWait(
      page,
      'Are there any deals flagged for compliance review?',
      'compliance'
    );
    expect(response).toMatch(/flag|pending|approved|compliance/i);
  });

  test('can get revenue forecast', async ({ page }) => {
    await cooldown(page);
    const response = await sendMessageAndWait(
      page,
      'What is the pipeline-weighted revenue forecast?',
      'revenue'
    );
    expect(response).toMatch(/\$[\d,.]+|weighted|forecast/i);
  });

  // ── M365 MCP Communication Tests ──

  test('can send Teams message via M365 MCP', async ({ page }) => {
    await cooldown(page, 5000);
    const response = await sendMessageAndWait(
      page,
      'Send Cecil Folk a Teams message saying: Quick test from the Portfolio Manager agent'
    );
    // Should confirm message was sent OR attempt to send
    expect(response).toMatch(/sent|delivered|cecil|message/i);
  });

  test('can send email via M365 MCP', async ({ page }) => {
    await cooldown(page, 5000);
    const response = await sendMessageAndWait(
      page,
      'Email the manager with subject "Portfolio Test" and body "This is an automated test from the Portfolio Manager agent."'
    );
    expect(response).toMatch(/sent|email|delivered/i);
  });

  // ── Analysis Tests ──

  test('can get FX rates', async ({ page }) => {
    await cooldown(page);
    const response = await sendMessageAndWait(
      page,
      'Show me FX rates for GBP/USD',
      'gbp'
    );
    expect(response).toMatch(/[\d.]+|rate|exchange/i);
  });

  test('can simulate a trade', async ({ page }) => {
    await cooldown(page);
    const response = await sendMessageAndWait(
      page,
      'What if I sell 500 shares of MSFT and buy 1000 shares of TSLA?',
      'simulation'
    );
    expect(response.length).toBeGreaterThan(50);
  });
});
