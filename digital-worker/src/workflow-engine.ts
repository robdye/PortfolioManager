// Portfolio Manager Digital Worker — Workflow Engine
//
// Multi-step task chains that span multiple runs. Unlike the agent
// harness (single LLM calls), workflows are stateful sequences where
// completing one step triggers the next — across hours or days.
//
// Example: Earnings workflow:
//   Step 1 (T-3d): Detect upcoming earnings → create action "prepare"
//   Step 2 (T-1d): Pull consensus + SEC filings → email prep materials
//   Step 3 (T+0d): Alert "earnings today" → block calendar
//   Step 4 (T+1d): Compare results vs estimate → update thesis
//   Step 5 (T+2d): Recommend position change → track in action tracker
//
// Each step is a function. The engine persists workflow state between
// container restarts and checks which steps are due on each cycle.

import { saveMemory, loadMemory } from './persistent-memory';

// ── Types ───────────────────────────────────────────────────────────

export type WorkflowStatus = 'active' | 'completed' | 'failed' | 'paused';

export interface WorkflowStep {
  name: string;
  description: string;
  dueAt: number;            // Timestamp when this step should execute
  completedAt?: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: string;
  error?: string;
}

export interface Workflow {
  id: string;
  type: string;              // 'earnings_prep' | 'position_entry' | 'risk_remediation' | 'client_meeting_prep'
  symbol: string;
  company: string;
  status: WorkflowStatus;
  steps: WorkflowStep[];
  currentStepIndex: number;
  context: Record<string, unknown>;  // Shared state between steps
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  triggeredBy: string;       // Which module created this workflow
}

export interface WorkflowTemplate {
  type: string;
  description: string;
  createSteps: (symbol: string, company: string, context: Record<string, unknown>) => WorkflowStep[];
}

// ── In-memory cache ─────────────────────────────────────────────────

const workflows = new Map<string, Workflow>();
let loaded = false;
let loadPromise: Promise<void> | null = null;
let wfCounter = 0;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const data = await loadMemory('workflows', 'active');
      if (data && Array.isArray((data as any).items)) {
        for (const wf of (data as any).items as Workflow[]) {
          workflows.set(wf.id, wf);
        }
        wfCounter = (data as any).counter || workflows.size;
        console.log(`[Workflows] Restored ${workflows.size} workflows`);
      }
    } catch (err) {
      console.warn('[Workflows] Failed to load:', (err as Error).message);
    } finally {
      loaded = true;
      loadPromise = null;
    }
  })();
  return loadPromise;
}

async function persist(): Promise<void> {
  const items = Array.from(workflows.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 200);
  workflows.clear();
  for (const wf of items) workflows.set(wf.id, wf);
  await saveMemory('workflows', 'active', { items, counter: wfCounter }).catch((err) => { console.error('[Workflow] Failed to persist:', (err as Error).message); });
}

// ── Workflow Templates ──────────────────────────────────────────────

const templates: Map<string, WorkflowTemplate> = new Map();

/**
 * Register a workflow template.
 */
export function registerTemplate(template: WorkflowTemplate): void {
  templates.set(template.type, template);
}

// ── Built-in Templates ──────────────────────────────────────────────

// Earnings Preparation Workflow
registerTemplate({
  type: 'earnings_prep',
  description: 'End-to-end earnings preparation, monitoring, and post-earnings analysis',
  createSteps: (_symbol, _company, context) => {
    const earningsDate = (context.earningsDate as number) || Date.now() + 3 * 86400000;
    return [
      { name: 'research', description: 'Pull analyst consensus, SEC filings, and peer earnings', dueAt: earningsDate - 3 * 86400000, status: 'pending' },
      { name: 'prep_materials', description: 'Generate pre-earnings position review with key metrics', dueAt: earningsDate - 1 * 86400000, status: 'pending' },
      { name: 'day_of_alert', description: 'Alert PM that earnings are today, include position size and risk', dueAt: earningsDate, status: 'pending' },
      { name: 'post_earnings', description: 'Compare actual vs estimate, analyze surprise direction', dueAt: earningsDate + 1 * 86400000, status: 'pending' },
      { name: 'thesis_update', description: 'Update investment thesis and recommend position change if needed', dueAt: earningsDate + 2 * 86400000, status: 'pending' },
    ];
  },
});

// Position Entry Workflow
registerTemplate({
  type: 'position_entry',
  description: 'New position research, sizing, compliance check, and execution tracking',
  createSteps: () => {
    const now = Date.now();
    return [
      { name: 'research', description: 'Deep-dive fundamentals: financials, peers, analyst consensus, insider activity', dueAt: now, status: 'pending' },
      { name: 'thesis', description: 'Draft investment thesis with entry price, target, stop-loss', dueAt: now + 1 * 3600000, status: 'pending' },
      { name: 'compliance', description: 'Check concentration limits, sector exposure, and compliance rules', dueAt: now + 2 * 3600000, status: 'pending' },
      { name: 'size_position', description: 'Calculate position size based on conviction, risk budget, and portfolio context', dueAt: now + 3 * 3600000, status: 'pending' },
      { name: 'crm_entry', description: 'Create CRM deal entry and update pipeline', dueAt: now + 4 * 3600000, status: 'pending' },
      { name: 'execution_track', description: 'Track whether position was actually entered and at what price', dueAt: now + 24 * 3600000, status: 'pending' },
    ];
  },
});

// Risk Remediation Workflow
registerTemplate({
  type: 'risk_remediation',
  description: 'Track flagged risk from detection through resolution',
  createSteps: () => {
    const now = Date.now();
    return [
      { name: 'flag', description: 'Document the risk and recommended remediation', dueAt: now, status: 'pending' },
      { name: 'follow_up_1', description: 'Check if PM addressed the risk, re-alert if not', dueAt: now + 4 * 3600000, status: 'pending' },
      { name: 'follow_up_2', description: 'Second follow-up with escalated urgency', dueAt: now + 24 * 3600000, status: 'pending' },
      { name: 'verify_resolution', description: 'Confirm the risk has been resolved or document why it persists', dueAt: now + 48 * 3600000, status: 'pending' },
    ];
  },
});

// Client Meeting Prep Workflow
registerTemplate({
  type: 'client_meeting_prep',
  description: 'Prepare materials before client meeting, follow up after',
  createSteps: (_symbol, _company, context) => {
    const meetingTime = (context.meetingTime as number) || Date.now() + 24 * 3600000;
    return [
      { name: 'gather_data', description: 'Pull client portfolio performance, attribution, and CRM history', dueAt: meetingTime - 24 * 3600000, status: 'pending' },
      { name: 'draft_talking_points', description: 'Generate personalized talking points and performance summary', dueAt: meetingTime - 4 * 3600000, status: 'pending' },
      { name: 'meeting_reminder', description: 'Send final prep email with key numbers and talking points', dueAt: meetingTime - 1 * 3600000, status: 'pending' },
      { name: 'post_meeting_followup', description: 'Create follow-up tasks and log meeting notes in CRM', dueAt: meetingTime + 2 * 3600000, status: 'pending' },
    ];
  },
});

// ── Workflow Lifecycle ──────────────────────────────────────────────

/**
 * Create a new workflow from a template.
 */
export async function startWorkflow(
  type: string,
  symbol: string,
  company: string,
  context: Record<string, unknown> = {},
  triggeredBy: string = 'manual',
): Promise<Workflow | null> {
  await ensureLoaded();

  const template = templates.get(type);
  if (!template) {
    console.warn(`[Workflows] Unknown template: ${type}`);
    return null;
  }

  // Check if there's already an active workflow of this type for this symbol
  const existing = Array.from(workflows.values()).find(
    wf => wf.type === type && wf.symbol.toUpperCase() === symbol.toUpperCase() && wf.status === 'active'
  );
  if (existing) {
    console.log(`[Workflows] Skipping — active ${type} workflow already exists for ${symbol}: ${existing.id}`);
    return existing;
  }

  wfCounter++;
  const id = `WF-${type.substring(0, 4).toUpperCase()}-${symbol}-${wfCounter}`;
  const steps = template.createSteps(symbol, company, context);

  const workflow: Workflow = {
    id,
    type,
    symbol,
    company,
    status: 'active',
    steps,
    currentStepIndex: 0,
    context,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    triggeredBy,
  };

  workflows.set(id, workflow);
  await persist();
  console.log(`[Workflows] Started ${id}: ${template.description} (${steps.length} steps)`);
  return workflow;
}

/**
 * Execute due steps across all active workflows.
 * Called from the workday execution cycle.
 * Returns step execution functions — the caller provides the actual executors.
 */
export async function processDueSteps(
  executor: (workflow: Workflow, step: WorkflowStep) => Promise<string>,
): Promise<Array<{ workflowId: string; step: string; status: string; output?: string }>> {
  await ensureLoaded();
  const now = Date.now();
  const results: Array<{ workflowId: string; step: string; status: string; output?: string }> = [];

  for (const wf of workflows.values()) {
    if (wf.status !== 'active') continue;

    // Find the current step
    const step = wf.steps[wf.currentStepIndex];
    if (!step || step.status !== 'pending') continue;

    // Check if this step is due
    if (step.dueAt > now) continue;

    // Execute the step
    step.status = 'running';
    wf.updatedAt = now;

    try {
      const output = await executor(wf, step);
      step.status = 'completed';
      step.completedAt = Date.now();
      step.output = output.substring(0, 2000); // Cap output
      wf.currentStepIndex++;
      results.push({ workflowId: wf.id, step: step.name, status: 'completed', output: step.output });

      // Check if workflow is complete
      if (wf.currentStepIndex >= wf.steps.length) {
        wf.status = 'completed';
        wf.completedAt = Date.now();
        console.log(`[Workflows] ${wf.id} completed all ${wf.steps.length} steps`);
      }
    } catch (err) {
      step.status = 'failed';
      step.error = (err as Error).message;
      wf.currentStepIndex++; // Move past failed step
      results.push({ workflowId: wf.id, step: step.name, status: 'failed' });
      console.error(`[Workflows] Step ${step.name} in ${wf.id} failed:`, (err as Error).message);

      // If too many failures, pause the workflow
      const failedCount = wf.steps.filter(s => s.status === 'failed').length;
      if (failedCount >= 2) {
        wf.status = 'paused';
        console.warn(`[Workflows] ${wf.id} paused after ${failedCount} failures`);
      }
    }

    wf.updatedAt = Date.now();
  }

  if (results.length > 0) await persist();
  return results;
}

// ── Query ───────────────────────────────────────────────────────────

export async function getActiveWorkflows(): Promise<Workflow[]> {
  await ensureLoaded();
  return Array.from(workflows.values())
    .filter(wf => wf.status === 'active')
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function getWorkflowsForSymbol(symbol: string): Promise<Workflow[]> {
  await ensureLoaded();
  return Array.from(workflows.values())
    .filter(wf => wf.symbol.toUpperCase() === symbol.toUpperCase())
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  await ensureLoaded();
  return workflows.get(id) || null;
}

export async function getWorkflowSummary(): Promise<{
  active: number;
  completed: number;
  failed: number;
  paused: number;
  byType: Record<string, number>;
  nextDueStep: { workflowId: string; step: string; dueAt: number } | null;
}> {
  await ensureLoaded();
  const all = Array.from(workflows.values());
  const byType: Record<string, number> = {};
  let nextDue: { workflowId: string; step: string; dueAt: number } | null = null;

  for (const wf of all) {
    byType[wf.type] = (byType[wf.type] || 0) + 1;
    if (wf.status === 'active' && wf.steps[wf.currentStepIndex]) {
      const step = wf.steps[wf.currentStepIndex];
      if (!nextDue || step.dueAt < nextDue.dueAt) {
        nextDue = { workflowId: wf.id, step: step.name, dueAt: step.dueAt };
      }
    }
  }

  return {
    active: all.filter(wf => wf.status === 'active').length,
    completed: all.filter(wf => wf.status === 'completed').length,
    failed: all.filter(wf => wf.status === 'failed').length,
    paused: all.filter(wf => wf.status === 'paused').length,
    byType,
    nextDueStep: nextDue,
  };
}

/**
 * Clear all workflows of a given type (or all if no type specified).
 * Returns the count of removed workflows.
 */
export async function clearWorkflows(type?: string): Promise<number> {
  await ensureLoaded();
  let removed = 0;
  for (const [id, wf] of workflows) {
    if (!type || wf.type === type) {
      workflows.delete(id);
      removed++;
    }
  }
  if (removed > 0) {
    await persist();
    console.log(`[Workflows] Cleared ${removed} workflows${type ? ` of type ${type}` : ''}`);
  }
  return removed;
}
