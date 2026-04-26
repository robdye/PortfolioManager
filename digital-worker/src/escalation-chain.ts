// Portfolio Manager — Escalation Chain
// Auto-escalates when workers fail, timeout, or decisions stall.
// Chain: Worker → Command Center → Human (Teams + Email)

import { runWorker, type PromptContext, type HarnessResult } from './agent-harness';
import { workerMap, commandCenter } from './worker-definitions';

// ── Escalation Levels ──

export type EscalationLevel = 'worker' | 'command-center' | 'human';

export interface EscalationEvent {
  id: string;
  originalWorkerId: string;
  currentLevel: EscalationLevel;
  reason: string;
  context: string;
  attempts: number;
  timestamp: Date;
  resolution?: string;
}

// ── Config ──

const MAX_WORKER_RETRIES = 2;

// ── In-memory escalation log ──

const escalationLog: EscalationEvent[] = [];
export const MAX_ESCALATION_LOG = 500;

export function getEscalationLog(): EscalationEvent[] {
  return [...escalationLog];
}

export function getActiveEscalations(): EscalationEvent[] {
  return escalationLog.filter(e => !e.resolution);
}

// ── Core Escalation Logic ──

export async function executeWithEscalation(
  workerId: string,
  prompt: string,
  ctx?: PromptContext,
): Promise<HarnessResult & { escalated: boolean; escalationLevel: EscalationLevel }> {
  const worker = workerMap.get(workerId);
  if (!worker) {
    throw new Error(`Unknown worker: ${workerId}`);
  }

  const escalationId = `esc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  let attempts = 0;

  // Level 1: Try the worker directly
  while (attempts < MAX_WORKER_RETRIES) {
    attempts++;
    try {
      const result = await runWorker(worker, prompt, ctx);
      if (!result.output.startsWith('Error in ')) {
        return { ...result, escalated: false, escalationLevel: 'worker' };
      }
      console.warn(`[Escalation] Worker ${workerId} returned error (attempt ${attempts}/${MAX_WORKER_RETRIES})`);
    } catch (err) {
      console.warn(`[Escalation] Worker ${workerId} threw (attempt ${attempts}/${MAX_WORKER_RETRIES}):`, err);
    }
  }

  // Level 2: Escalate to Command Center
  console.log(`[Escalation] ${workerId} failed after ${MAX_WORKER_RETRIES} attempts → Command Center`);

  const escalationEvent: EscalationEvent = {
    id: escalationId,
    originalWorkerId: workerId,
    currentLevel: 'command-center',
    reason: `Worker ${workerId} failed after ${MAX_WORKER_RETRIES} attempts`,
    context: prompt.substring(0, 500),
    attempts,
    timestamp: new Date(),
  };
  escalationLog.push(escalationEvent);
  if (escalationLog.length > MAX_ESCALATION_LOG) escalationLog.shift();

  try {
    const ccPrompt = `[ESCALATION from ${worker.name}]\n\nThe ${worker.name} worker failed to handle this request after ${MAX_WORKER_RETRIES} attempts.\n\nOriginal request: ${prompt}\n\nPlease handle this or escalate to the PM.`;
    const ccResult = await runWorker(commandCenter, ccPrompt, ctx);

    if (!ccResult.output.startsWith('Error in ')) {
      escalationEvent.resolution = 'Handled by Command Center';
      return { ...ccResult, escalated: true, escalationLevel: 'command-center' };
    }
  } catch (err) {
    console.error('[Escalation] Command Center also failed:', err);
  }

  // Level 3: Escalate to human
  console.log(`[Escalation] Command Center also failed → Human escalation`);
  escalationEvent.currentLevel = 'human';

  const humanMessage = `🚨 **Human Escalation Required**\n\n` +
    `**Escalation ID**: ${escalationEvent.id}\n` +
    `**Original Worker**: ${escalationEvent.originalWorkerId}\n` +
    `**Reason**: ${escalationEvent.reason}\n` +
    `**Attempts**: ${escalationEvent.attempts} worker + 1 Command Center\n` +
    `**Timestamp**: ${escalationEvent.timestamp.toISOString()}\n\n` +
    `**Original Request**:\n${prompt.substring(0, 500)}\n\n` +
    `This request could not be handled automatically. Please review and take manual action.`;

  return {
    output: humanMessage,
    workerId: 'escalation-chain',
    crossPractice: true,
    escalated: true,
    escalationLevel: 'human',
  };
}

export function createStaleDecisionEscalation(
  signalType: string,
  workerId: string,
  hoursSinceDetection: number,
): EscalationEvent {
  const event: EscalationEvent = {
    id: `esc-stale-${Date.now()}`,
    originalWorkerId: workerId,
    currentLevel: hoursSinceDetection > 4 ? 'human' : 'command-center',
    reason: `Signal "${signalType}" has had no action for ${hoursSinceDetection} hours`,
    context: `Stale signal: ${signalType}`,
    attempts: 0,
    timestamp: new Date(),
  };
  escalationLog.push(event);
  if (escalationLog.length > MAX_ESCALATION_LOG) escalationLog.shift();
  return event;
}
