/**
 * Conditional Access — Application-level policy enforcement for PM agent actions.
 * Implements CA-style checks within the digital worker to gate high-risk operations.
 * These are application-level policies, not Entra CA policies (which require portal config).
 */

import { classifyTool, formatConfirmationRequest } from './hitl';

// ── Types ──

export interface ActionContext {
  userId: string;
  userPrincipalName: string;
  deviceCompliant: boolean;
  mfaCompleted: boolean;
  tenantId: string;
  homeTenantId: string;
  ipAddress?: string;
  timestamp: Date;
  workerAction: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

export interface PolicyResult {
  allowed: boolean;
  policyName: string;
  reason: string;
  requiredAction?: 'mfa_stepup' | 'approval_required' | 'blocked';
  hitlPrompt?: string;
}

export interface TradingWindow {
  dayOfWeek: number; // 0=Sunday, 6=Saturday
  startHour: number; // 0-23 UTC
  endHour: number;   // 0-23 UTC
}

export interface ConditionalAccessPolicy {
  name: string;
  description: string;
  enabled: boolean;
  evaluate: (ctx: ActionContext) => PolicyResult;
}

// ── Configuration ──

/** Allowed trading windows (default: Mon-Fri 07:00-21:00 UTC — covers US + EU market hours) */
const DEFAULT_TRADING_WINDOWS: TradingWindow[] = [
  { dayOfWeek: 1, startHour: 7, endHour: 21 },  // Monday
  { dayOfWeek: 2, startHour: 7, endHour: 21 },  // Tuesday
  { dayOfWeek: 3, startHour: 7, endHour: 21 },  // Wednesday
  { dayOfWeek: 4, startHour: 7, endHour: 21 },  // Thursday
  { dayOfWeek: 5, startHour: 7, endHour: 21 },  // Friday
];

const TRADING_WINDOWS: TradingWindow[] = parseTradingWindows() || DEFAULT_TRADING_WINDOWS;

/** Actions that are trade execution operations */
const TRADE_EXECUTION_ACTIONS = [
  'create_order', 'update_holding', 'close_position',
  'rebalance', 'execute_trade', 'submit_order',
];

/** Actions that require MFA step-up (Computer Use / high-impact) */
const MFA_REQUIRED_ACTIONS = [
  'computer_use', 'browser_action', 'remote_desktop',
  'create_order', 'close_position', 'rebalance',
];

/** Actions blocked from non-compliant devices */
const COMPLIANCE_REQUIRED_ACTIONS = [
  'create_order', 'update_holding', 'close_position',
  'rebalance', 'simulate_trade',
  'send_email', 'send_alert', 'post_to_channel',
  'computer_use',
];

/** Actions requiring approval for cross-tenant operations */
const CROSS_TENANT_ACTIONS = [
  'create_order', 'close_position', 'rebalance',
  'send_email', 'send_alert',
  'computer_use',
];

// ── Policy Definitions ──

/** Block trade execution outside market hours */
const tradingWindowPolicy: ConditionalAccessPolicy = {
  name: 'BlockOutsideTradingHours',
  description: 'Prevents trade execution actions outside approved market hours.',
  enabled: true,
  evaluate: (ctx: ActionContext): PolicyResult => {
    const action = ctx.workerAction.toLowerCase();
    if (!TRADE_EXECUTION_ACTIONS.some((a) => action.includes(a))) {
      return { allowed: true, policyName: 'BlockOutsideTradingHours', reason: 'Action is not a trade execution operation.' };
    }

    const now = ctx.timestamp;
    const dayOfWeek = now.getUTCDay();
    const hour = now.getUTCHours();

    const inWindow = TRADING_WINDOWS.some(
      (w) => w.dayOfWeek === dayOfWeek && hour >= w.startHour && hour < w.endHour,
    );

    if (inWindow) {
      return { allowed: true, policyName: 'BlockOutsideTradingHours', reason: 'Within approved trading window.' };
    }

    const windowDesc = TRADING_WINDOWS
      .map((w) => `${dayName(w.dayOfWeek)} ${w.startHour}:00-${w.endHour}:00 UTC`)
      .join(', ');

    return {
      allowed: false,
      policyName: 'BlockOutsideTradingHours',
      reason: `Trade execution action '${ctx.workerAction}' is blocked outside market hours. Allowed: ${windowDesc}`,
      requiredAction: 'blocked',
    };
  },
};

/** Require MFA step-up for Computer Use and high-impact trade actions */
const mfaStepUpPolicy: ConditionalAccessPolicy = {
  name: 'RequireMFAForHighImpact',
  description: 'Requires MFA step-up verification before executing Computer Use or high-impact trade actions.',
  enabled: true,
  evaluate: (ctx: ActionContext): PolicyResult => {
    const action = ctx.workerAction.toLowerCase();
    if (!MFA_REQUIRED_ACTIONS.some((a) => action.includes(a))) {
      return { allowed: true, policyName: 'RequireMFAForHighImpact', reason: 'Action does not require MFA step-up.' };
    }

    if (ctx.mfaCompleted) {
      return { allowed: true, policyName: 'RequireMFAForHighImpact', reason: 'MFA step-up already completed.' };
    }

    const toolClassification = classifyTool(ctx.workerAction);
    const hitlPrompt = formatConfirmationRequest(
      ctx.workerAction,
      { ...toolClassification, description: `🔐 MFA Step-Up Required: ${toolClassification.description}` },
      { action: ctx.workerAction, user: ctx.userPrincipalName },
    );

    return {
      allowed: false,
      policyName: 'RequireMFAForHighImpact',
      reason: `Action '${ctx.workerAction}' requires MFA step-up. User must re-authenticate.`,
      requiredAction: 'mfa_stepup',
      hitlPrompt,
    };
  },
};

/** Block high-risk actions from non-compliant devices */
const deviceCompliancePolicy: ConditionalAccessPolicy = {
  name: 'BlockNonCompliantDevices',
  description: 'Blocks write and notify actions from devices that are not marked compliant in Intune/Entra.',
  enabled: true,
  evaluate: (ctx: ActionContext): PolicyResult => {
    const action = ctx.workerAction.toLowerCase();
    if (!COMPLIANCE_REQUIRED_ACTIONS.some((a) => action.includes(a))) {
      return { allowed: true, policyName: 'BlockNonCompliantDevices', reason: 'Action does not require device compliance.' };
    }

    if (ctx.deviceCompliant) {
      return { allowed: true, policyName: 'BlockNonCompliantDevices', reason: 'Device is compliant.' };
    }

    return {
      allowed: false,
      policyName: 'BlockNonCompliantDevices',
      reason: `Action '${ctx.workerAction}' is blocked because the originating device is not compliant. Ensure the device is enrolled and compliant in Intune.`,
      requiredAction: 'blocked',
    };
  },
};

/** Require approval for cross-tenant operations */
const crossTenantPolicy: ConditionalAccessPolicy = {
  name: 'RequireApprovalCrossTenant',
  description: 'Requires explicit HITL approval when an action targets a different tenant than the user\'s home tenant.',
  enabled: true,
  evaluate: (ctx: ActionContext): PolicyResult => {
    if (ctx.tenantId === ctx.homeTenantId) {
      return { allowed: true, policyName: 'RequireApprovalCrossTenant', reason: 'Same-tenant operation.' };
    }

    const action = ctx.workerAction.toLowerCase();
    if (!CROSS_TENANT_ACTIONS.some((a) => action.includes(a))) {
      return { allowed: true, policyName: 'RequireApprovalCrossTenant', reason: 'Action does not require cross-tenant approval.' };
    }

    const toolClassification = classifyTool(ctx.workerAction);
    const hitlPrompt = formatConfirmationRequest(
      ctx.workerAction,
      { ...toolClassification, description: `🌐 Cross-Tenant Operation: ${toolClassification.description}` },
      {
        action: ctx.workerAction,
        sourceTenant: ctx.homeTenantId,
        targetTenant: ctx.tenantId,
        user: ctx.userPrincipalName,
      },
    );

    return {
      allowed: false,
      policyName: 'RequireApprovalCrossTenant',
      reason: `Cross-tenant action '${ctx.workerAction}' requires explicit approval. Source: ${ctx.homeTenantId}, Target: ${ctx.tenantId}`,
      requiredAction: 'approval_required',
      hitlPrompt,
    };
  },
};

// ── Policy Registry ──

const ALL_POLICIES: ConditionalAccessPolicy[] = [
  tradingWindowPolicy,
  mfaStepUpPolicy,
  deviceCompliancePolicy,
  crossTenantPolicy,
];

// ── Public API ──

/**
 * Evaluate all enabled CA policies against the given action context.
 * Returns the first policy violation, or an 'allowed' result if all pass.
 */
export function evaluatePolicies(ctx: ActionContext): PolicyResult {
  for (const policy of ALL_POLICIES) {
    if (!policy.enabled) continue;
    const result = policy.evaluate(ctx);
    if (!result.allowed) {
      console.log(`[ConditionalAccess] Policy '${policy.name}' BLOCKED action '${ctx.workerAction}' for user '${ctx.userPrincipalName}': ${result.reason}`);
      return result;
    }
  }

  return {
    allowed: true,
    policyName: 'none',
    reason: 'All conditional access policies passed.',
  };
}

/**
 * Quick check: can the current context execute this action?
 */
export function isActionAllowed(ctx: ActionContext): boolean {
  return evaluatePolicies(ctx).allowed;
}

/**
 * Get all registered policies and their enabled status.
 */
export function listPolicies(): Array<{ name: string; description: string; enabled: boolean }> {
  return ALL_POLICIES.map((p) => ({
    name: p.name,
    description: p.description,
    enabled: p.enabled,
  }));
}

/**
 * Check if a specific action is within a trading window right now.
 */
export function isInTradingWindow(timestamp?: Date): boolean {
  const now = timestamp || new Date();
  const dayOfWeek = now.getUTCDay();
  const hour = now.getUTCHours();
  return TRADING_WINDOWS.some(
    (w) => w.dayOfWeek === dayOfWeek && hour >= w.startHour && hour < w.endHour,
  );
}

/**
 * Get the next upcoming trading window.
 */
export function getNextTradingWindow(): { dayOfWeek: string; startHour: number; endHour: number } | null {
  if (TRADING_WINDOWS.length === 0) return null;
  const now = new Date();
  const currentDay = now.getUTCDay();
  const currentHour = now.getUTCHours();

  const sorted = [...TRADING_WINDOWS].sort((a, b) => {
    const aDist = (a.dayOfWeek - currentDay + 7) % 7 || (a.startHour > currentHour ? 0 : 7);
    const bDist = (b.dayOfWeek - currentDay + 7) % 7 || (b.startHour > currentHour ? 0 : 7);
    return aDist - bDist;
  });

  const next = sorted[0];
  return {
    dayOfWeek: dayName(next.dayOfWeek),
    startHour: next.startHour,
    endHour: next.endHour,
  };
}

// ── Helpers ──

function dayName(day: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] || 'Unknown';
}

function parseTradingWindows(): TradingWindow[] | null {
  const env = process.env.PM_TRADING_WINDOWS;
  if (!env) return null;
  try {
    const parsed = JSON.parse(env) as TradingWindow[];
    if (Array.isArray(parsed) && parsed.every((w) => typeof w.dayOfWeek === 'number')) {
      return parsed;
    }
  } catch {
    console.warn('[ConditionalAccess] Failed to parse PM_TRADING_WINDOWS, using defaults');
  }
  return null;
}
