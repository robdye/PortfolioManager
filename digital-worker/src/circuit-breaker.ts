// Portfolio Manager Digital Worker — Circuit Breaker & Retry
//
// Implements the circuit-breaker pattern for external services:
//   - MCP server (portfolio, CRM, finnhub endpoints)
//   - Azure OpenAI
//   - Microsoft Graph API
//
// States: CLOSED → OPEN → HALF_OPEN → CLOSED
// Retry: exponential backoff with jitter

import { analytics } from './analytics';

// ── Circuit Breaker ─────────────────────────────────────────────────

type CircuitState = 'closed' | 'open' | 'half_open';

interface CircuitConfig {
  /** Number of consecutive failures to trip the breaker */
  failureThreshold: number;
  /** How long to stay open before trying again (ms) */
  resetTimeoutMs: number;
  /** How many trial requests in half-open state */
  halfOpenMaxAttempts: number;
}

interface CircuitStatus {
  state: CircuitState;
  failureCount: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  openedAt: number;
  totalTrips: number;
}

const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,   // 30 seconds
  halfOpenMaxAttempts: 2,
};

// Per-service circuit configurations
const SERVICE_CONFIGS: Record<string, Partial<CircuitConfig>> = {
  'mcp-finnhub': { failureThreshold: 5, resetTimeoutMs: 30_000 },
  'mcp-portfolio': { failureThreshold: 3, resetTimeoutMs: 20_000 },
  'mcp-crm': { failureThreshold: 3, resetTimeoutMs: 20_000 },
  'azure-openai': { failureThreshold: 3, resetTimeoutMs: 60_000 },
  'graph-api': { failureThreshold: 5, resetTimeoutMs: 30_000 },
};

class CircuitBreaker {
  private circuits = new Map<string, CircuitStatus>();
  private configs = new Map<string, CircuitConfig>();

  private getConfig(service: string): CircuitConfig {
    if (!this.configs.has(service)) {
      this.configs.set(service, { ...DEFAULT_CONFIG, ...SERVICE_CONFIGS[service] });
    }
    return this.configs.get(service)!;
  }

  private getStatus(service: string): CircuitStatus {
    if (!this.circuits.has(service)) {
      this.circuits.set(service, {
        state: 'closed',
        failureCount: 0,
        lastFailureAt: 0,
        lastSuccessAt: 0,
        openedAt: 0,
        totalTrips: 0,
      });
    }
    return this.circuits.get(service)!;
  }

  /**
   * Check if a request should be allowed through.
   * Returns true if the circuit is closed or half-open (trial allowed).
   */
  canRequest(service: string): boolean {
    const status = this.getStatus(service);
    const config = this.getConfig(service);

    if (status.state === 'closed') return true;

    if (status.state === 'open') {
      // Check if reset timeout has elapsed
      if (Date.now() - status.openedAt >= config.resetTimeoutMs) {
        status.state = 'half_open';
        console.log(`[Circuit] ${service}: OPEN → HALF_OPEN (trying recovery)`);
        return true;
      }
      return false;
    }

    // half_open — allow limited attempts
    return true;
  }

  /**
   * Record a successful call.
   */
  recordSuccess(service: string): void {
    const status = this.getStatus(service);
    if (status.state === 'half_open') {
      status.state = 'closed';
      status.failureCount = 0;
      console.log(`[Circuit] ${service}: HALF_OPEN → CLOSED (recovered)`);
    }
    status.failureCount = 0;
    status.lastSuccessAt = Date.now();
  }

  /**
   * Record a failed call.
   */
  recordFailure(service: string): void {
    const status = this.getStatus(service);
    const config = this.getConfig(service);
    status.failureCount++;
    status.lastFailureAt = Date.now();

    if (status.state === 'half_open') {
      // Failed during recovery — re-open
      status.state = 'open';
      status.openedAt = Date.now();
      status.totalTrips++;
      console.log(`[Circuit] ${service}: HALF_OPEN → OPEN (recovery failed)`);
    } else if (status.failureCount >= config.failureThreshold) {
      status.state = 'open';
      status.openedAt = Date.now();
      status.totalTrips++;
      console.log(`[Circuit] ${service}: CLOSED → OPEN (${status.failureCount} consecutive failures)`);
    }
  }

  /**
   * Get all circuit statuses for diagnostics.
   */
  getAllStatuses(): Record<string, CircuitStatus & { config: CircuitConfig }> {
    const result: Record<string, CircuitStatus & { config: CircuitConfig }> = {};
    for (const [service, status] of this.circuits.entries()) {
      result[service] = { ...status, config: this.getConfig(service) };
    }
    return result;
  }
}

// Singleton
export const circuitBreaker = new CircuitBreaker();

// ── Retry with Exponential Backoff ──────────────────────────────────

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Jitter factor: 0 = no jitter, 1 = full jitter */
  jitterFactor: number;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 15_000,
  jitterFactor: 0.5,
};

function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponential = Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
  const jitter = exponential * config.jitterFactor * Math.random();
  return exponential + jitter;
}

/**
 * Execute a function with retry and circuit breaker protection.
 *
 * @param service - Circuit breaker service name
 * @param fn - The async function to execute
 * @param retryConfig - Optional retry configuration overrides
 */
export async function withResilience<T>(
  service: string,
  fn: () => Promise<T>,
  retryConfig?: Partial<RetryConfig>,
): Promise<T> {
  const config = { ...DEFAULT_RETRY, ...retryConfig };

  if (!circuitBreaker.canRequest(service)) {
    throw new Error(`[Circuit] ${service} circuit is OPEN — request blocked`);
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const start = Date.now();
      const result = await fn();
      const duration = Date.now() - start;

      circuitBreaker.recordSuccess(service);
      analytics.recordToolCall(service, duration, true);
      return result;

    } catch (err) {
      lastError = err as Error;
      const duration = Date.now();

      // Don't retry on client errors (4xx) — only server/network errors
      if (isClientError(lastError)) {
        circuitBreaker.recordSuccess(service); // Not a service failure
        analytics.recordToolCall(service, 0, false);
        throw lastError;
      }

      circuitBreaker.recordFailure(service);
      analytics.recordToolCall(service, 0, false);

      if (attempt < config.maxRetries) {
        const delay = calculateDelay(attempt, config);
        console.log(`[Retry] ${service} attempt ${attempt + 1}/${config.maxRetries} failed, retrying in ${Math.round(delay)}ms: ${lastError.message}`);
        await sleep(delay);

        // Re-check circuit breaker before retry
        if (!circuitBreaker.canRequest(service)) {
          throw new Error(`[Circuit] ${service} circuit opened during retries`);
        }
      }
    }
  }

  throw lastError || new Error(`${service} failed after ${config.maxRetries} retries`);
}

function isClientError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes('400') || msg.includes('401') || msg.includes('403') || msg.includes('404') || msg.includes('422');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
