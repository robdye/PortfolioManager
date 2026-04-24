// Portfolio Manager Digital Worker — Portfolio Workday Loop
//
// Inspired by CorpGen's workday orchestration:
//   Day Init → Execution Cycles → Day End
//
// This replaces individual scheduled tasks with a cohesive workday
// that the digital worker "lives through" — thinking about what it
// did, what it learned, and what to watch for tomorrow.
//
// Triggered via /api/scheduled/workday — replaces /api/scheduled/all

import { AgentHarness, TaskDefinition, TaskResult } from './agent-harness';
import { saveMemory, loadMemory, saveDecisionState, getEffectivenessStats } from './persistent-memory';
import { analytics } from './analytics';
import { runDecisionEngine } from './decision-engine';
import { postToChannel } from './teams-channel';
import { sendEmail } from './email-service';
import { checkEscalations, getPendingActions, getActionSummary } from './action-tracker';
import { processDueSteps, getActiveWorkflows, getWorkflowSummary } from './workflow-engine';
import { sendFollowUp } from './autonomous-actions';
import { mcpClient } from './mcp-client';
import { getStandaloneClient } from './client';

const MANAGER_EMAIL = process.env.MANAGER_EMAIL || '';

// ── Workday State ───────────────────────────────────────────────────

export interface PlannedTask {
  id: string;
  name: string;
  description: string;
  scheduledTime: string;   // e.g. '08:30', '09:00', '*/30'
  phase: 'morning' | 'market-hours' | 'end-of-day';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  output?: string;         // truncated summary of what was found/done
}

export interface WorkdayState {
  date: string; // YYYY-MM-DD
  phase: 'init' | 'executing' | 'winding_down' | 'ended';
  cycleCount: number;
  startedAt: number;
  endedAt?: number;
  keyFindings: string[];
  alertsSent: number;
  tasksCompleted: number;
  tasksFailed: number;
  plannedTasks: PlannedTask[];
}

let currentWorkday: WorkdayState | null = null;

// ── Day Plan Template ────────────────────────────────────────────────
// Defines the planned workday tasks (populated at day init)

function buildDailyPlan(today: string): PlannedTask[] {
  return [
    {
      id: 'rv-scan',
      name: 'Relative Value Scan',
      description: 'What RV has shifted overnight? Which holdings are now expensive vs cheap relative to peers and analyst targets.',
      scheduledTime: '08:30',
      phase: 'morning',
      status: 'pending',
    },
    {
      id: 'challenge-holdings',
      name: 'Challenge My Holdings',
      description: 'For each holding: why are you still holding this? Is it still cheap, does the analyst view still support it?',
      scheduledTime: '08:35',
      phase: 'morning',
      status: 'pending',
    },
    {
      id: 'story-changes',
      name: 'Investment Story Changes',
      description: 'What has changed in the investment thesis overnight? Analyst upgrades/downgrades, corporate actions, sector rotation.',
      scheduledTime: '08:40',
      phase: 'morning',
      status: 'pending',
    },
    {
      id: 'morning-briefing',
      name: 'Morning Briefing',
      description: 'Synthesize all morning analysis into a compressed briefing. Lead with changes, not levels.',
      scheduledTime: '09:00',
      phase: 'morning',
      status: 'pending',
    },
    {
      id: 'execution-cycle',
      name: 'Market Hours Monitoring',
      description: 'Continuous 30-min cycles: detect RV shifts, price breaks, analyst changes, escalate stale recommendations.',
      scheduledTime: '*/30 9-16',
      phase: 'market-hours',
      status: 'pending',
    },
    {
      id: 'workflow-processing',
      name: 'Workflow Step Processing',
      description: 'Execute pending workflow steps: earnings prep, position entry analysis, risk remediation, client meeting prep.',
      scheduledTime: '*/30 9-16',
      phase: 'market-hours',
      status: 'pending',
    },
    {
      id: 'escalation-check',
      name: 'Escalation Review',
      description: 'Chase stale recommendations the PM hasn\'t acted on. Escalate with updated pricing if thesis still holds.',
      scheduledTime: '*/30 9-16',
      phase: 'market-hours',
      status: 'pending',
    },
    {
      id: 'eod-reflection',
      name: 'End of Day Reflection',
      description: 'What changed today? What actions were taken? What needs attention tomorrow? Build tomorrow\'s focus list.',
      scheduledTime: '17:00',
      phase: 'end-of-day',
      status: 'pending',
    },
  ];
}

// ── Day Init ────────────────────────────────────────────────────────
// Morning startup: load state, review yesterday, set today's priorities

export async function runDayInit(): Promise<WorkdayState> {
  const today = new Date().toISOString().split('T')[0];

  // Load yesterday's reflection if available
  const yesterday = await loadMemory('workday', 'latest_reflection');
  const yesterdayReflection = yesterday ? (yesterday as any).reflection || '' : '';

  currentWorkday = {
    date: today,
    phase: 'init',
    cycleCount: 0,
    startedAt: Date.now(),
    keyFindings: [],
    alertsSent: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    plannedTasks: buildDailyPlan(today),
  };

  // Helper to update a planned task status
  const updateTask = (id: string, status: PlannedTask['status'], output?: string) => {
    const task = currentWorkday!.plannedTasks.find(t => t.id === id);
    if (task) {
      task.status = status;
      if (status === 'running') task.startedAt = Date.now();
      if (status === 'completed' || status === 'failed') task.completedAt = Date.now();
      if (output) task.output = output.substring(0, 300);
    }
  };

  // ── Morning Task 1: Relative Value Scan ──
  // "What relative value has changed? What is now expensive?" — Luke's #1 feedback
  const morningTasks: TaskDefinition[] = [
    {
      name: 'rv-scan',
      description: 'Scan for relative value changes across the portfolio',
      prompt: `It's ${today}. Run a relative value scan across the portfolio.

DO NOT show me static portfolio data. Focus ONLY on what has CHANGED:
1. Which holdings have gotten more expensive (PE expanding, spread tightening)?
2. Which holdings have gotten cheaper (PE contracting, spread widening)?
3. Are any holdings now trading rich vs their sector peers or analyst targets?
4. Are there positions we DON'T own that are now cheap and analysts are recommending?

For each finding, give: Ticker, direction of RV shift, and WHY it matters.
${yesterdayReflection ? `\nYesterday's reflection: ${yesterdayReflection}` : ''}`,
      priority: 1,
      tags: ['morning', 'rv'],
      timeoutMs: 120_000,
    },
    {
      name: 'challenge-holdings',
      description: 'Challenge every position — why are we still holding this?',
      prompt: `It's ${today}. Challenge every position in the portfolio.

For each holding, answer: "Why are you still holding this?"
- Is it still cheap relative to peers? If not, flag it.
- Does the analyst consensus still support holding? If it's shifted to Hold/Sell, flag it.
- Has the investment story changed? New management, sector rotation, earnings miss?
- Any positions that are now expensive with no catalyst for further upside?

Output a short table: Ticker | Verdict (HOLD/REVIEW/TRIM) | One-line reason.
Only include holdings where the verdict is REVIEW or TRIM in detail.`,
      priority: 1,
      tags: ['morning', 'challenge'],
      timeoutMs: 120_000,
    },
    {
      name: 'story-changes',
      description: 'Detect investment story changes overnight',
      prompt: `It's ${today}. What has changed in the investment landscape overnight?

Focus on STORY CHANGES — things that shift the thesis:
1. Analyst upgrades or downgrades on our holdings
2. Earnings surprises (beats/misses) on holdings or peers
3. Corporate actions (M&A, buybacks, management changes)
4. Sector rotation signals (money flowing in/out of sectors we're exposed to)
5. Macro events that change the relative attractiveness of our holdings

Be specific with ticker symbols. Lead with the 3 most impactful changes.
Skip anything that's just normal market noise.`,
      priority: 2,
      tags: ['morning', 'story'],
      timeoutMs: 120_000,
    },
    {
      name: 'morning-briefing',
      description: 'Synthesize morning analysis into compressed briefing',
      prompt: `It's ${today}. Generate the morning briefing.

RULES:
- Lead with CHANGES, not static data. The PM already knows their portfolio.
- Don't list what's up and down. Tell me what has SHIFTED and what needs attention.
- Compress — give me the 3-5 things I actually need to act on today.
- If a position is challenged, say so directly. Don't hedge.
- Include any upcoming earnings or catalysts for this week.
${yesterdayReflection ? `\nYesterday's reflection for continuity: ${yesterdayReflection}` : ''}`,
      priority: 3,
      tags: ['morning', 'briefing'],
      timeoutMs: 180_000,
    },
  ];

  const harness = new AgentHarness({ maxTotalMs: 600_000 }); // 10 min budget for morning

  // Mark tasks as running
  for (const t of morningTasks) {
    updateTask(t.name, 'running');
  }

  const results = await harness.executeBatch(morningTasks);

  for (const r of results) {
    if (r.status === 'success') {
      currentWorkday.tasksCompleted++;
      updateTask(r.taskName, 'completed', r.output);
      if (r.output.length > 50) currentWorkday.keyFindings.push(`[${r.taskName}] ${r.output.substring(0, 200)}`);
    } else {
      currentWorkday.tasksFailed++;
      updateTask(r.taskName, 'failed', r.error);
    }
  }

  currentWorkday.phase = 'executing';

  // Persist workday state
  await saveMemory('workday', 'current', currentWorkday as unknown as Record<string, unknown>);

  console.log(`[Workday] Day initialized: ${today}. ${results.length} morning tasks complete.`);
  return currentWorkday;
}

// ── Execution Cycle ─────────────────────────────────────────────────
// Runs every 30 minutes during market hours. Each cycle:
// 1. Runs the decision engine
// 2. Checks if any context-dependent tasks need attention
// 3. Learns from what it finds

export async function runExecutionCycle(): Promise<{
  cycle: number;
  signals: number;
  actions: number;
  duration: number;
}> {
  if (!currentWorkday) {
    // Auto-init if workday not started
    await runDayInit();
  }

  currentWorkday!.cycleCount++;
  const cycleNum = currentWorkday!.cycleCount;
  const cycleStart = Date.now();

  console.log(`[Workday] Execution cycle #${cycleNum} starting...`);

  // Update planned task statuses for market-hours tasks
  const updatePlannedTask = (id: string, status: PlannedTask['status'], output?: string) => {
    const task = currentWorkday!.plannedTasks.find(t => t.id === id);
    if (task) {
      task.status = status;
      if (status === 'running' && !task.startedAt) task.startedAt = Date.now();
      if (status === 'completed' || status === 'failed') task.completedAt = Date.now();
      if (output) task.output = output.substring(0, 300);
    }
  };

  updatePlannedTask('execution-cycle', 'running');

  // Run decision engine (core intelligence)
  let decisionResult: any = {};
  try {
    decisionResult = await runDecisionEngine();
  } catch (err) {
    console.error(`[Workday] Decision engine error in cycle #${cycleNum}:`, (err as Error).message);
  }

  const signalsDetected = decisionResult.signalsDetected || 0;
  const actionsCount = decisionResult.alertsSent || 0;

  // ── Escalation Check: follow up on stale recommendations ──
  let escalationsHandled = 0;
  try {
    const escalated = await checkEscalations();
    for (const action of escalated) {
      // Get current price for comparison
      let currentPrice: number | undefined;
      try {
        const quote = await mcpClient.getQuote(action.symbol) as any;
        currentPrice = quote?.c;
      } catch { /* skip */ }

      await sendFollowUp({
        actionId: action.id,
        symbol: action.symbol,
        originalRecommendation: action.recommendation,
        escalationLevel: action.escalationCount,
        currentPrice,
        priceAtRecommendation: action.priceAtCreation,
      });
      escalationsHandled++;
    }
  } catch (err) {
    console.warn(`[Workday] Escalation check failed:`, (err as Error).message);
  }

  // ── Process Workflow Steps: execute any due steps ──
  let workflowStepsCompleted = 0;
  try {
    const stepResults = await processDueSteps(async (workflow, step) => {
      // Use LLM to execute each workflow step with full context
      const client = await getStandaloneClient();
      const prompt = `You are executing step "${step.name}" of the ${workflow.type} workflow for ${workflow.symbol} (${workflow.company}).

STEP DESCRIPTION: ${step.description}

WORKFLOW CONTEXT:
${JSON.stringify(workflow.context, null, 2)}

PREVIOUS STEPS:
${workflow.steps.filter(s => s.status === 'completed').map(s => `- ${s.name}: ${s.output?.substring(0, 200) || 'completed'}`).join('\n') || 'None yet'}

Execute this step. Use your tools to gather data, perform analysis, and take concrete actions. Be specific with numbers and recommendations. Write as "I" — you are the digital worker.`;

      const result = (await client.invokeAgentWithScope(prompt)) || 'Step completed';

      // Generate PowerPoint for client meeting prep talking points step
      if (workflow.type === 'client_meeting_prep' && step.name === 'draft_talking_points') {
        try {
          const { generateMeetingPptx } = await import('./doc-generator');
          const { sendEmail } = await import('./email-service');
          const { mcpClient } = await import('./mcp-client');

          // Gather holdings data for the deck
          let holdingsData: any[] = [];
          try {
            const raw = await mcpClient.getPortfolioHoldings();
            const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw);
            const match = rawStr.match(/\[[\s\S]*\]/);
            if (match) holdingsData = JSON.parse(match[0]);
          } catch { /* continue without */ }

          const deckHoldings = holdingsData
            .filter((h: any) => (h.Shares || 0) > 0)
            .slice(0, 8)
            .map((h: any) => ({
              ticker: h.Ticker || '', company: h.Company || h.Ticker || '',
              shares: h.Shares || 0, value: h.Value || 0,
              weight: h.Weight || 0, return5d: h.Return5d || h.return5d || 0,
            }));

          const clientName = workflow.company || workflow.symbol;
          const crmHistory = workflow.steps.find(s => s.name === 'gather_data')?.output || '';

          const pptxBuf = await generateMeetingPptx(clientName, result, deckHoldings, crmHistory);
          console.log(`[Workday] Generated meeting prep .pptx (${(pptxBuf.length / 1024).toFixed(0)} KB)`);

          const managerEmail = process.env.MANAGER_EMAIL || '';
          if (managerEmail) {
            await sendEmail({
              to: managerEmail,
              subject: `📊 Client Meeting Prep — ${clientName}`,
              body: `<p>Meeting prep deck for <strong>${clientName}</strong> is attached. Talking points generated from portfolio and CRM data.</p><p style="font-size:12px;color:#999">Generated by your Digital Worker</p>`,
              isHtml: true,
              attachments: [{
                name: `Meeting-Prep-${clientName.replace(/\s+/g, '-')}.pptx`,
                contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                content: pptxBuf,
              }],
            });
          }
        } catch (err) {
          console.warn('[Workday] Meeting prep PowerPoint generation failed:', (err as Error).message);
        }
      }

      return result;
    });

    workflowStepsCompleted = stepResults.filter(r => r.status === 'completed').length;
    if (stepResults.length > 0) {
      console.log(`[Workday] Processed ${stepResults.length} workflow steps (${workflowStepsCompleted} completed)`);
    }
  } catch (err) {
    console.warn(`[Workday] Workflow processing failed:`, (err as Error).message);
  }

  // Record analytics
  const signalsByType: Record<string, number> = {};
  if (decisionResult.signals) {
    for (const s of decisionResult.signals) {
      signalsByType[s.type] = (signalsByType[s.type] || 0) + 1;
    }
  }
  analytics.recordDecisionRun(signalsDetected, actionsCount, decisionResult.suppressed || 0, signalsByType);

  // Update workday state
  if (signalsDetected > 0) {
    currentWorkday!.keyFindings.push(`Cycle #${cycleNum}: ${signalsDetected} signals, ${actionsCount} alerts`);
    currentWorkday!.alertsSent += actionsCount;
  }
  if (escalationsHandled > 0) {
    currentWorkday!.keyFindings.push(`Cycle #${cycleNum}: ${escalationsHandled} stale recommendations escalated`);
    updatePlannedTask('escalation-check', 'completed', `${escalationsHandled} escalations sent`);
  }
  if (workflowStepsCompleted > 0) {
    currentWorkday!.keyFindings.push(`Cycle #${cycleNum}: ${workflowStepsCompleted} workflow steps executed`);
    updatePlannedTask('workflow-processing', 'completed', `${workflowStepsCompleted} steps done`);
  }

  // Mark execution-cycle as completed for this cycle
  updatePlannedTask('execution-cycle', 'completed',
    `Cycle #${cycleNum}: ${signalsDetected} signals, ${actionsCount} alerts, ${escalationsHandled} escalations, ${workflowStepsCompleted} workflow steps`);

  // Persist
  await saveMemory('workday', 'current', currentWorkday as unknown as Record<string, unknown>);

  const duration = Date.now() - cycleStart;
  return { cycle: cycleNum, signals: signalsDetected, actions: actionsCount, duration };
}

// ── Day End ─────────────────────────────────────────────────────────
// End-of-day reflection: summarize what happened, what to watch tomorrow

export async function runDayEnd(): Promise<{
  reflection: string;
  stats: Record<string, unknown>;
}> {
  if (!currentWorkday) {
    return { reflection: 'No active workday to end.', stats: {} };
  }

  currentWorkday.phase = 'winding_down';
  const today = currentWorkday.date;

  // Mark eod-reflection as running
  const eodTask = currentWorkday.plannedTasks.find(t => t.id === 'eod-reflection');
  if (eodTask) { eodTask.status = 'running'; eodTask.startedAt = Date.now(); }

  // Get effectiveness stats
  const effectiveness = getEffectivenessStats();
  const actionStats = await getActionSummary();
  const workflowStats = await getWorkflowSummary();
  const pendingActions = await getPendingActions();

  // Generate end-of-day reflection
  const harness = new AgentHarness({ maxTotalMs: 180_000 }); // 3 min budget
  const reflectionResult = await harness.executeTask({
    name: 'day-end-reflection',
    description: 'End-of-day reflection and tomorrow prep',
    prompt: `It's end of day (${today}). Reflect on today's portfolio activity.

TODAY'S SUMMARY:
- Execution cycles: ${currentWorkday.cycleCount}
- Tasks completed: ${currentWorkday.tasksCompleted}
- Tasks failed: ${currentWorkday.tasksFailed}
- Alerts sent: ${currentWorkday.alertsSent}
- Key findings: ${currentWorkday.keyFindings.join('; ')}

ACTION TRACKER:
- Total tracked: ${actionStats.total} | Open: ${actionStats.open} | Acted: ${actionStats.acted} | Dismissed: ${actionStats.dismissed}
- Escalated today: ${actionStats.escalated} | Hit rate: ${actionStats.hitRate.toFixed(0)}%
- Avg time to act: ${actionStats.avgTimeToActMs > 0 ? `${(actionStats.avgTimeToActMs / 3600000).toFixed(1)}h` : 'N/A'}

ACTIVE WORKFLOWS:
- Active: ${workflowStats.active} | Completed: ${workflowStats.completed} | By type: ${JSON.stringify(workflowStats.byType)}
${workflowStats.nextDueStep ? `- Next due step: ${workflowStats.nextDueStep.step} in ${workflowStats.nextDueStep.workflowId}` : ''}

PENDING ACTIONS REQUIRING PM ATTENTION:
${pendingActions.slice(0, 5).map(a => `- [${a.severity.toUpperCase()}] ${a.symbol}: ${a.recommendation} (${a.status}, ${a.escalationCount} escalations)`).join('\n') || 'None'}

EFFECTIVENESS: ${JSON.stringify(effectiveness)}

Write a 3-4 paragraph end-of-day reflection covering:
1. What the key portfolio movements were today
2. What actions you took autonomously (calendar events, CRM updates, workflow steps)
3. What recommendations are still pending and need PM attention tomorrow
4. Specific tasks for tomorrow (e.g., "follow up on MSFT trim recommendation", "check AAPL post-earnings")

Write as "I" — you are the digital worker reflecting on your own day. Be concrete about what you DID, not just what you observed.`,
    priority: 1,
    tags: ['eod', 'reflection'],
    timeoutMs: 120_000,
  });

  const reflection = reflectionResult.output || 'End-of-day reflection unavailable.';

  // Mark eod-reflection as completed
  if (eodTask) {
    eodTask.status = reflectionResult.status === 'success' ? 'completed' : 'failed';
    eodTask.completedAt = Date.now();
    eodTask.output = reflection.substring(0, 300);
  }

  // Save reflection for tomorrow's morning init
  await saveMemory('workday', 'latest_reflection', {
    date: today,
    reflection,
    stats: {
      cycles: currentWorkday.cycleCount,
      alertsSent: currentWorkday.alertsSent,
      findings: currentWorkday.keyFindings.length,
      effectiveness: effectiveness.rate,
    },
  });

  // Send EOD summary email
  try {
    if (MANAGER_EMAIL) {
      await sendEmail({
        to: MANAGER_EMAIL,
        subject: `📊 End of Day Summary — ${today}`,
        body: reflection,
        isHtml: false,
      });
    }
  } catch (err) {
    console.warn('[Workday] Failed to send EOD email:', (err as Error).message);
  }

  // Post to Teams
  try {
    await postToChannel(`**End of Day — ${today}**\n\n${reflection.substring(0, 1500)}`, false);
  } catch (err) {
    console.warn('[Workday] Failed to post EOD to Teams:', (err as Error).message);
  }

  currentWorkday.phase = 'ended';
  currentWorkday.endedAt = Date.now();

  // Archive today's workday
  await saveMemory('workday', `archive_${today}`, currentWorkday as unknown as Record<string, unknown>);
  currentWorkday = null;

  return {
    reflection,
    stats: {
      date: today,
      cycles: currentWorkday ? 0 : 0,
      effectiveness: effectiveness.rate,
    },
  };
}

// ── Workday Status ──────────────────────────────────────────────────

export function getWorkdayState(): WorkdayState | null {
  return currentWorkday;
}
