// Portfolio Manager Digital Worker — Email & People services via Microsoft Graph
// Uses GRAPH_APP_ID credentials with Mail.Send and User.Read.All application permissions.

import { configDotenv } from 'dotenv';
configDotenv();

const GRAPH_APP_ID = process.env.GRAPH_APP_ID || '';
const GRAPH_APP_SECRET = process.env.GRAPH_APP_SECRET || '';
const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID || process.env.connections__service_connection__settings__tenantId || '';
const SENDER_EMAIL = process.env.AGENT_EMAIL || process.env.MANAGER_EMAIL || '';

if (!GRAPH_APP_ID || !GRAPH_APP_SECRET) console.warn('[Email] GRAPH_APP_ID/GRAPH_APP_SECRET not set — email will not work.');

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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token acquisition failed: ${res.status} — ${err.substring(0, 200)}`);
  }
  const data = await res.json() as any;
  _tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in * 1000) };
  return data.access_token;
}

/** Resolve a display name to an email address via Graph user search. */
export async function resolveUserEmail(displayName: string): Promise<string | null> {
  try {
    const token = await getGraphToken();
    const searchName = displayName.replace(/['"<>]/g, '').replace(/<at>|<\/at>/gi, '').trim();
    const filter = encodeURIComponent(`startswith(displayName,'${searchName}')`);
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users?$filter=${filter}&$select=displayName,mail,userPrincipalName&$top=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) {
      const data = await res.json() as any;
      const user = data?.value?.[0];
      if (user) {
        const email = user.mail || user.userPrincipalName;
        console.log(`[Email] Resolved "${displayName.substring(0, 3)}***" → ${email.replace(/(.{2}).*(@.*)/, '$1***$2')}`);
        return email;
      }
    } else {
      const err = await res.text();
      console.error(`[Email] User search failed: ${res.status} — ${err.substring(0, 200)}`);
    }
    console.warn(`[Email] Could not resolve "${displayName}"`);
    return null;
  } catch (err) {
    console.error(`[Email] User lookup failed:`, (err as Error).message);
    return null;
  }
}

/** Send an email via Microsoft Graph using GRAPH_APP_ID credentials. */
export async function sendEmail(params: {
  to: string | string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  attachments?: Array<{ name: string; contentType: string; content: Buffer }>;
}): Promise<boolean> {
  const { to, subject, body, isHtml = true, attachments } = params;
  const recipients = Array.isArray(to) ? to : [to];

  if (!GRAPH_APP_ID || !GRAPH_APP_SECRET) {
    console.error('[Email] No GRAPH_APP_ID/GRAPH_APP_SECRET configured.');
    return false;
  }

  try {
    const token = await getGraphToken();
    const mailBody: any = {
      message: {
        subject,
        body: { contentType: isHtml ? 'HTML' : 'Text', content: body },
        toRecipients: recipients.map((email) => ({ emailAddress: { address: email } })),
      },
    };

    // Add file attachments (base64-encoded for Graph API)
    if (attachments && attachments.length > 0) {
      mailBody.message.attachments = attachments.map((att) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: att.name,
        contentType: att.contentType,
        contentBytes: att.content.toString('base64'),
      }));
    }

    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${SENDER_EMAIL}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(mailBody),
    });

    if (res.ok || res.status === 202) {
      console.log(`[Email] Sent "${subject}" to ${recipients.map(e => e.replace(/(.{2}).*(@.*)/, '$1***$2')).join(', ')}`);
      return true;
    } else {
      const err = await res.text();
      console.error(`[Email] Send failed: ${res.status} — ${err.substring(0, 300)}`);
      return false;
    }
  } catch (error) {
    console.error(`[Email] Exception:`, (error as Error).message);
    return false;
  }
}
