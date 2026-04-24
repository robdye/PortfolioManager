// Portfolio Manager Digital Worker — Analytics & Observability
//
// Inspired by CorpGen's analytics.ts — tracks operational metrics
// across all agent activities. Exposes via /api/analytics endpoint.
//
// Metrics tracked:
//   - Tool usage (call counts, durations, error rates)
//   - Task execution (success/failure, duration distributions)
//   - Decision engine (signals detected, alerts sent, effectiveness)
//   - System health (uptime, memory, active sessions)
//   - Correlation IDs for end-to-end tracing

import crypto from 'crypto';

// ── Metric Types ────────────────────────────────────────────────────

interface ToolMetric {
  name: string;
  callCount: number;
  totalDurationMs: number;
  errorCount: number;
  lastCalledAt: number;
  avgDurationMs: number;
}

interface TaskMetric {
  name: string;
  runCount: number;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  lastRunAt: number;
  tags: string[];
}

interface DecisionMetric {
  totalRuns: number;
  signalsDetected: number;
  alertsSent: number;
  alertsSuppressed: number;
  lastRunAt: number;
  signalsByType: Record<string, number>;
}

interface SystemMetric {
  startedAt: number;
  uptimeMs: number;
  requestCount: number;
  activeCorrelations: number;
  memoryUsageMb: number;
}

// ── Correlation ID Tracking ─────────────────────────────────────────

function generateCorrelationId(): string {
  // Use crypto.randomUUID if available, otherwise timestamp-based
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ── Analytics Singleton ─────────────────────────────────────────────

class Analytics {
  private toolMetrics = new Map<string, ToolMetric>();
  private taskMetrics = new Map<string, TaskMetric>();
  private decisionMetrics: DecisionMetric = {
    totalRuns: 0, signalsDetected: 0, alertsSent: 0,
    alertsSuppressed: 0, lastRunAt: 0, signalsByType: {},
  };
  private startedAt = Date.now();
  private requestCount = 0;
  private correlations = new Map<string, { startedAt: number; operation: string }>();

  // ── Tool Metrics ──

  recordToolCall(toolName: string, durationMs: number, success: boolean): void {
    let metric = this.toolMetrics.get(toolName);
    if (!metric) {
      metric = { name: toolName, callCount: 0, totalDurationMs: 0, errorCount: 0, lastCalledAt: 0, avgDurationMs: 0 };
      this.toolMetrics.set(toolName, metric);
    }
    metric.callCount++;
    metric.totalDurationMs += durationMs;
    if (!success) metric.errorCount++;
    metric.lastCalledAt = Date.now();
    metric.avgDurationMs = metric.totalDurationMs / metric.callCount;
  }

  // ── Task Metrics ──

  recordTaskStart(taskName: string, tags: string[]): string {
    let metric = this.taskMetrics.get(taskName);
    if (!metric) {
      metric = { name: taskName, runCount: 0, successCount: 0, errorCount: 0, timeoutCount: 0, totalDurationMs: 0, avgDurationMs: 0, lastRunAt: 0, tags };
      this.taskMetrics.set(taskName, metric);
    }
    metric.runCount++;
    metric.lastRunAt = Date.now();

    const correlationId = generateCorrelationId();
    this.correlations.set(correlationId, { startedAt: Date.now(), operation: taskName });
    return correlationId;
  }

  recordTaskComplete(taskName: string, durationMs: number, status: 'success' | 'error' | 'timeout' | 'skipped'): void {
    const metric = this.taskMetrics.get(taskName);
    if (!metric) return;
    metric.totalDurationMs += durationMs;
    metric.avgDurationMs = metric.totalDurationMs / metric.runCount;
    if (status === 'success') metric.successCount++;
    else if (status === 'error') metric.errorCount++;
    else if (status === 'timeout') metric.timeoutCount++;
  }

  // ── Decision Engine Metrics ──

  recordDecisionRun(signalsDetected: number, alertsSent: number, suppressed: number, signalsByType: Record<string, number>): void {
    this.decisionMetrics.totalRuns++;
    this.decisionMetrics.signalsDetected += signalsDetected;
    this.decisionMetrics.alertsSent += alertsSent;
    this.decisionMetrics.alertsSuppressed += suppressed;
    this.decisionMetrics.lastRunAt = Date.now();
    for (const [type, count] of Object.entries(signalsByType)) {
      this.decisionMetrics.signalsByType[type] = (this.decisionMetrics.signalsByType[type] || 0) + count;
    }
  }

  // ── Request Tracking ──

  recordRequest(): string {
    this.requestCount++;
    return generateCorrelationId();
  }

  // ── Snapshot for /api/analytics ──

  getSnapshot(): {
    system: SystemMetric;
    tools: ToolMetric[];
    tasks: TaskMetric[];
    decision: DecisionMetric;
  } {
    // Clean up old correlations (> 10 min)
    const cutoff = Date.now() - 600_000;
    for (const [id, c] of this.correlations.entries()) {
      if (c.startedAt < cutoff) this.correlations.delete(id);
    }

    const memUsage = process.memoryUsage();
    return {
      system: {
        startedAt: this.startedAt,
        uptimeMs: Date.now() - this.startedAt,
        requestCount: this.requestCount,
        activeCorrelations: this.correlations.size,
        memoryUsageMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      },
      tools: Array.from(this.toolMetrics.values())
        .sort((a, b) => b.callCount - a.callCount),
      tasks: Array.from(this.taskMetrics.values())
        .sort((a, b) => b.runCount - a.runCount),
      decision: { ...this.decisionMetrics },
    };
  }

  // ── Top-level summary for health endpoint ──

  getHealthSummary(): Record<string, unknown> {
    const snap = this.getSnapshot();
    return {
      uptimeHours: Math.round(snap.system.uptimeMs / 3600000 * 10) / 10,
      totalRequests: snap.system.requestCount,
      toolCalls: snap.tools.reduce((sum, t) => sum + t.callCount, 0),
      taskRuns: snap.tasks.reduce((sum, t) => sum + t.runCount, 0),
      decisionRuns: snap.decision.totalRuns,
      alertsSent: snap.decision.alertsSent,
      memoryMb: snap.system.memoryUsageMb,
    };
  }
}

// Singleton instance
export const analytics = new Analytics();
