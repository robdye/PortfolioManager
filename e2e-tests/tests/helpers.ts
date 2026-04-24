// Helpers for interacting with the Portfolio Manager Agent in Teams

import { Page, expect } from '@playwright/test';

const AGENT_NAME = 'Portfolio Manager Agent';
const RESPONSE_TIMEOUT = 90_000; // Agent can take up to 90s for complex queries

/**
 * Navigate to the Portfolio Manager Agent chat in Teams.
 */
export async function openAgentChat(page: Page) {
  // Click on Chat in the left rail
  await page.click('[data-tid="chat-tab"]');
  await page.waitForTimeout(1500);

  // Search for the agent
  const searchBox = page.locator('[data-tid="search-input"], [placeholder*="Search"]').first();
  await searchBox.click();
  await searchBox.fill(AGENT_NAME);
  await page.waitForTimeout(2000);

  // Click on the agent in search results
  const agentResult = page.locator(`text="${AGENT_NAME}"`).first();
  await agentResult.click();
  await page.waitForTimeout(2000);
}

/**
 * Send a message to the agent and wait for a response.
 * Returns the agent's response text.
 */
export async function sendMessageAndWait(
  page: Page,
  message: string,
  partialExpected?: string
): Promise<string> {
  // Find the compose box
  const composeBox = page.locator(
    '[data-tid="ckeditor-replyConversation"], [role="textbox"][aria-label*="message"], [data-tid="newMessageCommands-input"]'
  ).first();

  await composeBox.click();
  await composeBox.fill(message);
  await page.waitForTimeout(500);

  // Press Enter to send
  await page.keyboard.press('Enter');

  // Wait for "Got it — working on it..." then the actual response
  console.log(`  → Sent: "${message}"`);

  // Count existing agent messages before we sent
  const agentMessages = page.locator('[data-tid="chat-pane-message"]');
  const initialCount = await agentMessages.count();

  // Wait for a new message to appear (beyond "Got it — working on it...")
  // We look for at least 2 new messages: the "working on it" + the actual response
  await page.waitForFunction(
    (args) => {
      const messages = document.querySelectorAll('[data-tid="chat-pane-message"]');
      if (messages.length <= args.initialCount + 1) return false;
      const lastMsg = messages[messages.length - 1]?.textContent || '';
      // Response is ready when it's not just "working on it"
      return !lastMsg.includes('working on it') && lastMsg.length > 20;
    },
    { initialCount },
    { timeout: RESPONSE_TIMEOUT }
  );

  // Get the last message text
  const lastMessage = agentMessages.last();
  const responseText = await lastMessage.textContent() || '';
  console.log(`  ← Response: "${responseText.substring(0, 120)}..."`);

  // Optionally check for expected content
  if (partialExpected) {
    expect(responseText.toLowerCase()).toContain(partialExpected.toLowerCase());
  }

  return responseText;
}

/**
 * Wait a bit between tests to avoid rate limiting.
 */
export async function cooldown(page: Page, ms = 3000) {
  await page.waitForTimeout(ms);
}
