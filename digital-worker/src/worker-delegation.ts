// Portfolio Manager — Worker-to-Worker Delegation
// Investment desk chain-of-command:
// Researcher → Risk Analyst (material risk found)
// Risk Analyst → Trader (risk acceptable, opportunity identified)
// Trader → Compliance (pre-trade compliance check)
// Compliance → Trader (approved — execute)
// Any → Client Relationship (client-impacting decision)
// Any → Command Center (cross-domain escalation)

import { runWorker, type PromptContext, type HarnessResult } from './agent-harness';
import { workerMap } from './worker-definitions';

// ── Delegation Rules ──

export interface DelegationRule {
  sourceWorker: string;
  targetWorker: string;
  trigger: string;
  promptTemplate: (context: string) => string;
}

export const DELEGATION_RULES: DelegationRule[] = [
  {
    sourceWorker: 'market-researcher',
    targetWorker: 'risk-analyst',
    trigger: 'Research reveals material risk requiring risk assessment',
    promptTemplate: (ctx) => `[DELEGATION from Market Researcher]\n\nResearch has uncovered a material risk that requires formal risk assessment.\n\nFindings:\n${ctx}\n\nPlease assess the portfolio impact and recommend mitigating actions.`,
  },
  {
    sourceWorker: 'market-researcher',
    targetWorker: 'trader',
    trigger: 'Research identifies trade opportunity',
    promptTemplate: (ctx) => `[DELEGATION from Market Researcher]\n\nResearch has identified a potential trade opportunity.\n\nOpportunity Details:\n${ctx}\n\nPlease evaluate the trade idea and simulate the portfolio impact.`,
  },
  {
    sourceWorker: 'risk-analyst',
    targetWorker: 'trader',
    trigger: 'Risk acceptable, opportunity identified for trade idea',
    promptTemplate: (ctx) => `[DELEGATION from Risk Analyst]\n\nRisk assessment complete. The risk is within acceptable limits and an opportunity has been identified.\n\nAssessment:\n${ctx}\n\nPlease develop a trade proposal with entry point and size.`,
  },
  {
    sourceWorker: 'risk-analyst',
    targetWorker: 'compliance-officer',
    trigger: 'Limit breach detected requiring compliance review',
    promptTemplate: (ctx) => `[DELEGATION from Risk Analyst]\n\nA portfolio limit breach has been detected that requires compliance review.\n\nBreach Details:\n${ctx}\n\nPlease assess the regulatory implications and recommend corrective actions.`,
  },
  {
    sourceWorker: 'trader',
    targetWorker: 'compliance-officer',
    trigger: 'Pre-trade compliance check before execution',
    promptTemplate: (ctx) => `[DELEGATION from Trader]\n\nA trade proposal requires pre-trade compliance clearance.\n\nTrade Details:\n${ctx}\n\nPlease check against mandate limits, restricted lists, and concentration thresholds.`,
  },
  {
    sourceWorker: 'compliance-officer',
    targetWorker: 'trader',
    trigger: 'Trade approved — proceed to execution',
    promptTemplate: (ctx) => `[DELEGATION from Compliance Officer]\n\nThe trade has been approved by Compliance.\n\nApproval Details:\n${ctx}\n\nPlease proceed with execution (HITL approval will be required).`,
  },
  {
    sourceWorker: 'trader',
    targetWorker: 'client-relationship',
    trigger: 'Trade executed — client notification required',
    promptTemplate: (ctx) => `[DELEGATION from Trader]\n\nA trade has been executed that the PM/client should be notified about.\n\nTrade Execution Details:\n${ctx}\n\nPlease draft the client notification.`,
  },
  {
    sourceWorker: 'risk-analyst',
    targetWorker: 'client-relationship',
    trigger: 'Risk event requires client communication',
    promptTemplate: (ctx) => `[DELEGATION from Risk Analyst]\n\nA risk event has occurred that requires client communication.\n\nRisk Event:\n${ctx}\n\nPlease draft an appropriate client communication.`,
  },
];

// ── Delegation Result ──

export interface DelegationResult {
  delegationId: string;
  sourceWorker: string;
  targetWorker: string;
  trigger: string;
  result: HarnessResult;
  timestamp: Date;
}

// ── Delegation Execution ──

export async function delegateToWorker(
  sourceWorkerId: string,
  targetWorkerId: string,
  context: string,
  displayName?: string,
): Promise<DelegationResult> {
  const targetWorker = workerMap.get(targetWorkerId);
  if (!targetWorker) {
    throw new Error(`Unknown target worker: ${targetWorkerId}`);
  }

  const rule = DELEGATION_RULES.find(
    r => r.sourceWorker === sourceWorkerId && r.targetWorker === targetWorkerId
  );

  const prompt = rule
    ? rule.promptTemplate(context)
    : `[DELEGATION from ${sourceWorkerId}]\n\n${context}`;

  const ctx: PromptContext = {
    userMessage: context,
    displayName: displayName || 'System (auto-delegation)',
  };

  console.log(`[Delegation] ${sourceWorkerId} → ${targetWorkerId}: ${rule?.trigger || 'ad-hoc delegation'}`);

  const result = await runWorker(targetWorker, prompt, ctx);

  return {
    delegationId: `del-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    sourceWorker: sourceWorkerId,
    targetWorker: targetWorkerId,
    trigger: rule?.trigger || 'Ad-hoc delegation',
    result,
    timestamp: new Date(),
  };
}

export function canDelegate(sourceWorkerId: string, targetWorkerId: string): boolean {
  return DELEGATION_RULES.some(
    r => r.sourceWorker === sourceWorkerId && r.targetWorker === targetWorkerId
  );
}

export function getDelegationTargets(sourceWorkerId: string): Array<{ targetWorker: string; trigger: string }> {
  return DELEGATION_RULES
    .filter(r => r.sourceWorker === sourceWorkerId)
    .map(r => ({ targetWorker: r.targetWorker, trigger: r.trigger }));
}
