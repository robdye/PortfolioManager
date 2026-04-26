// Portfolio Manager — Human-in-the-Loop Controls
// Classifies tool calls by side-effect risk level.

export type ToolRiskLevel = 'read' | 'write' | 'notify';

export interface HitlClassification {
  level: ToolRiskLevel;
  requiresConfirmation: boolean;
  description: string;
}

// Tool name patterns for classification
const WRITE_PATTERNS = [
  'create_', 'update_', 'patch_', 'delete_', 'close_',
  'approve_', 'reject_', 'assign_', 'escalate_', 'resolve_',
  'simulate_trade', 'rebalance',
];

const NOTIFY_PATTERNS = [
  'send_email', 'send_teams', 'send_chat', 'post_message',
  'send_alert', 'send_briefing', 'post_to_channel',
  'notify_', 'alert_',
];

const READ_PATTERNS = [
  'get_', 'list_', 'search_', 'query_', 'fetch_', 'lookup_',
  'dashboard', 'briefing', 'metrics', 'status',
  'get_quote', 'get_portfolio', 'get_news', 'get_analyst_consensus',
  'get_earnings', 'search_holdings', 'client_360',
];

export function classifyTool(toolName: string): HitlClassification {
  const lower = toolName.toLowerCase();

  // Check NOTIFY first (most restrictive)
  if (NOTIFY_PATTERNS.some(p => lower.includes(p))) {
    return {
      level: 'notify',
      requiresConfirmation: true,
      description: `Communication action: ${toolName} — will send a message/notification`,
    };
  }

  // Check WRITE
  if (WRITE_PATTERNS.some(p => lower.includes(p))) {
    return {
      level: 'write',
      requiresConfirmation: true,
      description: `Write action: ${toolName} — will modify portfolio data or execute a trade`,
    };
  }

  // Default to READ (safe)
  return {
    level: 'read',
    requiresConfirmation: false,
    description: `Read action: ${toolName} — retrieves data only`,
  };
}

// Generate a confirmation prompt for the user
export function formatConfirmationRequest(
  toolName: string,
  classification: HitlClassification,
  params: Record<string, unknown>
): string {
  const icon = classification.level === 'notify' ? '📧' : '✏️';
  const paramSummary = Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `  • **${k}**: ${typeof v === 'string' ? v.substring(0, 100) : JSON.stringify(v).substring(0, 100)}`)
    .join('\n');

  return `${icon} **Confirmation Required**\n\n` +
    `Action: **${toolName}**\n` +
    `Type: ${classification.level.toUpperCase()}\n\n` +
    `Parameters:\n${paramSummary}\n\n` +
    `Reply **"yes"** to proceed or **"no"** to cancel.`;
}

// Check if a batch of operations needs confirmation
export function batchRequiresConfirmation(toolNames: string[]): boolean {
  return toolNames.some(name => classifyTool(name).requiresConfirmation);
}

// Summary of tool risk levels for a worker's tool set
export function getWorkerRiskSummary(toolNames: string[]): {
  reads: string[];
  writes: string[];
  notifies: string[];
} {
  const reads: string[] = [];
  const writes: string[] = [];
  const notifies: string[] = [];

  for (const name of toolNames) {
    const c = classifyTool(name);
    if (c.level === 'notify') notifies.push(name);
    else if (c.level === 'write') writes.push(name);
    else reads.push(name);
  }

  return { reads, writes, notifies };
}
