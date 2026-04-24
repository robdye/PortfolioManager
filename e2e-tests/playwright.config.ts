import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'https://teams.microsoft.com',
    headless: false,
    viewport: { width: 1440, height: 900 },
    screenshot: 'on',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'teams-setup',
      testMatch: /auth\.setup\.ts/,
      use: { storageState: undefined },
    },
    {
      name: 'api-tests',
      testMatch: /scheduled-api\.spec\.ts/,
      use: { storageState: undefined },
    },
    {
      name: 'teams-tests',
      testMatch: /agent\.spec\.ts/,
      dependencies: ['teams-setup'],
      use: { storageState: './auth/teams-session.json' },
    },
  ],
});
