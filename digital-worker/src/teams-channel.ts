// Portfolio Manager Digital Worker — Teams channel messaging via Workflows webhook
// Posts to the Finance > Portfolio Alerts channel using the Workflows webhook URL.
// No Graph permissions required — webhook handles auth automatically.

import { configDotenv } from 'dotenv';
configDotenv();

const CHANNEL_WEBHOOK_URL = process.env.CHANNEL_WEBHOOK_URL || '';

if (!CHANNEL_WEBHOOK_URL) console.warn('[Teams] No CHANNEL_WEBHOOK_URL set — channel posting will fail.');

/** Post via Workflows webhook (preferred — no permissions needed) */
async function postViaWebhook(content: string): Promise<boolean> {
  if (!CHANNEL_WEBHOOK_URL) return false;
  try {
    // Adaptive Card format for Power Automate / Incoming Webhook
    const payload = {
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          version: "1.4",
          body: [{ type: "TextBlock", text: content, wrap: true }],
        },
      }],
    };
    const res = await fetch(CHANNEL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok || res.status === 200 || res.status === 202) {
      console.log('[Channel] Message posted via webhook');
      return true;
    }
    console.warn(`[Channel] Webhook post returned ${res.status}`);
    return false;
  } catch (err) {
    console.error('[Channel] Webhook error:', (err as Error).message);
    return false;
  }
}

export async function postToChannel(content: string, isHtml = true): Promise<boolean> {
  const webhookResult = await postViaWebhook(content.replace(/<[^>]*>/g, ''));
  if (webhookResult) return true;
  console.warn('[Channel] Webhook failed and no fallback available');
  return false;
}

export async function postPriceAlert(alerts: Array<{
  symbol: string; company?: string; previousPrice: number; currentPrice: number; changePercent: number; direction: 'up' | 'down';
}>): Promise<boolean> {
  const alertRows = alerts.map(a => {
    const arrow = a.direction === 'up' ? '📈' : '📉';
    return `${a.symbol}: ${arrow} ${a.changePercent > 0 ? '+' : ''}${a.changePercent.toFixed(2)}% ($${a.previousPrice.toFixed(2)} → $${a.currentPrice.toFixed(2)})`;
  }).join('\n');
  return postToChannel(`🚨 **Portfolio Price Alert**\n\n${alertRows}\n\n_${new Date().toLocaleString('en-GB')}_`, false);
}
