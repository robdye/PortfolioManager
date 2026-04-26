// Portfolio Manager — OpenTelemetry Instrumentation
// Standard OTel with GenAI semantic conventions alongside Agent 365 observability.
// Propagates W3C Trace Context across MCP calls and market data requests.

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { trace, metrics, SpanKind, SpanStatusCode, type Span } from '@opentelemetry/api';

// GenAI semantic convention attribute names (draft spec)
const GEN_AI_SYSTEM = 'gen_ai.system';
const GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
const GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
const GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
const GEN_AI_TOOL_NAME = 'gen_ai.tool.name';

let sdk: NodeSDK | null = null;

const TRACER_NAME = 'portfolio-manager-worker';
const METER_NAME = 'portfolio-manager-worker';

/**
 * Initialize OpenTelemetry SDK.
 * Call once at startup, before any other imports that need tracing.
 */
export function initTelemetry(): void {
  const appInsightsCs = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!appInsightsCs && !otlpEndpoint) {
    console.log('[OTel] No APPLICATIONINSIGHTS_CONNECTION_STRING or OTEL_EXPORTER_OTLP_ENDPOINT configured — OTel disabled');
    return;
  }

  const traceExporters: any[] = [];
  const metricExporters: any[] = [];

  // Azure Monitor (App Insights) exporter
  if (appInsightsCs) {
    try {
      const { AzureMonitorTraceExporter, AzureMonitorMetricExporter } = require('@azure/monitor-opentelemetry-exporter');
      traceExporters.push(new AzureMonitorTraceExporter({ connectionString: appInsightsCs }));
      metricExporters.push(new AzureMonitorMetricExporter({ connectionString: appInsightsCs }));
      console.log('[OTel] Azure Monitor exporter configured');
    } catch (err) {
      console.warn('[OTel] @azure/monitor-opentelemetry-exporter not available, skipping Azure Monitor:', (err as Error).message);
    }
  }

  // OTLP exporter (for custom collector)
  if (otlpEndpoint) {
    traceExporters.push(new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` }));
    metricExporters.push(new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics` }));
    console.log(`[OTel] OTLP exporter configured: ${otlpEndpoint}`);
  }

  if (traceExporters.length === 0 && metricExporters.length === 0) {
    console.log('[OTel] No exporters available — OTel disabled');
    return;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'portfolio-manager-worker',
    [ATTR_SERVICE_VERSION]: '1.0.0',
    'deployment.environment': process.env.NODE_ENV || 'development',
    'agent.type': 'digital-worker',
    'agent.framework': 'agent-365',
  });

  sdk = new NodeSDK({
    resource,
    traceExporter: traceExporters[0],
    metricReader: metricExporters.length > 0
      ? new PeriodicExportingMetricReader({
          exporter: metricExporters[0],
          exportIntervalMillis: 60000,
        })
      : undefined,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': { enabled: true },
        '@opentelemetry/instrumentation-express': { enabled: true },
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  try {
    sdk.start();
    console.log('[OTel] OpenTelemetry SDK started successfully');
  } catch (err) {
    console.error('[OTel] Failed to start OpenTelemetry SDK:', err);
  }

  // Graceful shutdown
  process.on('SIGTERM', () => sdk?.shutdown().catch(console.error));
  process.on('SIGINT', () => sdk?.shutdown().catch(console.error));
}

// ── Tracer & Meter accessors ──

export function getTracer() {
  return trace.getTracer(TRACER_NAME, '1.0.0');
}

export function getMeter() {
  return metrics.getMeter(METER_NAME, '1.0.0');
}

// ── GenAI span helpers ──

/** Start a span for an LLM inference call */
export function startInferenceSpan(operationName: string, model: string): Span {
  const tracer = getTracer();
  return tracer.startSpan(`gen_ai.${operationName}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      [GEN_AI_SYSTEM]: 'openai',
      [GEN_AI_REQUEST_MODEL]: model,
    },
  });
}

/** Record token usage on an inference span */
export function recordTokenUsage(span: Span, inputTokens: number, outputTokens: number): void {
  span.setAttributes({
    [GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
    [GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
  });
}

/** Start a span for a tool call */
export function startToolSpan(toolName: string, workerId: string): Span {
  const tracer = getTracer();
  return tracer.startSpan(`tool.${toolName}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      [GEN_AI_TOOL_NAME]: toolName,
      'worker.id': workerId,
    },
  });
}

/** Start a span for worker routing */
export function startRoutingSpan(userMessage: string, workerId: string, confidence: string): Span {
  const tracer = getTracer();
  return tracer.startSpan('worker.route', {
    kind: SpanKind.INTERNAL,
    attributes: {
      'worker.id': workerId,
      'routing.confidence': confidence,
      'user.message_length': userMessage.length,
    },
  });
}

/** Start a span for MCP server calls */
export function startMcpSpan(toolName: string, serverUrl: string): Span {
  const tracer = getTracer();
  return tracer.startSpan(`mcp.${toolName}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      'mcp.tool': toolName,
      'mcp.server_url': serverUrl,
    },
  });
}

/** Start a span for market data API calls */
export function startMarketDataSpan(provider: string, endpoint: string): Span {
  const tracer = getTracer();
  return tracer.startSpan(`market_data.${provider}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      'market_data.provider': provider,
      'market_data.endpoint': endpoint,
    },
  });
}

/** End a span with success status */
export function endSpanOk(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

/** End a span with error status */
export function endSpanError(span: Span, error: Error | string): void {
  span.setStatus({ code: SpanStatusCode.ERROR, message: typeof error === 'string' ? error : error.message });
  if (error instanceof Error) span.recordException(error);
  span.end();
}

// ── Metrics ──

let workerInvocationCounter: any;
let toolCallCounter: any;
let responseLatencyHistogram: any;
let signalDetectedCounter: any;
let tradeSimulatedCounter: any;

export function initMetrics(): void {
  const meter = getMeter();

  workerInvocationCounter = meter.createCounter('pm.worker.invocations', {
    description: 'Number of worker invocations',
    unit: '1',
  });

  toolCallCounter = meter.createCounter('pm.tool.calls', {
    description: 'Number of tool calls',
    unit: '1',
  });

  responseLatencyHistogram = meter.createHistogram('pm.response.latency', {
    description: 'Response latency in milliseconds',
    unit: 'ms',
  });

  signalDetectedCounter = meter.createCounter('pm.signal.detected', {
    description: 'Number of decision engine signals detected',
    unit: '1',
  });

  tradeSimulatedCounter = meter.createCounter('pm.trade.simulated', {
    description: 'Number of trade simulations run',
    unit: '1',
  });
}

export function recordWorkerInvocation(workerId: string, confidence: string): void {
  workerInvocationCounter?.add(1, { 'worker.id': workerId, 'routing.confidence': confidence });
}

export function recordToolCall(toolName: string, workerId: string): void {
  toolCallCounter?.add(1, { 'tool.name': toolName, 'worker.id': workerId });
}

export function recordResponseLatency(durationMs: number, workerId: string): void {
  responseLatencyHistogram?.record(durationMs, { 'worker.id': workerId });
}

export function recordSignalDetected(signalType: string, severity: string): void {
  signalDetectedCounter?.add(1, { 'signal.type': signalType, 'signal.severity': severity });
}

export function recordTradeSimulated(symbol: string, action: string): void {
  tradeSimulatedCounter?.add(1, { 'trade.symbol': symbol, 'trade.action': action });
}
