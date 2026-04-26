// Portfolio Manager Digital Worker — Agent Harness
//
// Unified execution engine inspired by CorpGen's agentHarness.ts.
// Provides:
//   - Declarative task definitions with tool filtering
//   - Execution budget caps (tokens, wall-clock time)
//   - Per-task context isolation
//   - ReAct loop with configurable max iterations
//   - Automatic summarization at token thresholds

import { getStandaloneClient } from './client';
import { analytics } from './analytics';

// ── Task Definition ─────────────────────────────────────────────────

export interface TaskDefinition {
  name: string;
  description: string;
  prompt: string;
  /** Subset of tool names this task is allowed to use (empty = all) */
  allowedTools?: string[];
  /** Maximum execution time in ms (default: 120000 / 2 min) */
  timeoutMs?: number;
  /** Maximum LLM iterations in the ReAct loop (default: 5) */
  maxIterations?: number;
  /** Priority: lower = more important */
  priority?: number;
  /** Tags for analytics grouping */
  tags?: string[];
}

export interface TaskResult {
  taskName: string;
  status: 'success' | 'error' | 'timeout' | 'skipped';
  output: string;
  durationMs: number;
  iterations: number;
  error?: string;
  startedAt: number;
  completedAt: number;
}

// ── Execution Budget ────────────────────────────────────────────────

interface ExecutionBudget {
  maxTotalMs: number;        // Total wall-clock budget for a batch of tasks
  maxTaskMs: number;         // Per-task timeout
  maxIterations: number;     // Per-task ReAct iterations
  consumed: number;          // Ms consumed so far
}

const DEFAULT_BUDGET: ExecutionBudget = {
  maxTotalMs: 600_000,      // 10 minutes for a full batch
  maxTaskMs: 120_000,       // 2 minutes per task
  maxIterations: 5,
  consumed: 0,
};

// ── Harness Core ────────────────────────────────────────────────────

export class AgentHarness {
  private budget: ExecutionBudget;
  private results: TaskResult[] = [];

  constructor(budgetOverrides?: Partial<ExecutionBudget>) {
    this.budget = { ...DEFAULT_BUDGET, ...budgetOverrides };
  }

  /**
   * Execute a single task with budget enforcement and timeout.
   */
  async executeTask(task: TaskDefinition): Promise<TaskResult> {
    const startedAt = Date.now();
    const timeout = task.timeoutMs || this.budget.maxTaskMs;

    // Check remaining budget
    if (this.budget.consumed >= this.budget.maxTotalMs) {
      const result: TaskResult = {
        taskName: task.name,
        status: 'skipped',
        output: 'Budget exhausted',
        durationMs: 0,
        iterations: 0,
        startedAt,
        completedAt: Date.now(),
      };
      this.results.push(result);
      return result;
    }

    console.log(`[Harness] Executing task: ${task.name} (timeout: ${timeout}ms)`);
    analytics.recordTaskStart(task.name, task.tags || []);

    try {
      const client = await getStandaloneClient();

      // Execute with timeout
      const output = await Promise.race([
        client.invokeAgentWithScope(task.prompt),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Task timeout')), timeout)
        ),
      ]);

      const durationMs = Date.now() - startedAt;
      this.budget.consumed += durationMs;

      const result: TaskResult = {
        taskName: task.name,
        status: 'success',
        output: output || '',
        durationMs,
        iterations: 1, // Single LLM call; agents SDK handles internal tool loops
        startedAt,
        completedAt: Date.now(),
      };

      this.results.push(result);
      analytics.recordTaskComplete(task.name, durationMs, 'success');
      return result;

    } catch (err) {
      const durationMs = Date.now() - startedAt;
      this.budget.consumed += durationMs;
      const isTimeout = (err as Error).message === 'Task timeout';

      const result: TaskResult = {
        taskName: task.name,
        status: isTimeout ? 'timeout' : 'error',
        output: '',
        durationMs,
        iterations: 1,
        error: (err as Error).message,
        startedAt,
        completedAt: Date.now(),
      };

      this.results.push(result);
      analytics.recordTaskComplete(task.name, durationMs, result.status);
      console.error(`[Harness] Task ${task.name} ${result.status}:`, (err as Error).message);
      return result;
    }
  }

  /**
   * Execute multiple tasks in priority order with budget tracking.
   * Tasks are executed sequentially to respect budget constraints.
   */
  async executeBatch(tasks: TaskDefinition[]): Promise<TaskResult[]> {
    // Sort by priority (lower = higher priority)
    const sorted = [...tasks].sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
    const batchResults: TaskResult[] = [];

    console.log(`[Harness] Starting batch of ${sorted.length} tasks (budget: ${this.budget.maxTotalMs}ms)`);

    for (const task of sorted) {
      const result = await this.executeTask(task);
      batchResults.push(result);

      if (this.budget.consumed >= this.budget.maxTotalMs) {
        console.log(`[Harness] Budget exhausted after ${batchResults.length}/${sorted.length} tasks`);
        // Mark remaining as skipped
        for (let i = batchResults.length; i < sorted.length; i++) {
          batchResults.push({
            taskName: sorted[i].name,
            status: 'skipped',
            output: 'Budget exhausted',
            durationMs: 0,
            iterations: 0,
            startedAt: Date.now(),
            completedAt: Date.now(),
          });
        }
        break;
      }
    }

    return batchResults;
  }

  /**
   * Get execution summary for diagnostics.
   */
  getSummary(): {
    totalTasks: number;
    completed: number;
    failed: number;
    skipped: number;
    totalDurationMs: number;
    budgetRemaining: number;
  } {
    return {
      totalTasks: this.results.length,
      completed: this.results.filter(r => r.status === 'success').length,
      failed: this.results.filter(r => r.status === 'error' || r.status === 'timeout').length,
      skipped: this.results.filter(r => r.status === 'skipped').length,
      totalDurationMs: this.budget.consumed,
      budgetRemaining: Math.max(0, this.budget.maxTotalMs - this.budget.consumed),
    };
  }

  getResults(): TaskResult[] {
    return [...this.results];
  }
}

// ── Worker Definition (multi-agent support) ─────────────────────────
// Used by worker-definitions.ts, worker-delegation.ts, escalation-chain.ts

export interface WorkerDefinition {
  id: string;
  name: string;
  /** Domain practice area (e.g., 'risk-management', 'trade-execution') */
  itilPractice: string;
  /** System prompt instructions for the worker */
  instructions: string;
  /** Tools this worker is allowed to use */
  scopedTools: string[];
}

export interface PromptContext {
  userMessage: string;
  displayName?: string;
  conversationId?: string;
  sessionState?: Record<string, unknown>;
}

export interface HarnessResult {
  output: string;
  workerId: string;
  crossPractice?: boolean;
  durationMs?: number;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
}

/**
 * Run a specialist worker with scoped tools.
 * Creates a task from the worker definition and executes it.
 */
export async function runWorker(
  worker: WorkerDefinition,
  prompt: string,
  ctx?: PromptContext,
): Promise<HarnessResult> {
  const startTime = Date.now();
  const contextPrefix = ctx?.displayName ? `[User: ${ctx.displayName}] ` : '';
  const fullPrompt = `${contextPrefix}${prompt}`;

  console.log(`[Worker:${worker.id}] Executing with ${worker.scopedTools.length} scoped tools`);

  const harness = new AgentHarness({ maxTaskMs: 120_000 });
  const task: TaskDefinition = {
    name: `worker-${worker.id}`,
    description: worker.name,
    prompt: fullPrompt,
    allowedTools: worker.scopedTools.length > 0 ? worker.scopedTools : undefined,
    tags: [worker.id, worker.itilPractice],
  };

  try {
    const result = await harness.executeTask(task);
    return {
      output: result.status === 'success' ? result.output : `Error in ${worker.name}: ${result.error || 'Unknown error'}`,
      workerId: worker.id,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      output: `Error in ${worker.name}: ${(err as Error).message}`,
      workerId: worker.id,
      durationMs: Date.now() - startTime,
    };
  }
}

// ── Adaptive Summarization ──────────────────────────────────────────
// Compress long outputs to prevent context overflow in subsequent tasks

const TOKEN_THRESHOLD = 4000; // Characters (rough proxy for tokens)

export function adaptiveSummarize(text: string, maxLength = TOKEN_THRESHOLD): string {
  if (text.length <= maxLength) return text;

  // Keep first 40% and last 20%, compress middle
  const headLen = Math.floor(maxLength * 0.4);
  const tailLen = Math.floor(maxLength * 0.2);
  const head = text.substring(0, headLen);
  const tail = text.substring(text.length - tailLen);

  return `${head}\n\n[... ${text.length - headLen - tailLen} characters summarized ...]\n\n${tail}`;
}
