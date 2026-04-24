// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — Compliance Digest
//
// Generates and sends weekly compliance digest summarizing
// deal compliance status, flagged items, and upcoming reviews.
//
// Triggered via API endpoint /api/scheduled/compliance — called by an
// external scheduler (weekly via Azure Logic App, etc.).

import { configDotenv } from 'dotenv';
configDotenv();

import { mcpClient } from './mcp-client';
import { getStandaloneClient } from './client';
import { sendEmail } from './email-service';
import { postToChannel } from './teams-channel';

const MANAGER_EMAIL = process.env.MANAGER_EMAIL || '';
const MANAGER_NAME = process.env.MANAGER_NAME || 'Manager';

/**
 * Gather compliance data from CRM.
 */
async function gatherComplianceData(): Promise<{
  flagged: unknown;
  pending: unknown;
  icCalendar: unknown;
  revenueForecast: unknown;
}> {
  const [flagged, pending, icCalendar, revenueForecast] = await Promise.allSettled([
    mcpClient.getComplianceStatus('Flagged'),
    mcpClient.getComplianceStatus('Pending'),
    mcpClient.getICCalendar(),
    mcpClient.getRevenueForecast(),
  ]);

  return {
    flagged: flagged.status === 'fulfilled' ? flagged.value : { error: 'unavailable' },
    pending: pending.status === 'fulfilled' ? pending.value : { error: 'unavailable' },
    icCalendar: icCalendar.status === 'fulfilled' ? icCalendar.value : { error: 'unavailable' },
    revenueForecast: revenueForecast.status === 'fulfilled' ? revenueForecast.value : { error: 'unavailable' },
  };
}

/**
 * Generate compliance digest email using OpenAI.
 */
async function generateComplianceDigest(data: any): Promise<{ subject: string; body: string }> {
  const client = await getStandaloneClient();

  const prompt = `Generate a professional weekly compliance digest email for ${MANAGER_NAME}.
Use the following data from our systems:

FLAGGED DEALS:
${JSON.stringify(data.flagged, null, 2)}

PENDING REVIEWS:
${JSON.stringify(data.pending, null, 2)}

IC CALENDAR (upcoming Investment Committee dates):
${JSON.stringify(data.icCalendar, null, 2)}

REVENUE FORECAST:
${JSON.stringify(data.revenueForecast, null, 2)}

Format as a structured HTML email with these sections:
1. **Compliance Summary** — Overview RAG status (Red/Amber/Green) count of flagged, pending, compliant
2. **Flagged Items Requiring Action** — Each flagged deal with risk rating and recommended action
3. **Pending Reviews** — Deals due for compliance review this week
4. **IC Preparation** — Deals approaching Investment Committee with readiness checklist
5. **Revenue Impact** — Pipeline-weighted revenue at risk from compliance issues
6. **Recommended Actions** — Priority actions for the week

Use professional tone. The email should be actionable and concise.
Return ONLY the HTML body (no Subject: prefix).`;

  const response = await client.invokeAgentWithScope(prompt);

  return {
    subject: `📋 Weekly Compliance Digest — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    body: response,
  };
}

/**
 * Send the compliance digest.
 */
async function sendComplianceDigest(): Promise<void> {
  try {
    console.log('[Compliance] Generating weekly digest...');

    const data = await gatherComplianceData();
    const { subject, body } = await generateComplianceDigest(data);

    // Email to manager
    if (MANAGER_EMAIL) {
      await sendEmail({ to: MANAGER_EMAIL, subject, body });
      console.log(`[Compliance] Digest emailed to ${MANAGER_EMAIL}`);
    }

    // Also post summary to Teams
    await postToChannel(`<h3>${subject}</h3>${body}`);
    console.log('[Compliance] Digest posted to Teams');
  } catch (error) {
    console.error('[Compliance] Digest generation failed:', error);
  }
}

/**
 * Run the compliance digest — called by API endpoint.
 * Returns a status object for the API response.
 */
export async function runComplianceDigest(): Promise<{ status: string; emailSent: boolean; teamsPosted: boolean }> {
  console.log(`[Compliance] Digest triggered at ${new Date().toISOString()}`);
  let emailSent = false;
  let teamsPosted = false;

  try {
    await sendComplianceDigest();
    emailSent = !!MANAGER_EMAIL;
    teamsPosted = true;
  } catch (error) {
    console.error('[Compliance] Digest failed:', error);
    throw error;
  }

  return { status: 'complete', emailSent, teamsPosted };
}

/**
 * Direct export for manual trigger.
 */
export { sendComplianceDigest };
