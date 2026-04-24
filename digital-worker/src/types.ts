// Portfolio Manager Digital Worker — Shared Types & Utilities

export interface Holding {
  Ticker: string;
  Company: string;
  Shares: number;
  Sector: string;
  'Cost Per Share': number;
  'Total Cost'?: number;
  Type?: string;
  id?: string;
}

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface ScheduledJobResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export interface DecisionInsight {
  ticker: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  timestamp: number;
}

export class DigitalWorkerError extends Error {
  constructor(
    public code: string,
    message: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DigitalWorkerError';
  }
}

/**
 * Parse MCP array responses that may be raw arrays or JSON strings.
 */
export function parseMcpArray<T = unknown>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      return match ? JSON.parse(match[0]) : [];
    } catch (err) {
      console.error('[MCP] Failed to parse array response:', (err as Error).message);
      return [];
    }
  }
  return [];
}
