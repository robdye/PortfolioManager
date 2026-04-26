// Portfolio Manager — KQL Query Templates
// Reusable Kusto Query Language templates for Azure Monitor
// alert rules, Log Analytics workbooks, and dashboards.

export const KQL_QUERIES = {
  /** Agent error rate over the last 1 hour */
  agentErrorRate: `
    let timeRange = 1h;
    let totalRequests = customEvents
      | where timestamp > ago(timeRange)
      | where name startswith "pm."
      | summarize total = count();
    let errors = exceptions
      | where timestamp > ago(timeRange)
      | where customDimensions has "pm"
      | summarize errorCount = count();
    totalRequests | join kind=inner errors on $left.total == $left.total
    | extend errorRate = round(todouble(errorCount) / todouble(total) * 100, 2)
    | project errorRate, total, errorCount`,

  /** Tool call latency percentiles (P50/P95/P99) */
  toolCallLatency: `
    customEvents
    | where name == "pm.tool.call.completed"
    | where timestamp > ago(1h)
    | extend durationMs = todouble(customDimensions.durationMs)
    | extend toolName = tostring(customDimensions.toolName)
    | extend workerId = tostring(customDimensions.workerId)
    | summarize
        p50 = percentile(durationMs, 50),
        p95 = percentile(durationMs, 95),
        p99 = percentile(durationMs, 99),
        callCount = count()
      by toolName, bin(timestamp, 5m)
    | order by timestamp desc`,

  /** HITL approval response times */
  hitlApprovalResponseTimes: `
    customEvents
    | where name == "pm.hitl.completed"
    | where timestamp > ago(24h)
    | extend latencyMs = todouble(customDimensions.latencyMs)
    | extend approvalStatus = tostring(customDimensions.status)
    | extend workerId = tostring(customDimensions.workerId)
    | summarize
        avgResponseMs = avg(latencyMs),
        p50ResponseMs = percentile(latencyMs, 50),
        p95ResponseMs = percentile(latencyMs, 95),
        totalApprovals = count(),
        approved = countif(approvalStatus == "approved"),
        rejected = countif(approvalStatus == "rejected"),
        timedOut = countif(approvalStatus == "timed_out")
      by bin(timestamp, 1h)
    | order by timestamp desc`,

  /** Finnhub API error rate */
  finnhubApiErrorRate: `
    dependencies
    | where type == "HTTP" and target contains "finnhub.io"
    | where timestamp > ago(1h)
    | summarize
        totalCalls = count(),
        failedCalls = countif(success == false),
        errorRate = round(countif(success == false) * 100.0 / count(), 2)
      by bin(timestamp, 5m)
    | order by timestamp desc`,

  /** Token usage by model and worker */
  tokenUsageByModelWorker: `
    customMetrics
    | where name == "gen_ai.client.token.usage"
    | where timestamp > ago(24h)
    | extend model = tostring(customDimensions["gen_ai.request.model"])
    | extend workerId = tostring(customDimensions["worker.id"])
    | extend tokenType = tostring(customDimensions["gen_ai.token.type"])
    | summarize
        totalTokens = sum(value),
        avgTokensPerCall = avg(value),
        callCount = count()
      by model, workerId, tokenType, bin(timestamp, 1h)
    | order by totalTokens desc`,

  /** Failed content safety checks */
  failedContentSafetyChecks: `
    customEvents
    | where name == "pm.content_safety.blocked"
    | where timestamp > ago(24h)
    | extend reason = tostring(customDimensions.reason)
    | extend inputType = tostring(customDimensions.inputType)
    | extend workerId = tostring(customDimensions.workerId)
    | summarize
        blockCount = count(),
        distinctReasons = dcount(reason)
      by reason, inputType, workerId, bin(timestamp, 1h)
    | order by blockCount desc`,

  /** Signal detection trends (PM-specific) */
  signalDetectionTrends: `
    customEvents
    | where name == "pm.signal.detected"
    | where timestamp > ago(7d)
    | extend signalType = tostring(customDimensions.signalType)
    | extend severity = tostring(customDimensions.severity)
    | extend symbol = tostring(customDimensions.symbol)
    | summarize
        signalCount = count(),
        distinctSymbols = dcount(symbol)
      by signalType, severity, bin(timestamp, 1h)
    | order by timestamp desc`,

  /** Trade execution latency (PM-specific) */
  tradeExecutionLatency: `
    customEvents
    | where name == "pm.trade.executed"
    | where timestamp > ago(24h)
    | extend durationMs = todouble(customDimensions.durationMs)
    | extend symbol = tostring(customDimensions.symbol)
    | extend action = tostring(customDimensions.action)
    | summarize
        avgLatencyMs = avg(durationMs),
        p50LatencyMs = percentile(durationMs, 50),
        p95LatencyMs = percentile(durationMs, 95),
        tradeCount = count()
      by symbol, action, bin(timestamp, 1h)
    | order by timestamp desc`,

  /** Worker routing distribution */
  workerRoutingDistribution: `
    customEvents
    | where name == "pm.worker.routed"
    | where timestamp > ago(24h)
    | extend workerId = tostring(customDimensions.workerId)
    | extend intent = tostring(customDimensions.intent)
    | extend confidence = todouble(customDimensions.confidence)
    | summarize
        routeCount = count(),
        avgConfidence = avg(confidence),
        minConfidence = min(confidence)
      by workerId, intent, bin(timestamp, 1h)
    | order by routeCount desc`,

  /** Reasoning trace duration */
  reasoningTraceDuration: `
    customEvents
    | where name == "pm.reasoning.trace"
    | where timestamp > ago(24h)
    | extend durationMs = todouble(customDimensions.durationMs)
    | extend traceSteps = toint(customDimensions.stepCount)
    | extend workerId = tostring(customDimensions.workerId)
    | extend traceType = tostring(customDimensions.traceType)
    | summarize
        avgDurationMs = avg(durationMs),
        p50DurationMs = percentile(durationMs, 50),
        p95DurationMs = percentile(durationMs, 95),
        p99DurationMs = percentile(durationMs, 99),
        avgSteps = avg(traceSteps),
        traceCount = count()
      by workerId, traceType, bin(timestamp, 1h)
    | order by timestamp desc`,

  // ── Alert-specific queries ──

  /** ALERT: Agent error rate > 5% */
  alertAgentErrorRateHigh: `
    let timeRange = 1h;
    let total = toscalar(
      customEvents
      | where timestamp > ago(timeRange) and name startswith "pm."
      | count
    );
    exceptions
    | where timestamp > ago(timeRange)
    | where customDimensions has "pm"
    | summarize errorCount = count()
    | extend errorRate = round(todouble(errorCount) / todouble(total) * 100, 2)
    | where errorRate > 5`,

  /** ALERT: P95 tool latency > 10s */
  alertToolLatencyHigh: `
    customEvents
    | where name == "pm.tool.call.completed"
    | where timestamp > ago(15m)
    | extend durationMs = todouble(customDimensions.durationMs)
    | summarize p95 = percentile(durationMs, 95) by bin(timestamp, 5m)
    | where p95 > 10000`,

  /** ALERT: Finnhub API failures > 10 in 5 min */
  alertFinnhubFailuresHigh: `
    dependencies
    | where type == "HTTP" and target contains "finnhub.io"
    | where timestamp > ago(5m)
    | where success == false
    | summarize failureCount = count()
    | where failureCount > 10`,

  /** ALERT: Token usage spike (>3x baseline) */
  alertTokenUsageSpike: `
    let baseline = toscalar(
      customMetrics
      | where name == "gen_ai.client.token.usage"
      | where timestamp between (ago(7d) .. ago(1d))
      | summarize avg(value)
    );
    customMetrics
    | where name == "gen_ai.client.token.usage"
    | where timestamp > ago(1h)
    | summarize currentAvg = avg(value)
    | where currentAvg > baseline * 3`,

  /** ALERT: HITL approvals pending > 30 min */
  alertHitlApprovalsPending: `
    customEvents
    | where name == "pm.hitl.requested"
    | where timestamp > ago(24h)
    | extend approvalId = tostring(customDimensions.approvalId)
    | join kind=leftanti (
        customEvents
        | where name == "pm.hitl.completed"
        | where timestamp > ago(24h)
        | extend approvalId = tostring(customDimensions.approvalId)
      ) on approvalId
    | where timestamp < ago(30m)
    | summarize pendingCount = count()
    | where pendingCount > 0`,

  /** ALERT: Decision engine no signals during market hours */
  alertNoSignalsMarketHours: `
    let marketOpen = datetime_part("hour", now()) >= 8 and datetime_part("hour", now()) <= 16;
    let recentSignals = customEvents
      | where name == "pm.signal.detected"
      | where timestamp > ago(2h)
      | summarize signalCount = count();
    recentSignals
    | where signalCount == 0 and marketOpen`,

  /** ALERT: Trade execution latency > 30s */
  alertTradeExecutionSlow: `
    customEvents
    | where name == "pm.trade.executed"
    | where timestamp > ago(15m)
    | extend durationMs = todouble(customDimensions.durationMs)
    | summarize p95 = percentile(durationMs, 95)
    | where p95 > 30000`,
} as const;

/** Get a KQL query by name */
export function getKqlQuery(name: keyof typeof KQL_QUERIES): string {
  return KQL_QUERIES[name];
}

/** Get all KQL query names */
export function getKqlQueryNames(): string[] {
  return Object.keys(KQL_QUERIES);
}
