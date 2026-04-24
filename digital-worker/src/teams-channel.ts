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

/** Post a rich Adaptive Card to the Teams channel via webhook */
export async function postAdaptiveCard(card: {
  title: string;
  signals: Array<{ severity: string; title: string; description: string; symbol: string }>;
  analysis: string;
  urgencyLevel: 'critical' | 'high' | 'medium' | 'low';
  runNumber: number;
  missionControlUrl: string;
}): Promise<boolean> {
  if (!CHANNEL_WEBHOOK_URL) return false;

  const isCritical = card.urgencyLevel === 'critical' || card.urgencyLevel === 'high';
  const accentColor = isCritical ? '#dc2626' : '#1a237e';
  const urgencyLabel = isCritical ? '🚨 ACTION REQUIRED' : '📋 Portfolio Intelligence';
  const criticalCount = card.signals.filter(s => s.severity === 'critical' || s.severity === 'high').length;
  const timestamp = new Date().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const severityColors: Record<string, string> = {
    critical: 'Attention', high: 'Warning', medium: 'Warning', low: 'Good', info: 'Default',
  };

  const signalItems: Record<string, unknown>[] = card.signals.map(s => ({
    type: 'Container',
    separator: true,
    spacing: 'Small',
    items: [
      {
        type: 'ColumnSet',
        columns: [
          {
            type: 'Column',
            width: 'auto',
            items: [{
              type: 'TextBlock',
              text: s.severity.toUpperCase(),
              color: severityColors[s.severity] || 'Default',
              weight: 'Bolder',
              size: 'Small',
            }],
          },
          {
            type: 'Column',
            width: 'auto',
            items: [{
              type: 'TextBlock',
              text: s.symbol,
              weight: 'Bolder',
              size: 'Small',
              isSubtle: true,
            }],
          },
          {
            type: 'Column',
            width: 'stretch',
            items: [
              { type: 'TextBlock', text: s.title, weight: 'Bolder', size: 'Small', wrap: true },
              { type: 'TextBlock', text: s.description, size: 'Small', isSubtle: true, wrap: true, spacing: 'None' },
            ],
          },
        ],
      },
    ],
  }));

  const adaptiveCard = {
    type: 'AdaptiveCard',
    version: '1.4',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    body: [
      // Header
      {
        type: 'Container',
        style: isCritical ? 'attention' : 'emphasis',
        bleed: true,
        items: [
          { type: 'TextBlock', text: urgencyLabel, weight: 'Bolder', size: 'Medium', color: isCritical ? 'Attention' : 'Accent' },
          { type: 'TextBlock', text: `Decision Engine — ${timestamp}`, size: 'Small', isSubtle: true, spacing: 'None' },
        ],
      },
      // Stats row
      {
        type: 'ColumnSet',
        spacing: 'Medium',
        columns: [
          {
            type: 'Column', width: '1',
            items: [
              { type: 'TextBlock', text: 'SIGNALS', size: 'Small', weight: 'Bolder', color: 'Accent', horizontalAlignment: 'Center' },
              { type: 'TextBlock', text: String(card.signals.length), size: 'ExtraLarge', weight: 'Bolder', horizontalAlignment: 'Center', spacing: 'None' },
            ],
          },
          {
            type: 'Column', width: '1',
            items: [
              { type: 'TextBlock', text: 'CRITICAL', size: 'Small', weight: 'Bolder', color: criticalCount > 0 ? 'Attention' : 'Default', horizontalAlignment: 'Center' },
              { type: 'TextBlock', text: String(criticalCount), size: 'ExtraLarge', weight: 'Bolder', color: criticalCount > 0 ? 'Attention' : 'Default', horizontalAlignment: 'Center', spacing: 'None' },
            ],
          },
          {
            type: 'Column', width: '1',
            items: [
              { type: 'TextBlock', text: 'RUN #', size: 'Small', weight: 'Bolder', isSubtle: true, horizontalAlignment: 'Center' },
              { type: 'TextBlock', text: String(card.runNumber), size: 'ExtraLarge', weight: 'Bolder', isSubtle: true, horizontalAlignment: 'Center', spacing: 'None' },
            ],
          },
        ],
      },
      // Signals
      {
        type: 'Container',
        spacing: 'Medium',
        items: [
          { type: 'TextBlock', text: '**Signals**', size: 'Small', weight: 'Bolder' },
          ...signalItems,
        ],
      },
      // AI Analysis
      {
        type: 'Container',
        style: 'emphasis',
        spacing: 'Medium',
        items: [
          { type: 'TextBlock', text: '🤖 **AI Analysis**', size: 'Small', weight: 'Bolder', color: 'Accent' },
          { type: 'TextBlock', text: card.analysis, wrap: true, size: 'Small', spacing: 'Small' },
        ],
      },
    ],
    actions: [
      { type: 'Action.OpenUrl', title: '📋 View in Mission Control', url: `${card.missionControlUrl}/mission-control#actions` },
      { type: 'Action.OpenUrl', title: '✅ Acknowledge All', url: `${card.missionControlUrl}/mission-control#acknowledge` },
    ],
  };

  const payload = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: adaptiveCard,
    }],
  };

  try {
    const res = await fetch(CHANNEL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok || res.status === 200 || res.status === 202) {
      console.log('[Channel] Adaptive card posted via webhook');
      return true;
    }
    console.warn(`[Channel] Adaptive card webhook returned ${res.status}`);
    return false;
  } catch (err) {
    console.error('[Channel] Adaptive card webhook error:', (err as Error).message);
    return false;
  }
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
