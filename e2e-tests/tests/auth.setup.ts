// Auth setup: Log into Teams and save session state
// Run this once interactively, then tests reuse the saved session.

import { test as setup } from '@playwright/test';
import path from 'path';

const AUTH_FILE = path.join(__dirname, '..', 'auth', 'teams-session.json');

setup('authenticate with Microsoft Teams', async ({ page }) => {
  // Navigate to Teams
  await page.goto('https://teams.microsoft.com');

  // Wait for login — user will authenticate manually in the browser
  console.log('\n========================================');
  console.log('  MANUAL LOGIN REQUIRED');
  console.log('  Sign in to Teams in the browser window.');
  console.log('  The test will continue once Teams loads.');
  console.log('========================================\n');

  // Wait for Teams to fully load — try multiple selectors that indicate the app is ready
  await page.waitForURL(/.*teams.*/, { timeout: 120_000 });
  
  // Wait for any element that indicates Teams has loaded past the login screen
  await page.waitForFunction(() => {
    // Check for common Teams UI elements
    return document.querySelector('[data-tid]') !== null 
      || document.querySelector('[class*="app-bar"]') !== null
      || document.querySelector('[role="main"]') !== null
      || document.querySelectorAll('button').length > 5;
  }, { timeout: 120_000 });

  // Extra wait to let session tokens stabilize
  await page.waitForTimeout(5000);

  // Save the authenticated state
  await page.context().storageState({ path: AUTH_FILE });
  console.log(`Session saved to ${AUTH_FILE}`);
});
