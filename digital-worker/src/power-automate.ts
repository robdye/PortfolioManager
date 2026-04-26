/**
 * Portfolio Manager — Power Automate Integration
 * Triggers Power Automate flows for complex multi-step approval workflows.
 * PM-adapted: trade approval chains, compliance reviews, client sign-offs.
 */

import crypto from 'crypto';

// ── Configuration ──
const FLOW_ENDPOINTS = {
  tradeApproval: process.env.POWER_AUTOMATE_TRADE_APPROVAL_URL || '',
  complianceReview: process.env.POWER_AUTOMATE_COMPLIANCE_REVIEW_URL || '',
  clientSignoff: process.env.POWER_AUTOMATE_CLIENT_SIGNOFF_URL || '',
  riskEscalation: process.env.POWER_AUTOMATE_RISK_ESCALATION_URL || '',
} as const;

type FlowType = keyof typeof FLOW_ENDPOINTS;

// ── Types ──

export interface FlowTrigger {
  flowType: FlowType;
  data: Record<string, unknown>;
  callbackUrl?: string;
  correlationId?: string;
}

export interface FlowResult {
  triggered: boolean;
  flowRunId?: string;
  flowType: FlowType;
  error?: string;
  method: 'power-automate' | 'fallback';
}

export interface TradeApprovalRequest {
  tradeId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  rationale: string;
  approvalChain: Array<{ stage: number; approver: string; role: string }>;
}

export interface ComplianceReviewRequest {
  reviewId: string;
  tradeId: string;
  concentrationCheck: boolean;
  mandateCheck: boolean;
  restrictedListCheck: boolean;
  reviewer: string;
  deadline: string;
}

// ── Flow Triggering ──

export async function triggerFlow(trigger: FlowTrigger): Promise<FlowResult> {
  const endpoint = FLOW_ENDPOINTS[trigger.flowType];

  if (!endpoint) {
    console.warn(`[PowerAutomate] No endpoint for ${trigger.flowType}`);
    return logFallback(trigger);
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...trigger.data,
        correlationId: trigger.correlationId || crypto.randomUUID(),
        callbackUrl: trigger.callbackUrl,
        source: 'pm-digital-worker',
        triggeredAt: new Date().toISOString(),
      }),
    });

    if (res.ok || res.status === 202) {
      const body = await res.json().catch(() => ({})) as Record<string, string>;
      return { triggered: true, flowRunId: body.flowRunId || 'accepted', flowType: trigger.flowType, method: 'power-automate' };
    }

    const errText = await res.text();
    return { triggered: false, flowType: trigger.flowType, error: `HTTP ${res.status}: ${errText.slice(0, 200)}`, method: 'power-automate' };
  } catch (err) {
    return logFallback(trigger);
  }
}

function logFallback(trigger: FlowTrigger): FlowResult {
  console.log(`[PowerAutomate:Fallback] Would trigger ${trigger.flowType}`);
  return { triggered: false, flowType: trigger.flowType, error: 'Flow endpoint not configured', method: 'fallback' };
}

// ── Convenience ──

export async function triggerTradeApproval(req: TradeApprovalRequest): Promise<FlowResult> {
  return triggerFlow({ flowType: 'tradeApproval', data: { ...req }, correlationId: `trade-${req.tradeId}` });
}

export async function triggerComplianceReview(req: ComplianceReviewRequest): Promise<FlowResult> {
  return triggerFlow({ flowType: 'complianceReview', data: { ...req }, correlationId: `compliance-${req.reviewId}` });
}

// ── Callback Handler ──

export interface FlowCallback {
  flowRunId: string;
  flowType: string;
  status: 'Succeeded' | 'Failed' | 'Cancelled' | 'TimedOut';
  outputs: Record<string, unknown>;
  correlationId: string;
}

type FlowCallbackHandler = (callback: FlowCallback) => Promise<void>;
const callbackHandlers = new Map<string, FlowCallbackHandler>();

export function onFlowCallback(flowType: string, handler: FlowCallbackHandler): void {
  callbackHandlers.set(flowType, handler);
}

export async function handleFlowCallback(callback: FlowCallback): Promise<boolean> {
  const handler = callbackHandlers.get(callback.flowType);
  if (handler) { await handler(callback); return true; }
  return false;
}

// ── Status ──

export function getPowerAutomateStatus(): { configuredFlows: string[]; unconfiguredFlows: string[] } {
  const configured: string[] = [], unconfigured: string[] = [];
  for (const [flow, url] of Object.entries(FLOW_ENDPOINTS)) {
    if (url) configured.push(flow); else unconfigured.push(flow);
  }
  return { configuredFlows: configured, unconfiguredFlows: unconfigured };
}
