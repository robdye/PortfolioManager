// Portfolio Manager — Adaptive Card Templates
// Adaptive Cards 1.6 Universal Actions for interactive PM workflows.

import { Attachment } from '@microsoft/agents-activity';

// ── Types ──

export interface AdaptiveCard {
  type: 'AdaptiveCard';
  $schema: string;
  version: string;
  body: unknown[];
  actions?: unknown[];
}

interface PortfolioMetric {
  name: string;
  value: string;
  target: string;
  status: 'on-track' | 'at-risk' | 'breached';
}

// ── Card Builder Helpers ──

const SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';
const VERSION = '1.6';

function createCard(body: unknown[], actions?: unknown[]): AdaptiveCard {
  return {
    type: 'AdaptiveCard',
    $schema: SCHEMA,
    version: VERSION,
    body,
    ...(actions?.length ? { actions } : {}),
  };
}

function toAttachment(card: AdaptiveCard): Attachment {
  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: card,
  };
}

function heading(text: string, size: string = 'Large'): unknown {
  return { type: 'TextBlock', text, size, weight: 'Bolder', wrap: true };
}

function textBlock(text: string, opts: Record<string, unknown> = {}): unknown {
  return { type: 'TextBlock', text, wrap: true, ...opts };
}

function factSet(facts: Array<{ title: string; value: string }>): unknown {
  return { type: 'FactSet', facts };
}

function columnSet(columns: unknown[]): unknown {
  return { type: 'ColumnSet', columns };
}

function column(items: unknown[], width: string = 'stretch'): unknown {
  return { type: 'Column', width, items };
}

// ── Card Builders ──

/**
 * Trade confirmation card — lets PM approve or reject a proposed trade.
 */
export function buildTradeConfirmationCard(
  tradeId: string,
  symbol: string,
  action: 'buy' | 'sell',
  quantity: number,
  price: number,
  rationale: string,
  riskScore: number,
  workerName: string
): AdaptiveCard {
  const riskColor = riskScore >= 7 ? 'Attention' : riskScore >= 4 ? 'Warning' : 'Good';
  return createCard(
    [
      heading(`📊 Trade Confirmation — ${symbol}`),
      factSet([
        { title: 'Trade ID', value: tradeId },
        { title: 'Symbol', value: symbol },
        { title: 'Action', value: action.toUpperCase() },
        { title: 'Quantity', value: quantity.toLocaleString() },
        { title: 'Price', value: `$${price.toFixed(2)}` },
        { title: 'Notional', value: `$${(quantity * price).toLocaleString()}` },
        { title: 'Risk Score', value: `${riskScore}/10` },
        { title: 'Proposed by', value: workerName },
      ]),
      textBlock(`**Rationale:** ${rationale}`, { spacing: 'Medium' }),
      textBlock(`Risk: ${riskScore}/10`, { color: riskColor, weight: 'Bolder' }),
      {
        type: 'Input.Text',
        id: 'tradeComments',
        label: 'Comments (optional)',
        isMultiline: true,
        placeholder: 'Add any conditions or concerns…',
      },
    ],
    [
      {
        type: 'Action.Execute',
        title: '✅ Approve Trade',
        verb: 'approveTrade',
        data: { tradeId, action: 'approve' },
        style: 'positive',
      },
      {
        type: 'Action.Execute',
        title: '❌ Reject Trade',
        verb: 'rejectTrade',
        data: { tradeId, action: 'reject' },
        style: 'destructive',
      },
    ]
  );
}

/**
 * Risk alert card — warns about portfolio risk breaches.
 */
export function buildRiskAlertCard(
  alertId: string,
  alertType: string,
  severity: 'high' | 'medium' | 'low',
  summary: string,
  affectedSymbols: string[]
): AdaptiveCard {
  const sevColor = severity === 'high' ? 'Attention' : severity === 'medium' ? 'Warning' : 'Default';
  return createCard(
    [
      heading(`🚨 Risk Alert — ${alertType}`),
      textBlock(severity.toUpperCase(), { color: sevColor, size: 'Medium', weight: 'Bolder' }),
      textBlock(summary, { spacing: 'Medium' }),
      factSet([
        { title: 'Alert ID', value: alertId },
        { title: 'Type', value: alertType },
        { title: 'Severity', value: severity.toUpperCase() },
        { title: 'Affected', value: affectedSymbols.join(', ') },
      ]),
    ],
    [
      {
        type: 'Action.Execute',
        title: '📋 Review Details',
        verb: 'reviewRiskAlert',
        data: { alertId },
      },
      {
        type: 'Action.Execute',
        title: '✅ Acknowledge',
        verb: 'acknowledgeRiskAlert',
        data: { alertId },
      },
    ]
  );
}

/**
 * HITL confirmation card for any portfolio action.
 */
export function createConfirmationCard(action: {
  toolName: string;
  description: string;
  riskLevel: 'write' | 'notify';
  parameters: Record<string, unknown>;
  workerId: string;
  conversationId: string;
}): Attachment {
  const icon = action.riskLevel === 'notify' ? '📧' : '✏️';
  const params = Object.entries(action.parameters)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ({
      title: k,
      value: typeof v === 'string' ? v.substring(0, 100) : JSON.stringify(v).substring(0, 100),
    }));

  const card = createCard([
    {
      type: 'TextBlock',
      text: `${icon} Confirmation Required`,
      weight: 'bolder',
      size: 'large',
    },
    {
      type: 'TextBlock',
      text: `**Action:** ${action.toolName}`,
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: `**Worker:** ${action.workerId}`,
      wrap: true,
      size: 'small',
      isSubtle: true,
    },
    {
      type: 'TextBlock',
      text: action.description,
      wrap: true,
    },
    {
      type: 'FactSet',
      facts: params,
    },
  ], [
    {
      type: 'Action.Execute',
      title: '✅ Approve',
      verb: 'approveAction',
      data: {
        toolName: action.toolName,
        workerId: action.workerId,
        conversationId: action.conversationId,
        decision: 'approve',
      },
      style: 'positive',
    },
    {
      type: 'Action.Execute',
      title: '❌ Reject',
      verb: 'rejectAction',
      data: {
        toolName: action.toolName,
        workerId: action.workerId,
        conversationId: action.conversationId,
        decision: 'reject',
      },
      style: 'destructive',
    },
  ]);

  return toAttachment(card);
}

/**
 * Portfolio summary card (read-only).
 */
export function createPortfolioSummaryCard(holdings: Array<{
  symbol: string;
  name: string;
  quantity: number;
  currentPrice: number;
  pnl: number;
  weight: number;
}>): Attachment {
  const totalPnl = holdings.reduce((sum, h) => sum + h.pnl, 0);

  const rows = holdings.slice(0, 10).map(h => ({
    type: 'TableRow',
    cells: [
      { type: 'TableCell', items: [{ type: 'TextBlock', text: h.symbol, size: 'small', weight: 'Bolder' }] },
      { type: 'TableCell', items: [{ type: 'TextBlock', text: h.name.substring(0, 30), size: 'small', wrap: true }] },
      { type: 'TableCell', items: [{ type: 'TextBlock', text: `$${h.currentPrice.toFixed(2)}`, size: 'small' }] },
      { type: 'TableCell', items: [{ type: 'TextBlock', text: `${h.pnl >= 0 ? '+' : ''}${h.pnl.toFixed(2)}%`, size: 'small', color: h.pnl >= 0 ? 'good' : 'attention' }] },
      { type: 'TableCell', items: [{ type: 'TextBlock', text: `${h.weight.toFixed(1)}%`, size: 'small' }] },
    ],
  }));

  const card = createCard([
    {
      type: 'TextBlock',
      text: `📊 Portfolio Summary (${holdings.length} holdings)`,
      weight: 'bolder',
      size: 'large',
    },
    {
      type: 'TextBlock',
      text: `Total P&L: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%`,
      color: totalPnl >= 0 ? 'good' : 'attention',
      weight: 'bolder',
    },
    {
      type: 'Table',
      columns: [
        { width: 1 }, { width: 2 }, { width: 1 }, { width: 1 }, { width: 1 },
      ],
      rows: [
        {
          type: 'TableRow',
          style: 'accent',
          cells: [
            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'Symbol', weight: 'bolder', size: 'small' }] },
            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'Name', weight: 'bolder', size: 'small' }] },
            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'Price', weight: 'bolder', size: 'small' }] },
            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'P&L', weight: 'bolder', size: 'small' }] },
            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'Weight', weight: 'bolder', size: 'small' }] },
          ],
        },
        ...rows,
      ],
    },
  ]);

  return toAttachment(card);
}

/**
 * Morning briefing card.
 */
export function buildMorningBriefingCard(briefing: {
  date: string;
  marketSummary: string;
  portfolioStatus: string;
  keyEvents: string[];
  actionItems: string[];
}): AdaptiveCard {
  return createCard(
    [
      heading(`☀️ Morning Briefing — ${briefing.date}`),
      {
        type: 'Container',
        items: [
          textBlock('**📈 Market Summary**'),
          textBlock(briefing.marketSummary, { size: 'small' }),
        ],
      },
      {
        type: 'Container',
        items: [
          textBlock('**💼 Portfolio Status**'),
          textBlock(briefing.portfolioStatus, { size: 'small' }),
        ],
      },
      {
        type: 'Container',
        items: [
          textBlock('**📅 Key Events Today**'),
          ...briefing.keyEvents.map((e, i) => textBlock(`${i + 1}. ${e}`, { size: 'small' })),
        ],
      },
      {
        type: 'Container',
        items: [
          textBlock('**🎯 Action Items**'),
          ...briefing.actionItems.map((a, i) => textBlock(`${i + 1}. ${a}`, { size: 'small' })),
        ],
      },
    ],
    [
      {
        type: 'Action.Execute',
        title: '✅ Acknowledge Briefing',
        verb: 'acknowledgeBriefing',
        data: { date: briefing.date },
      },
    ]
  );
}

/**
 * Portfolio KPI dashboard card.
 */
export function buildKPIDashboardCard(metrics: PortfolioMetric[]): AdaptiveCard {
  const rows = metrics.map((m) =>
    columnSet([
      column([textBlock(m.name, { weight: 'Bolder' })], 'stretch'),
      column([textBlock(m.value)], 'auto'),
      column([textBlock(m.target, { isSubtle: true })], 'auto'),
      column([textBlock(
        m.status === 'on-track' ? '✅' : m.status === 'at-risk' ? '⚠️' : '🔴'
      )], 'auto'),
    ])
  );

  return createCard(
    [
      heading('📊 Portfolio KPI Dashboard'),
      columnSet([
        column([textBlock('**Metric**')], 'stretch'),
        column([textBlock('**Actual**')], 'auto'),
        column([textBlock('**Target**')], 'auto'),
        column([textBlock('**Status**')], 'auto'),
      ]),
      ...rows,
    ],
    [
      {
        type: 'Action.Execute',
        title: 'View Full Report',
        verb: 'viewKpiReport',
      },
    ]
  );
}
