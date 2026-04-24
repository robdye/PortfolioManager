// Portfolio Manager Digital Worker — Client Engagement Scheduler
//
// Automatically books meetings with clients aligned to CRM opportunities,
// then triggers client_meeting_prep workflows so the digital worker
// generates a meeting prep deck and talking points before each meeting.
//
// Flow:
//   1. Pull all active CRM opportunities in Develop/Propose stage
//   2. Cross-reference recent activities — flag accounts with no meeting in 14+ days
//   3. Look up CRM contacts for those accounts
//   4. Book meetings on the PM's calendar via Graph API
//   5. Create client_meeting_prep workflows → workday cycle generates the deck
//
// Recommended schedule: Weekly (e.g. Monday 10:00)

import { mcpClient } from './mcp-client';
import { createCalendarEvent, logCrmActivity } from './autonomous-actions';
import { startWorkflow } from './workflow-engine';
import { sendEmail } from './email-service';
import { postToChannel } from './teams-channel';

const MANAGER_EMAIL = process.env.MANAGER_EMAIL || '';
const MANAGER_NAME = process.env.MANAGER_NAME || 'Robert';
const AGENT_EMAIL = process.env.AGENT_EMAIL || '';

// ── Types ───────────────────────────────────────────────────────────

interface Opportunity {
  id: string;
  name: string;
  value: number;
  stage: string;
  closeDate: string;
  accountTicker: string;
  accountName: string;
}

interface Contact {
  name: string;
  title: string;
  email: string;
}

interface EngagementResult {
  status: 'complete';
  opportunitiesScanned: number;
  accountsNeedingEngagement: number;
  meetingsBooked: MeetingBooked[];
  workflowsCreated: string[];
  skippedReasons: string[];
}

interface MeetingBooked {
  ticker: string;
  company: string;
  contact: string;
  meetingTime: string;
  opportunityValue: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Parse MCP tool response (may be string or object with embedded JSON) */
function parseMcpResponse(raw: unknown): any {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && raw !== null) {
    // Handle MCP content array response
    const obj = raw as any;
    if (obj.content && Array.isArray(obj.content)) {
      for (const c of obj.content) {
        if (c.type === 'text' && typeof c.text === 'string') {
          try { return JSON.parse(c.text); } catch { /* continue */ }
          // Try extracting embedded JSON from mixed text+JSON responses
          const extracted = extractEmbeddedJson(c.text);
          if (extracted !== null) return extracted;
        }
      }
    }
    if (obj.structuredContent) return obj.structuredContent;
    // If it already has pipeline/account shape, return as-is
    if (obj.pipeline || obj.account || obj.contacts) return obj;
    return obj;
  }
  if (typeof raw === 'string') {
    // Try direct parse first
    try { return JSON.parse(raw); } catch { /* try to extract embedded JSON */ }
    const extracted = extractEmbeddedJson(raw);
    if (extracted !== null) return extracted;
    return raw;
  }
  return raw;
}

/** Extract embedded JSON (object or array) from mixed text+JSON responses */
function extractEmbeddedJson(text: string): any {
  // Try JSON array first — CRM contact/pipeline responses embed arrays
  const arrStart = text.lastIndexOf('\n[');
  if (arrStart >= 0) {
    try { return JSON.parse(text.substring(arrStart + 1)); } catch { /* continue */ }
  }
  // Fallback: find first [ at start of line
  const arrMatch = text.indexOf('[');
  if (arrMatch >= 0) {
    try { return JSON.parse(text.substring(arrMatch)); } catch { /* continue */ }
  }
  // Try JSON object — pipeline responses embed objects
  const objMatch = text.match(/\{[\s\S]*"pipeline"[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch { /* continue */ }
  }
  const jsonStart = text.indexOf('{');
  if (jsonStart >= 0) {
    try { return JSON.parse(text.substring(jsonStart)); } catch { /* continue */ }
  }
  return null;
}

/** Find the next available meeting slot (skipping weekends) */
function findMeetingSlot(baseDate: Date, slotIndex: number): { start: Date; end: Date } {
  const slot = new Date(baseDate);
  // Distribute across 3 days: Tue/Wed/Thu (or next week)
  const daysToAdd = 2 + slotIndex; // Start from 2 days out
  slot.setDate(slot.getDate() + daysToAdd);

  // Skip weekends
  while (slot.getDay() === 0 || slot.getDay() === 6) {
    slot.setDate(slot.getDate() + 1);
  }

  // Stagger times: 10:00, 11:00, 14:00, 15:00
  const hours = [10, 11, 14, 15];
  slot.setHours(hours[slotIndex % hours.length], 0, 0, 0);

  const end = new Date(slot);
  end.setMinutes(45); // 45-minute meetings

  return { start: slot, end };
}

/** Check if an opportunity's close date is within N days */
function daysUntilClose(closeDate: string): number {
  if (!closeDate) return 999;
  const close = new Date(closeDate);
  return Math.ceil((close.getTime() - Date.now()) / 86400000);
}

// ── Main Scheduler ──────────────────────────────────────────────────

export async function runClientEngagement(): Promise<EngagementResult> {
  const result: EngagementResult = {
    status: 'complete',
    opportunitiesScanned: 0,
    accountsNeedingEngagement: 0,
    meetingsBooked: [],
    workflowsCreated: [],
    skippedReasons: [],
  };

  // 1. Pull CRM pipeline — focus on active opportunities
  let opportunities: Opportunity[] = [];
  try {
    const raw = await mcpClient.getCrmPipeline();
    const parsed = parseMcpResponse(raw);

    // Pipeline response may be { pipeline: [...] } or direct array
    const arr = parsed?.pipeline || (Array.isArray(parsed) ? parsed : []);
    opportunities = arr.map((o: any) => ({
      id: o.id || o.opportunityid || '',
      name: o.name || '',
      value: o.value || o.estimatedvalue || 0,
      stage: o.stage || o.stepname || '',
      closeDate: o.closeDate || o.estimatedclosedate || '',
      accountTicker: o.accountTicker || o.customerid_account?.tickersymbol || '',
      accountName: o.accountName || o.customerid_account?.name || '',
    }));
    result.opportunitiesScanned = opportunities.length;
  } catch (err) {
    console.error('[Engagement] Failed to fetch pipeline:', (err as Error).message);
    result.skippedReasons.push('Pipeline fetch failed');
    return result;
  }

  // 2. Filter to actionable stages (Develop, Propose, Close)
  const activeOpps = opportunities.filter(o => {
    const stage = (o.stage || '').toLowerCase();
    return stage.includes('develop') || stage.includes('propose') || stage.includes('close')
      || stage.includes('2-') || stage.includes('3-') || stage.includes('4-');
  });

  if (activeOpps.length === 0) {
    result.skippedReasons.push('No opportunities in active stages');
    return result;
  }

  // 3. Deduplicate by account ticker (take highest-value opportunity per account)
  const byAccount = new Map<string, Opportunity>();
  for (const opp of activeOpps) {
    if (!opp.accountTicker) continue;
    const existing = byAccount.get(opp.accountTicker);
    if (!existing || opp.value > existing.value) {
      byAccount.set(opp.accountTicker, opp);
    }
  }

  // 4. For each account, check recent activity and decide if a meeting is needed
  const needsMeeting: Array<{ opp: Opportunity; contacts: Contact[]; reason: string }> = [];

  for (const [ticker, opp] of byAccount) {
    try {
      // Pull account details + activities via MCP
      const accountRaw = await mcpClient.getCrmAccounts(ticker);
      const accountData = parseMcpResponse(accountRaw);

      // Check recent activities
      const activities = accountData?.activities || [];
      const recentMeetings = activities.filter((a: any) => {
        const type = (a.activityType || a.activitytypecode || '').toLowerCase();
        return type === 'appointment' || type === 'meeting';
      });

      // Find most recent meeting date
      let lastMeetingDaysAgo = 999;
      for (const act of recentMeetings) {
        const actDate = act.scheduledstart || act.date;
        if (actDate) {
          const days = Math.ceil((Date.now() - new Date(actDate).getTime()) / 86400000);
          if (days < lastMeetingDaysAgo) lastMeetingDaysAgo = days;
        }
      }

      // Decision criteria for booking a meeting
      const closeDays = daysUntilClose(opp.closeDate);
      let reason = '';

      if (lastMeetingDaysAgo > 21) {
        reason = `No meeting in ${lastMeetingDaysAgo} days — engagement gap`;
      } else if (closeDays <= 30 && lastMeetingDaysAgo > 7) {
        reason = `Close date in ${closeDays}d, last meeting ${lastMeetingDaysAgo}d ago`;
      } else if (opp.value >= 500000 && lastMeetingDaysAgo > 14) {
        reason = `High-value ($${(opp.value / 1000).toFixed(0)}K), last meeting ${lastMeetingDaysAgo}d ago`;
      }

      if (!reason) {
        result.skippedReasons.push(`${ticker}: recently engaged (${lastMeetingDaysAgo}d ago)`);
        continue;
      }

      // Pull contacts for this account
      let contacts: Contact[] = [];
      try {
        const contactsRaw = await mcpClient.getCrmContacts(ticker);
        const contactsData = parseMcpResponse(contactsRaw);
        const contactArr = contactsData?.contacts || (Array.isArray(contactsData) ? contactsData : []);
        contacts = contactArr.map((c: any) => ({
          name: c.name || c.fullname || '',
          title: c.title || c.jobtitle || '',
          email: c.email || c.emailaddress1 || '',
        })).filter((c: Contact) => c.name && c.email);
      } catch {
        // Continue without contacts — meeting will be PM-only prep time
      }

      needsMeeting.push({ opp, contacts, reason });
    } catch (err) {
      result.skippedReasons.push(`${ticker}: CRM lookup failed`);
    }
  }

  result.accountsNeedingEngagement = needsMeeting.length;

  if (needsMeeting.length === 0) {
    result.skippedReasons.push('All accounts recently engaged — no meetings needed');
    return result;
  }

  // 5. Book meetings and create workflows
  // Sort by priority: closest close date first, then highest value
  needsMeeting.sort((a, b) => {
    const aDays = daysUntilClose(a.opp.closeDate);
    const bDays = daysUntilClose(b.opp.closeDate);
    if (aDays !== bDays) return aDays - bDays;
    return b.opp.value - a.opp.value;
  });

  // Cap at 5 meetings per run to avoid calendar flooding
  const toBook = needsMeeting.slice(0, 5);

  for (let i = 0; i < toBook.length; i++) {
    const { opp, contacts, reason } = toBook[i];
    const primaryContact = contacts[0]; // Best contact (first in CRM)
    const { start, end } = findMeetingSlot(new Date(), i);

    // Build attendee list — include all relevant parties:
    // 1. Agent (so it can capture notes and send meeting summary + actions)
    // 2. All CRM contacts for this account (not just the primary)
    // Note: MANAGER_EMAIL is the calendar owner/organizer — Graph adds them automatically
    const attendees: string[] = [];
    if (AGENT_EMAIL && AGENT_EMAIL !== MANAGER_EMAIL) attendees.push(AGENT_EMAIL);
    for (const c of contacts) {
      if (c.email && !attendees.includes(c.email)) attendees.push(c.email);
    }

    // Book calendar event
    try {
      const contactLines = contacts.length > 0
        ? contacts.map(c => `<li>${c.name} — ${c.title} (<a href="mailto:${c.email}">${c.email}</a>)</li>`).join('\n')
        : '';
      const contactSection = contactLines
        ? `<p><strong>Attendees from ${opp.accountName}:</strong></p><ul>${contactLines}</ul>`
        : '<p><em>No CRM contacts found — add contacts in D365</em></p>';

      const event = await createCalendarEvent({
        subject: `📊 Client Review: ${opp.accountName} (${opp.accountTicker})`,
        body: `<h3>Client Meeting — ${opp.accountName}</h3>
${contactSection}
<p><strong>Opportunity:</strong> ${opp.name} — $${(opp.value / 1000).toFixed(0)}K (${opp.stage})</p>
<p><strong>Why now:</strong> ${reason}</p>
<hr>
<p>📎 Your Digital Worker will send a meeting prep deck with talking points, portfolio data, and CRM history before this meeting.</p>
<p>📝 The Portfolio Manager Agent is invited and will capture meeting notes, generate a summary, and track action items.</p>
<p style="font-size:12px;color:#999">Auto-scheduled by Portfolio Manager Digital Worker</p>`,
        startTime: start,
        endTime: end,
        attendees,
        categories: ['Client Meeting', 'Portfolio Manager'],
      });

      if (event) {
        result.meetingsBooked.push({
          ticker: opp.accountTicker,
          company: opp.accountName,
          contact: contacts.length > 0 ? contacts.map(c => c.name).join(', ') : 'No contact',
          meetingTime: start.toISOString(),
          opportunityValue: opp.value,
        });

        // Log in CRM
        await logCrmActivity({
          ticker: opp.accountTicker,
          activityType: 'meeting',
          subject: `Client review scheduled — ${start.toLocaleDateString()}`,
          description: `Auto-scheduled: ${reason}. Opportunity: ${opp.name} ($${(opp.value / 1000).toFixed(0)}K). Contacts: ${contacts.length > 0 ? contacts.map(c => c.name).join(', ') : 'TBD'}.`,
        });
      }
    } catch (err) {
      console.error(`[Engagement] Failed to book meeting for ${opp.accountTicker}:`, (err as Error).message);
      result.skippedReasons.push(`${opp.accountTicker}: calendar booking failed`);
    }

    // Create client_meeting_prep workflow
    try {
      const wf = await startWorkflow(
        'client_meeting_prep',
        opp.accountTicker,
        opp.accountName,
        {
          meetingTime: start.getTime(),
          opportunityName: opp.name,
          opportunityValue: opp.value,
          opportunityStage: opp.stage,
          primaryContact: primaryContact?.name || '',
          contacts: contacts.map(c => ({ name: c.name, title: c.title, email: c.email })),
          reason,
        },
        'client-engagement-scheduler',
      );
      if (wf) {
        result.workflowsCreated.push(`${opp.accountTicker}: ${wf.id}`);
      }
    } catch (err) {
      console.error(`[Engagement] Failed to create workflow for ${opp.accountTicker}:`, (err as Error).message);
    }
  }

  // 6. Notify PM with summary
  if (result.meetingsBooked.length > 0) {
    const html = buildSummaryEmail(result);
    await postToChannel(html);

    if (MANAGER_EMAIL) {
      await sendEmail({
        to: MANAGER_EMAIL,
        subject: `📅 ${result.meetingsBooked.length} Client Meetings Scheduled — Prep Decks Will Follow`,
        body: html,
        isHtml: true,
      });
    }
  }

  console.log(`[Engagement] Done: ${result.meetingsBooked.length} meetings booked, ${result.workflowsCreated.length} workflows created`);
  return result;
}

// ── Email Template ──────────────────────────────────────────────────

function buildSummaryEmail(result: EngagementResult): string {
  return `
<div style="font-family:Segoe UI,sans-serif;max-width:680px;margin:0 auto">
  <div style="background:#1E2761;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0">📅 Client Meetings Scheduled</h2>
    <p style="margin:4px 0 0;opacity:.85;font-size:13px">${result.meetingsBooked.length} meetings booked from ${result.opportunitiesScanned} pipeline opportunities</p>
  </div>
  <div style="background:#fff;padding:20px;border:1px solid #e0e0e0;border-top:none">
    <table style="border-collapse:collapse;width:100%">
      <tr style="background:#f5f5f5">
        <th style="padding:8px;text-align:left;font-size:12px">Company</th>
        <th style="padding:8px;text-align:left;font-size:12px">Contact</th>
        <th style="padding:8px;text-align:left;font-size:12px">Meeting</th>
        <th style="padding:8px;text-align:right;font-size:12px">Opp Value</th>
      </tr>
      ${result.meetingsBooked.map((m, i) => {
        const date = new Date(m.meetingTime);
        const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        return `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'}">
        <td style="padding:8px"><strong>${m.company}</strong><br><span style="font-size:11px;color:#666">${m.ticker}</span></td>
        <td style="padding:8px;font-size:13px">${m.contact}</td>
        <td style="padding:8px;font-size:13px">${dateStr}<br><span style="color:#666">${timeStr}</span></td>
        <td style="padding:8px;text-align:right;font-size:13px">$${(m.opportunityValue / 1000).toFixed(0)}K</td>
      </tr>`;
      }).join('')}
    </table>

    <div style="margin-top:16px;padding:12px;background:#e8f5e9;border-radius:6px;border-left:4px solid #16a34a">
      <h4 style="margin:0 0 6px;font-size:13px;color:#16a34a">✅ What Happens Next</h4>
      <ul style="margin:0;padding-left:18px;font-size:12px;color:#333">
        <li><strong>${result.workflowsCreated.length} meeting prep workflows</strong> created — I'll gather data, draft talking points, and build a deck for each</li>
        <li>You'll receive a <strong>PowerPoint deck</strong> with portfolio data, CRM history, and talking points before each meeting</li>
        <li>A <strong>reminder email</strong> with key numbers 1 hour before the meeting</li>
        <li>After each meeting, I'll prompt you for notes and <strong>log follow-ups in CRM</strong></li>
      </ul>
    </div>

    ${result.skippedReasons.length > 0 ? `
    <div style="margin-top:12px;padding:10px;background:#f5f5f5;border-radius:4px;font-size:11px;color:#666">
      <strong>Skipped:</strong> ${result.skippedReasons.slice(0, 5).join(' · ')}${result.skippedReasons.length > 5 ? ` (+${result.skippedReasons.length - 5} more)` : ''}
    </div>` : ''}
  </div>
  <div style="padding:8px 20px;font-size:11px;color:#999;text-align:center">
    Auto-scheduled by your Digital Worker based on CRM opportunity pipeline
  </div>
</div>`;
}
