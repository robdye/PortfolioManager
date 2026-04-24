// Portfolio Manager Digital Worker — Autonomous Actions
//
// The difference between a report generator and a digital worker:
// this module DOES things, not just SAYS things.
//
// Actions available:
//   - Create calendar events (pre-earnings review, portfolio review meetings)
//   - Update CRM (log interactions, move deal stages, create activities)
//   - Update portfolio notes (investment thesis, watchlist annotations)
//   - Send targeted follow-ups (different from bulk emails)
//
// Uses Graph API for calendar and MCP CRM tools for CRM operations.

import { sendEmail } from './email-service';
import { mcpClient } from './mcp-client';
import { postToChannel } from './teams-channel';
import { DigitalWorkerError } from './types';

const GRAPH_APP_ID = process.env.GRAPH_APP_ID || '';
const GRAPH_APP_SECRET = process.env.GRAPH_APP_SECRET || '';
const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID || process.env.connections__service_connection__settings__tenantId || '';
const AGENT_EMAIL = process.env.AGENT_EMAIL || process.env.MANAGER_EMAIL || '';
const MANAGER_EMAIL = process.env.MANAGER_EMAIL || '';
const MANAGER_NAME = process.env.MANAGER_NAME || 'Manager';

// ── Graph Token ─────────────────────────────────────────────────────

let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  const now = Date.now();
  if (_tokenCache && now < _tokenCache.expiresAt - 60000) return _tokenCache.token;
  const body = `client_id=${GRAPH_APP_ID}&client_secret=${encodeURIComponent(GRAPH_APP_SECRET)}&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default&grant_type=client_credentials`;
  const res = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new DigitalWorkerError('ACTION_FAILED', `Graph token failed: ${res.status}`, { action: 'getGraphToken' });
  const data = await res.json() as any;
  _tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in * 1000) };
  return data.access_token;
}

// ── Calendar Actions ────────────────────────────────────────────────

export interface CalendarEventParams {
  subject: string;
  body: string;
  startTime: Date;
  endTime: Date;
  isReminder?: boolean;
  attendees?: string[];  // email addresses
  categories?: string[]; // color categories
}

/**
 * Create a calendar event on the agent's (or manager's) calendar.
 * Uses Graph API with application permissions (Calendars.ReadWrite).
 */
export async function createCalendarEvent(params: CalendarEventParams): Promise<{ id: string; webLink: string } | null> {
  try {
    const token = await getGraphToken();
    // Use MANAGER_EMAIL for calendar — the agent user may not have a licensed mailbox
    const userEmail = MANAGER_EMAIL || AGENT_EMAIL;
    if (!userEmail) {
      console.warn('[Actions] No email configured for calendar events');
      return null;
    }

    const event = {
      subject: params.subject,
      body: { contentType: 'HTML', content: params.body },
      start: { dateTime: params.startTime.toISOString(), timeZone: 'UTC' },
      end: { dateTime: params.endTime.toISOString(), timeZone: 'UTC' },
      isReminderOn: params.isReminder !== false,
      reminderMinutesBeforeStart: 30,
      categories: params.categories || ['Portfolio Manager'],
      ...(params.attendees?.length ? {
        attendees: params.attendees.map(email => ({
          emailAddress: { address: email },
          type: 'required',
        })),
      } : {}),
    };

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      },
    );

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error(`[Actions] Calendar event creation failed for ${userEmail}: ${res.status} — ${err.substring(0, 300)}`);
      return null;
    }

    const created = await res.json() as any;
    console.log(`[Actions] Created calendar event: "${params.subject}" → ${created.id}`);
    return { id: created.id, webLink: created.webLink || '' };
  } catch (err) {
    console.error('[Actions] Calendar event error:', (err as Error).message);
    return null;
  }
}

/**
 * Delete calendar events matching a subject prefix.
 * Returns the number of events deleted.
 */
export async function deleteCalendarEventsBySubject(subjectPrefix: string): Promise<number> {
  try {
    const token = await getGraphToken();
    const userEmail = MANAGER_EMAIL || AGENT_EMAIL;
    if (!userEmail) return 0;

    // Fetch upcoming events matching the prefix
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/events?$filter=startsWith(subject,'${subjectPrefix.replace(/'/g, "''")}')&$select=id,subject&$top=50`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      console.error(`[Actions] Failed to list calendar events: ${res.status}`);
      return 0;
    }
    const data = await res.json() as any;
    const events = data.value || [];

    let deleted = 0;
    for (const evt of events) {
      const delRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/events/${evt.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      if (delRes.ok || delRes.status === 204) {
        deleted++;
        console.log(`[Actions] Deleted calendar event: "${evt.subject}"`);
      } else {
        console.error(`[Actions] Failed to delete event "${evt.subject}": ${delRes.status}`);
      }
    }
    return deleted;
  } catch (err) {
    console.error('[Actions] Calendar delete error:', (err as Error).message);
    return 0;
  }
}

/**
 * Create a pre-earnings review event.
 */
export async function scheduleEarningsReview(symbol: string, company: string, earningsDate: Date): Promise<{ id: string; webLink: string } | null> {
  // Schedule review for 1 day before earnings, 30-min slot at 10:00 AM
  const reviewDate = new Date(earningsDate);
  reviewDate.setDate(reviewDate.getDate() - 1);
  reviewDate.setHours(10, 0, 0, 0);
  const endDate = new Date(reviewDate);
  endDate.setMinutes(30);

  return createCalendarEvent({
    subject: `📊 Pre-Earnings Review: ${symbol} (${company})`,
    body: `<h3>Pre-Earnings Position Review</h3>
<p><strong>${company} (${symbol})</strong> reports earnings on <strong>${earningsDate.toLocaleDateString()}</strong>.</p>
<p>Review items:</p>
<ul>
  <li>Current position size and cost basis</li>
  <li>Analyst consensus estimates (EPS + Revenue)</li>
  <li>Recent SEC filings and insider activity</li>
  <li>Options market implied move</li>
  <li>Decision: hold/trim/add ahead of print</li>
</ul>
<p><em>Created by Portfolio Manager Digital Worker</em></p>`,
    startTime: reviewDate,
    endTime: endDate,
    attendees: [MANAGER_EMAIL, AGENT_EMAIL].filter(e => !!e),
    categories: ['Earnings', 'Portfolio Manager'],
  });
}

/**
 * Schedule a portfolio review after a significant event.
 */
export async function schedulePortfolioReview(reason: string, urgency: 'today' | 'tomorrow' | 'this_week'): Promise<{ id: string; webLink: string } | null> {
  const start = new Date();
  if (urgency === 'today') {
    start.setHours(Math.max(start.getHours() + 1, 14), 0, 0, 0); // At least 1h from now, or 2pm
  } else if (urgency === 'tomorrow') {
    start.setDate(start.getDate() + 1);
    start.setHours(10, 0, 0, 0);
  } else {
    // Next available weekday
    start.setDate(start.getDate() + (start.getDay() >= 5 ? 8 - start.getDay() : 1));
    start.setHours(10, 0, 0, 0);
  }
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + 30);

  return createCalendarEvent({
    subject: `🔍 Portfolio Review: ${reason}`,
    body: `<h3>Portfolio Review Requested</h3><p><strong>Reason:</strong> ${reason}</p><p><strong>Urgency:</strong> ${urgency}</p><p><em>Scheduled by Portfolio Manager Digital Worker based on market signals.</em></p>`,
    startTime: start,
    endTime: end,
    attendees: MANAGER_EMAIL ? [MANAGER_EMAIL] : [],
    categories: ['Portfolio Review', 'Portfolio Manager'],
  });
}

// ── CRM Write-Back Actions ──────────────────────────────────────────

/**
 * Log an interaction/activity in the CRM for a company.
 */
export async function logCrmActivity(params: {
  ticker: string;
  activityType: 'note' | 'call' | 'meeting' | 'email' | 'recommendation';
  subject: string;
  description: string;
}): Promise<boolean> {
  try {
    await mcpClient.callTool(mcpClient.crmEndpoint, 'log-crm-activity', {
      ticker: params.ticker,
      activityType: params.activityType,
      subject: params.subject,
      description: params.description,
    });
    console.log(`[Actions] Logged CRM activity for ${params.ticker}: ${params.subject}`);
    return true;
  } catch (err) {
    console.warn(`[Actions] CRM activity log failed for ${params.ticker}:`, (err as Error).message);
    return false;
  }
}

/**
 * Update a deal stage in the CRM pipeline.
 */
export async function updateDealStage(params: {
  ticker: string;
  dealName: string;
  newStage: string;
  notes?: string;
}): Promise<boolean> {
  try {
    await mcpClient.callTool(mcpClient.crmEndpoint, 'update-deal-stage', {
      ticker: params.ticker,
      dealName: params.dealName,
      stage: params.newStage,
      notes: params.notes || '',
    });
    console.log(`[Actions] Updated deal stage for ${params.ticker}: ${params.dealName} → ${params.newStage}`);
    return true;
  } catch (err) {
    console.warn(`[Actions] Deal stage update failed:`, (err as Error).message);
    return false;
  }
}

// ── Portfolio Write Actions ─────────────────────────────────────────

/**
 * Update investment thesis note on a portfolio holding.
 */
export async function updateInvestmentThesis(ticker: string, thesis: string): Promise<boolean> {
  try {
    await mcpClient.updatePortfolioHolding(ticker, { notes: thesis });
    console.log(`[Actions] Updated investment thesis for ${ticker}`);
    return true;
  } catch (err) {
    console.warn(`[Actions] Thesis update failed for ${ticker}:`, (err as Error).message);
    return false;
  }
}

/**
 * Add a holding to the watchlist/prospects.
 */
export async function addToWatchlist(ticker: string, company: string, reason: string): Promise<boolean> {
  try {
    await mcpClient.addPortfolioHolding({
      ticker,
      company,
      shares: '0',
      holdingType: 'Prospect',
    });
    console.log(`[Actions] Added ${ticker} to watchlist: ${reason}`);
    return true;
  } catch (err) {
    console.warn(`[Actions] Watchlist add failed for ${ticker}:`, (err as Error).message);
    return false;
  }
}

// ── Follow-Up Actions ───────────────────────────────────────────────

/**
 * Send a targeted follow-up email about a specific recommendation.
 */
export async function sendFollowUp(params: {
  actionId: string;
  symbol: string;
  originalRecommendation: string;
  escalationLevel: number;
  currentPrice?: number;
  priceAtRecommendation?: number;
}): Promise<boolean> {
  if (!MANAGER_EMAIL) return false;

  const priceChange = params.currentPrice && params.priceAtRecommendation
    ? ((params.currentPrice - params.priceAtRecommendation) / params.priceAtRecommendation * 100).toFixed(1)
    : null;

  const urgencyEmoji = params.escalationLevel >= 3 ? '🚨' : params.escalationLevel >= 2 ? '⚠️' : '🔄';
  const subject = `${urgencyEmoji} Follow-up #${params.escalationLevel}: ${params.symbol} — ${params.originalRecommendation}`;

  const html = `
    <div style="font-family:Segoe UI,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:${params.escalationLevel >= 3 ? '#dc2626' : '#d97706'};color:white;padding:14px 18px;border-radius:8px 8px 0 0">
        <h3 style="margin:0">${urgencyEmoji} Follow-Up: ${params.symbol}</h3>
        <p style="margin:4px 0 0;opacity:.85;font-size:12px">Escalation #${params.escalationLevel} — Action ID: ${params.actionId}</p>
      </div>
      <div style="background:#fff;padding:18px;border:1px solid #e0e0e0;border-top:none">
        <p style="margin:0 0 12px"><strong>Original Recommendation:</strong> ${params.originalRecommendation}</p>
        ${priceChange ? `<p style="margin:0 0 12px"><strong>Since recommendation:</strong> ${params.symbol} has moved <strong>${Number(priceChange) > 0 ? '+' : ''}${priceChange}%</strong> ($${params.priceAtRecommendation?.toFixed(2)} → $${params.currentPrice?.toFixed(2)})</p>` : ''}
        <p style="margin:0;color:#666;font-size:13px">This recommendation is still pending your action. You can:</p>
        <ul style="font-size:13px;color:#333">
          <li><strong>Act</strong> — Take the recommended action</li>
          <li><strong>Dismiss</strong> — Mark as not needed with a reason</li>
          <li><strong>Defer</strong> — Postpone for 24 hours</li>
        </ul>
      </div>
      <div style="background:#f5f5f5;padding:8px 18px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;border-top:none">
        <p style="margin:0;font-size:10px;color:#999">Portfolio Manager Digital Worker — Action Tracker</p>
      </div>
    </div>`;

  try {
    await sendEmail({ to: MANAGER_EMAIL, subject, body: html, isHtml: true });
    await postToChannel(html);
    console.log(`[Actions] Sent follow-up #${params.escalationLevel} for ${params.symbol}`);
    return true;
  } catch (err) {
    console.warn(`[Actions] Follow-up send failed:`, (err as Error).message);
    return false;
  }
}

// ── Composite Actions ───────────────────────────────────────────────

/**
 * Full "something happened, do something about it" action sequence.
 * This is what makes us a digital worker, not a chatbot.
 */
export async function executeSignalResponse(params: {
  symbol: string;
  company: string;
  signalType: string;
  severity: string;
  recommendation: string;
  analysis: string;
}): Promise<{
  calendarCreated: boolean;
  crmLogged: boolean;
  followUpScheduled: boolean;
}> {
  const results = { calendarCreated: false, crmLogged: false, followUpScheduled: false };

  // 1. For high/critical signals, schedule a review meeting
  if (params.severity === 'critical' || params.severity === 'high') {
    const event = await schedulePortfolioReview(
      `${params.symbol}: ${params.recommendation}`,
      params.severity === 'critical' ? 'today' : 'tomorrow',
    );
    results.calendarCreated = !!event;
  }

  // 2. Log the signal and recommendation in CRM
  results.crmLogged = await logCrmActivity({
    ticker: params.symbol,
    activityType: 'recommendation',
    subject: `${params.signalType}: ${params.recommendation}`,
    description: params.analysis.substring(0, 1000),
  });

  return results;
}
