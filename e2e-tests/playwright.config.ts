import { defineConfig } from '@playwright/test';

// Portfolio Manager — live URLs
const PM_BASE = process.env.PM_BASE_URL
  || 'https://portfolio-manager-worker.jollysand-88b78b02.eastus.azurecontainerapps.io';
const PM_MCP = process.env.PM_MCP_URL
  || 'https://portfolio-agent-app.jollysand-88b78b02.eastus.azurecontainerapps.io';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 1,
  workers: 2,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: PM_BASE,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'pm-health',
      testMatch: /pm-health\.spec\.ts/,
      use: { baseURL: PM_BASE },
    },
    {
      name: 'pm-mission-control',
      testMatch: /pm-mission-control\.spec\.ts/,
      use: { baseURL: PM_BASE },
    },
    {
      name: 'pm-mcp',
      testMatch: /pm-mcp\.spec\.ts/,
      use: { baseURL: PM_MCP },
    },
    {
      name: 'pm-multi-agent',
      testMatch: /pm-multi-agent\.spec\.ts/,
      use: { baseURL: PM_BASE },
    },
    {
      name: 'pm-scheduled-api',
      testMatch: /scheduled-api\.spec\.ts/,
      use: { baseURL: PM_BASE },
    },
    {
      name: 'teams-setup',
      testMatch: /auth\.setup\.ts/,
      use: { storageState: undefined },
    },
    {
      name: 'teams-tests',
      testMatch: /agent\.spec\.ts/,
      dependencies: ['teams-setup'],
      use: { storageState: './auth/teams-session.json', baseURL: 'https://teams.microsoft.com' },
    },
  ],
});
