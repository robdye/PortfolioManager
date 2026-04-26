// Portfolio Manager — Azure Monitor / Log Analytics
// Structured operational logging with custom events and KQL query templates.

import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('pm-log-analytics');

// ── KQL Query Templates ──

export const KQL_TEMPLATES = {
  /** Agent activity over time */
  agentActivity: `
    customEvents
    | where name startswith "pm."
    | summarize count() by bin(timestamp, 1h), name
    | render timechart`,

  /** Worker routing distribution */
  workerRouting: `
    customEvents
    | where name == "pm.worker.routed"
    | extend workerId = tostring(customDimensions.workerId)
    | summarize count() by workerId
    | render piechart`,

  /** HITL approval latency */
  hitlLatency: `
    customEvents
    | where name == "pm.hitl.completed"
    | extend latencyMs = toint(customDimensions.latencyMs)
    | summarize avg(latencyMs), percentile(latencyMs, 95) by bin(timestamp, 1h)
    | render timechart`,

  /** Content safety blocks */
  safetyBlocks: `
    customEvents
    | where name == "pm.content_safety.blocked"
    | extend reason = tostring(customDimensions.reason)
    | summarize count() by reason, bin(timestamp, 1d)
    | render barchart`,

  /** Finnhub API latency */
  finnhubApiLatency: `
    dependencies
    | where type == "HTTP" and target contains "finnhub.io"
    | summarize avg(duration), percentile(duration, 95), count() by bin(timestamp, 15m)
    | render timechart`,

  /** Error rate by worker */
  errorsByWorker: `
    exceptions
    | extend workerId = tostring(customDimensions.workerId)
    | summarize count() by workerId, bin(timestamp, 1h)
    | render timechart`,

  /** Model usage and token consumption */
  modelUsage: `
    customMetrics
    | where name == "gen_ai.client.token.usage"
    | extend model = tostring(customDimensions["gen_ai.request.model"])
    | summarize sum(value) by model, bin(timestamp, 1h)
    | render timechart`,

  /** Signal detection rate by type */
  signalDetectionRate: `
    customEvents
    | where name == "pm.signal.detected"
    | extend signalType = tostring(customDimensions.signalType)
    | extend severity = tostring(customDimensions.severity)
    | summarize count() by signalType, severity, bin(timestamp, 1h)
    | render timechart`,

  /** Trade simulation history */
  tradeSimulations: `
    customEvents
    | where name == "pm.trade.simulated"
    | extend symbol = tostring(customDimensions.symbol)
    | extend action = tostring(customDimensions.action)
    | summarize count() by symbol, action, bin(timestamp, 1d)
    | render barchart`,

  /** Top 10 active users */
  topUsers: `
    customEvents
    | where name == "pm.message.received"
    | extend userId = tostring(customDimensions.userId)
    | summarize interactions = count() by userId
    | top 10 by interactions`,
} as const;

// ── Custom Event Tracking ──

export interface CustomEvent {
  name: string;
  properties: Record<string, string | number | boolean>;
}

/** Track a custom event (appears in Log Analytics customEvents table). */
export function trackEvent(event: CustomEvent): void {
  const span = tracer.startSpan(event.name);
  for (const [key, value] of Object.entries(event.properties)) {
    span.setAttribute(key, value);
  }
  span.end();
}

/** Track a metric (appears in Log Analytics customMetrics table). */
export function trackMetric(name: string, value: number, dimensions?: Record<string, string>): void {
  const span = tracer.startSpan(`metric.${name}`);
  span.setAttribute('metric.name', name);
  span.setAttribute('metric.value', value);
  if (dimensions) {
    for (const [key, val] of Object.entries(dimensions)) {
      span.setAttribute(key, val);
    }
  }
  span.end();
}

/** Track worker routing for analytics. */
export function trackWorkerRouting(workerId: string, intent: string, confidence: number): void {
  trackEvent({
    name: 'pm.worker.routed',
    properties: { workerId, intent, confidence },
  });
}

/** Track HITL approval completion. */
export function trackHitlCompletion(approvalId: string, status: string, latencyMs: number): void {
  trackEvent({
    name: 'pm.hitl.completed',
    properties: { approvalId, status, latencyMs },
  });
}

/** Track content safety block. */
export function trackSafetyBlock(reason: string, inputType: 'input' | 'output'): void {
  trackEvent({
    name: 'pm.content_safety.blocked',
    properties: { reason, inputType },
  });
}

/** Track signal detection from decision engine. */
export function trackSignalDetected(signalType: string, severity: string, symbol?: string): void {
  trackEvent({
    name: 'pm.signal.detected',
    properties: { signalType, severity, ...(symbol ? { symbol } : {}) },
  });
}

/** Track trade simulation execution. */
export function trackTradeSimulated(symbol: string, action: string, rationale: string): void {
  trackEvent({
    name: 'pm.trade.simulated',
    properties: { symbol, action, rationale: rationale.substring(0, 200) },
  });
}

/** Get available KQL templates for dashboard creation. */
export function getKqlTemplates(): Record<string, string> {
  return { ...KQL_TEMPLATES };
}

/** Get Log Analytics status. */
export function getLogAnalyticsStatus(): {
  kqlTemplatesAvailable: number;
  tracerName: string;
} {
  return {
    kqlTemplatesAvailable: Object.keys(KQL_TEMPLATES).length,
    tracerName: 'pm-log-analytics',
  };
}
