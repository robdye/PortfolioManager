// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — Entry point
//
// Starts the Express server for Agent 365 message handling.
// All scheduled tasks are triggered via API endpoints, called by
// external schedulers (Azure Logic Apps, Container App Jobs, etc.).

// IMPORTANT: Load environment variables FIRST
import { configDotenv } from 'dotenv';
import crypto from 'crypto';
configDotenv();

function validateConfiguration(): void {
  const required = [
    'MCP_FINNHUB_ENDPOINT', 'MCP_CRM_ENDPOINT', 'MCP_PORTFOLIO_ENDPOINT',
    'SCHEDULED_SECRET', 'MANAGER_EMAIL'
  ];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[Startup] Missing required environment variables: ${missing.join(', ')}`);
    console.error('[Startup] Application cannot start without required configuration');
    process.exit(1);
  }
}

validateConfiguration();

import { AuthConfiguration, authorizeJWT, CloudAdapter, loadAuthConfigFromEnv, Request } from '@microsoft/agents-hosting';
import express, { Response } from 'express';
import http from 'http';
import path from 'path';
import { DefaultAzureCredential } from '@azure/identity';
import { agentApplication } from './agent';
import { runMorningBriefing } from './morning-briefing';
import { runPortfolioMonitor } from './portfolio-monitor';
import { runFxMonitor } from './fx-monitor';
import { runComplianceDigest } from './compliance-digest';
import { checkEarnings, checkIPOs } from './earnings-tracker';
import { runDecisionEngine, getDecisionState } from './decision-engine';
import { runChallengeMonitor } from './challenge-monitor';
import { runMonthlyCommentary } from './monthly-commentary';
import { runClientEngagement } from './client-engagement';
import { mcpClient } from './mcp-client';
import { attachVoiceWebSocket } from './voice/voiceProxy';
import { isVoiceEnabled } from './voice/voiceGate';
import { analytics } from './analytics';
import { safeCompare, rateLimiter, securityHeaders, sanitizeInput, detectPromptInjection } from './security';
import { toolCache } from './tool-cache';
import { circuitBreaker } from './circuit-breaker';
import { runDayInit, runExecutionCycle, runDayEnd, getWorkdayState } from './workday-loop';
import { getPendingActions, getActionSummary, getAction, getRecentActions, acknowledgeAction, markActed, dismissAction, deferAction, recordOutcome } from './action-tracker';
import { getActiveWorkflows, getWorkflowSummary, getWorkflow, clearWorkflows } from './workflow-engine';

// Keyless auth via managed identity (Azure) or local az login (dev)
export const credential = new DefaultAzureCredential();

// Request deduplication for scheduled tasks
const activeScheduledTasks = new Set<string>();

// Only NODE_ENV=development explicitly disables authentication
const isDevelopment = process.env.NODE_ENV === 'development';
let authConfig: AuthConfiguration = {};
if (!isDevelopment) {
  try {
    authConfig = loadAuthConfigFromEnv();
  } catch (err) {
    console.error('Failed to load auth config from env, continuing with empty config:', err);
  }
}

console.log(`Portfolio Manager Digital Worker`);
console.log(`Environment: NODE_ENV=${process.env.NODE_ENV}, isDevelopment=${isDevelopment}`);

const server = express();
server.use(express.json());

// Security middleware — headers + rate limiting
server.use(securityHeaders);
server.use(rateLimiter);

// Track all requests for analytics
server.use((_req, _res, next) => {
  analytics.recordRequest();
  next();
});

// Structured request logging
server.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  const requestId = crypto.randomUUID();
  const start = Date.now();
  res.setHeader('X-Request-ID', requestId);
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/api/health') {
      console.log(JSON.stringify({
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        timestamp: new Date().toISOString()
      }));
    }
  });
  next();
});

// Health endpoint — no auth required
server.get('/api/health', (_req, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    agent: 'Portfolio Manager Digital Worker',
    timestamp: new Date().toISOString(),
    voiceEnabled: isVoiceEnabled(),
    scheduler: 'API-driven (GET /api/scheduled for endpoints)',
    mcpServers: {
      finnhub: process.env.MCP_FINNHUB_ENDPOINT ? "configured" : "missing",
      portfolio: process.env.MCP_PORTFOLIO_ENDPOINT ? "configured" : "missing",
      crm: process.env.MCP_CRM_ENDPOINT ? "configured" : "missing",
    },
    analytics: analytics.getHealthSummary(),
    workday: getWorkdayState()?.phase || 'idle',
    features: {
      morningBriefing: true,
      portfolioMonitoring: true,
      fxMonitoring: true,
      complianceDigest: true,
      earningsTracking: true,
      decisionEngine: true,
      challengeMonitor: true,
      monthlyCommentary: true,
      workdayLoop: true,
      missionControl: true,
      persistentMemory: true,
      toolCache: true,
      circuitBreaker: true,
      meetingSummaries: true,
      emailNotifications: true,
      voice: true,
      actionTracker: true,
      workflowEngine: true,
      autonomousActions: true,
      escalationLoop: true,
    },
  });
});

// Voice page — served before auth middleware
server.get('/voice', (_req, res: Response) => {
  res.sendFile(path.join(__dirname, 'voice', 'voice.html'));
});

// Scheduled briefing endpoint — protected by SCHEDULED_SECRET, not JWT
// Used by Azure Logic Apps, Container App Jobs, or Azure Functions timer triggers
server.post('/api/scheduled', async (req: express.Request, res: Response) => {
  const secret = req.headers['x-scheduled-secret'] || req.body?.secret;
  if (!secret || secret !== process.env.SCHEDULED_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    console.log('Scheduled briefing triggered via /api/scheduled');
    const result = await runMorningBriefing();
    res.status(200).json({ ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('Scheduled briefing error:', err);
    res.status(500).json({ error: 'Briefing failed', timestamp: new Date().toISOString() });
  }
});

// ── Scheduler API Endpoints ──
// All protected by SCHEDULED_SECRET. Called by external schedulers.

/**
 * Helper to validate the scheduled secret on all scheduler endpoints.
 */
function validateScheduledSecret(req: express.Request, res: Response): boolean {
  const secret = (req.headers['x-scheduled-secret'] || req.body?.secret || '') as string;
  const expected = process.env.SCHEDULED_SECRET || '';
  if (!secret || !expected || !safeCompare(secret, expected)) {
    res.status(401).json({ error: 'Unauthorized — provide x-scheduled-secret header' });
    return false;
  }
  return true;
}

// Morning Briefing — recommended: weekdays 09:00
server.post('/api/scheduled/briefing', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  const taskKey = req.path;
  if (activeScheduledTasks.has(taskKey)) {
    res.status(409).json({ error: 'Task already running', endpoint: taskKey });
    return;
  }
  activeScheduledTasks.add(taskKey);
  try {
    const result = await runMorningBriefing();
    res.status(200).json({ task: 'morning-briefing', ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('[Scheduler] Briefing error:', err);
    res.status(500).json({ task: 'morning-briefing', error: String(err), timestamp: new Date().toISOString() });
  } finally {
    activeScheduledTasks.delete(taskKey);
  }
});

// Portfolio Monitor — recommended: every 5 minutes during market hours
server.post('/api/scheduled/monitor', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  try {
    const result = await runPortfolioMonitor();
    res.status(200).json({ task: 'portfolio-monitor', ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('[Scheduler] Monitor error:', err);
    res.status(500).json({ task: 'portfolio-monitor', error: String(err), timestamp: new Date().toISOString() });
  }
});

// FX Rate Monitor — recommended: every 15 minutes during trading hours
server.post('/api/scheduled/fx', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  try {
    const result = await runFxMonitor();
    res.status(200).json({ task: 'fx-monitor', ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('[Scheduler] FX monitor error:', err);
    res.status(500).json({ task: 'fx-monitor', error: String(err), timestamp: new Date().toISOString() });
  }
});

// Compliance Digest — recommended: weekly Monday 08:00
server.post('/api/scheduled/compliance', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  try {
    const result = await runComplianceDigest();
    res.status(200).json({ task: 'compliance-digest', ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('[Scheduler] Compliance error:', err);
    res.status(500).json({ task: 'compliance-digest', error: String(err), timestamp: new Date().toISOString() });
  }
});

// Earnings Check — recommended: daily 07:00
server.post('/api/scheduled/earnings', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  try {
    // Fetch holdings to cross-reference with earnings calendar
    const holdingsRaw = await mcpClient.getPortfolioHoldings('active') as any;
    let holdings: Array<{ ticker: string; company: string }> = [];
    if (Array.isArray(holdingsRaw)) {
      holdings = holdingsRaw.map((h: any) => ({ ticker: h.Ticker || h.pm_ticker, company: h.Company || h.pm_company }));
    } else if (typeof holdingsRaw === 'string') {
      const match = holdingsRaw.match(/\[[\s\S]*\]/);
      if (match) {
        const arr = JSON.parse(match[0]);
        holdings = arr.filter((h: any) => h.Shares > 0).map((h: any) => ({ ticker: h.Ticker, company: h.Company }));
      }
    }
    await checkEarnings(holdings);
    await checkIPOs();
    res.status(200).json({ task: 'earnings-check', status: 'complete', holdingsChecked: holdings.length, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('[Scheduler] Earnings error:', err);
    res.status(500).json({ task: 'earnings-check', error: String(err), timestamp: new Date().toISOString() });
  }
});

// Decision Engine — recommended: every 30 minutes during market hours
// This is the autonomous brain — replaces scattergun individual monitors
server.post('/api/scheduled/decision', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  const taskKey = req.path;
  if (activeScheduledTasks.has(taskKey)) {
    res.status(409).json({ error: 'Task already running', endpoint: taskKey });
    return;
  }
  activeScheduledTasks.add(taskKey);
  try {
    const result = await runDecisionEngine();
    res.status(200).json({ task: 'decision-engine', ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('[Scheduler] Decision engine error:', err);
    res.status(500).json({ task: 'decision-engine', error: String(err), timestamp: new Date().toISOString() });
  } finally {
    activeScheduledTasks.delete(taskKey);
  }
});

// Decision Engine State — diagnostics endpoint
server.get('/api/scheduled/decision/state', (req: express.Request, res: Response) => {
  res.status(200).json({ task: 'decision-state', ...getDecisionState(), timestamp: new Date().toISOString() });
});

// Challenge Monitor — recommended: weekly Friday 16:00
// Flags positions that warrant review ("why still holding?")
server.post('/api/scheduled/challenge', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  const taskKey = req.path;
  if (activeScheduledTasks.has(taskKey)) {
    res.status(409).json({ error: 'Task already running', endpoint: taskKey });
    return;
  }
  activeScheduledTasks.add(taskKey);
  try {
    const result = await runChallengeMonitor();
    res.status(200).json({ task: 'challenge-monitor', ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('[Scheduler] Challenge monitor error:', err);
    res.status(500).json({ task: 'challenge-monitor', error: String(err), timestamp: new Date().toISOString() });
  } finally {
    activeScheduledTasks.delete(taskKey);
  }
});

// Monthly Commentary — recommended: 1st business day of month
// Generates draft fund commentary for client reports
server.post('/api/scheduled/commentary', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  try {
    const result = await runMonthlyCommentary();
    res.status(200).json({ task: 'monthly-commentary', ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('[Scheduler] Commentary error:', err);
    res.status(500).json({ task: 'monthly-commentary', error: String(err), timestamp: new Date().toISOString() });
  }
});

// Client Engagement — recommended: weekly Monday 10:00
// Scans CRM pipeline, books meetings, creates meeting prep workflows
server.post('/api/scheduled/engagement', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  try {
    const result = await runClientEngagement();
    res.status(200).json({ task: 'client-engagement', ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('[Scheduler] Engagement error:', err);
    res.status(500).json({ task: 'client-engagement', error: String(err), timestamp: new Date().toISOString() });
  }
});

// Cleanup: delete client review calendar events and clear meeting prep workflows
server.post('/api/scheduled/engagement/cleanup', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  try {
    const { deleteCalendarEventsBySubject } = await import('./autonomous-actions');
    const eventsDeleted = await deleteCalendarEventsBySubject('📊 Client Review:');
    const workflowsCleared = await clearWorkflows('client_meeting_prep');
    res.status(200).json({ eventsDeleted, workflowsCleared, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('[Scheduler] Engagement cleanup error:', err);
    res.status(500).json({ error: String(err), timestamp: new Date().toISOString() });
  }
});

// Run ALL scheduled tasks at once — useful for testing
server.post('/api/scheduled/all', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  const results: Record<string, unknown> = {};
  const tasks = ['briefing', 'monitor', 'fx', 'compliance', 'earnings', 'decision', 'challenge'];
  for (const task of tasks) {
    try {
      // Forward to individual handlers by simulating the request
      const taskReq = { ...req, path: `/api/scheduled/${task}` } as express.Request;
      switch (task) {
        case 'briefing': results[task] = await runMorningBriefing(); break;
        case 'monitor': results[task] = await runPortfolioMonitor(); break;
        case 'fx': results[task] = await runFxMonitor(); break;
        case 'compliance': results[task] = await runComplianceDigest(); break;
        case 'decision': results[task] = await runDecisionEngine(); break;
        case 'challenge': results[task] = await runChallengeMonitor(); break;
        case 'earnings': {
          const holdingsRaw = await mcpClient.getPortfolioHoldings('active') as any;
          let holdings: Array<{ ticker: string; company: string }> = [];
          if (Array.isArray(holdingsRaw)) {
            holdings = holdingsRaw.map((h: any) => ({ ticker: h.Ticker || h.pm_ticker, company: h.Company || h.pm_company }));
          }
          await checkEarnings(holdings);
          results[task] = { status: 'complete' };
          break;
        }
      }
    } catch (err: unknown) {
      results[task] = { status: 'error', error: String(err) };
    }
  }
  res.status(200).json({ task: 'all', results, timestamp: new Date().toISOString() });
});

// Scheduler status / list available endpoints
server.get('/api/scheduled', (_req: express.Request, res: Response) => {
  res.status(200).json({
    scheduler: 'API-driven (external scheduler required)',
    endpoints: [
      { path: '/api/scheduled/briefing', method: 'POST', schedule: 'Weekdays 09:00', description: 'Morning briefing email + Teams' },
      { path: '/api/scheduled/monitor', method: 'POST', schedule: 'Every 5 min (market hours)', description: 'Portfolio price alerts' },
      { path: '/api/scheduled/fx', method: 'POST', schedule: 'Every 15 min (trading hours)', description: 'FX rate movement alerts' },
      { path: '/api/scheduled/compliance', method: 'POST', schedule: 'Weekly Monday 08:00', description: 'Compliance digest email + Teams' },
      { path: '/api/scheduled/earnings', method: 'POST', schedule: 'Daily 07:00', description: 'Earnings calendar check + IPOs' },
      { path: '/api/scheduled/decision', method: 'POST', schedule: 'Every 30 min (market hours)', description: 'Autonomous decision engine' },
      { path: '/api/scheduled/challenge', method: 'POST', schedule: 'Weekly Friday 16:00', description: 'Challenge underperformers' },
      { path: '/api/scheduled/commentary', method: 'POST', schedule: '1st business day', description: 'Monthly fund commentary' },
      { path: '/api/scheduled/engagement', method: 'POST', schedule: 'Weekly Monday 10:00', description: 'Auto-book client meetings from CRM pipeline' },
      { path: '/api/scheduled/workday/init', method: 'POST', schedule: 'Weekdays 08:30', description: 'Workday init — morning setup' },
      { path: '/api/scheduled/workday/cycle', method: 'POST', schedule: 'Every 30 min (market hours)', description: 'Workday execution cycle' },
      { path: '/api/scheduled/workday/end', method: 'POST', schedule: 'Weekdays 17:00', description: 'Workday end — reflection' },
      { path: '/api/scheduled/all', method: 'POST', schedule: 'On-demand', description: 'Run all tasks at once' },
    ],
    auth: 'x-scheduled-secret header required on POST endpoints',
  });
});

// ── Workday Loop Endpoints ──

// Workday Init — recommended: weekdays 08:30 (before morning briefing)
server.post('/api/scheduled/workday/init', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  try {
    const result = await runDayInit();
    res.status(200).json({ task: 'workday-init', ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('[Scheduler] Workday init error:', err);
    res.status(500).json({ task: 'workday-init', error: String(err), timestamp: new Date().toISOString() });
  }
});

// Workday Execution Cycle — recommended: every 30 min during market hours
server.post('/api/scheduled/workday/cycle', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  try {
    const result = await runExecutionCycle();
    res.status(200).json({ task: 'workday-cycle', ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('[Scheduler] Workday cycle error:', err);
    res.status(500).json({ task: 'workday-cycle', error: String(err), timestamp: new Date().toISOString() });
  }
});

// Workday End — recommended: weekdays 17:00
server.post('/api/scheduled/workday/end', async (req: express.Request, res: Response) => {
  if (!validateScheduledSecret(req, res)) return;
  try {
    const result = await runDayEnd();
    res.status(200).json({ task: 'workday-end', ...result, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('[Scheduler] Workday end error:', err);
    res.status(500).json({ task: 'workday-end', error: String(err), timestamp: new Date().toISOString() });
  }
});

// Workday state — no auth needed (read-only diagnostic)
server.get('/api/workday/state', (_req: express.Request, res: Response) => {
  const state = getWorkdayState();
  res.status(200).json(state || { phase: 'idle', message: 'No active workday', plannedTasks: [] });
});

// ── Analytics & Observability Endpoints ──

server.get('/api/analytics', (_req: express.Request, res: Response) => {
  res.status(200).json(analytics.getSnapshot());
});

server.get('/api/analytics/cache', (_req: express.Request, res: Response) => {
  res.status(200).json(toolCache.getStats());
});

server.get('/api/analytics/circuits', (_req: express.Request, res: Response) => {
  res.status(200).json(circuitBreaker.getAllStatuses());
});

// ── Action Tracker API ──

server.get('/api/actions', async (_req: express.Request, res: Response) => {
  const pending = await getPendingActions();
  res.status(200).json(pending);
});

server.get('/api/actions/summary', async (_req: express.Request, res: Response) => {
  const summary = await getActionSummary();
  res.status(200).json(summary);
});

server.get('/api/actions/recent', async (req: express.Request, res: Response) => {
  const count = parseInt(req.query.count as string) || 20;
  const recent = await getRecentActions(count);
  res.status(200).json(recent);
});

server.get('/api/actions/:id', async (req: express.Request, res: Response) => {
  const action = await getAction(req.params.id);
  if (!action) { res.status(404).json({ error: 'Action not found' }); return; }
  res.status(200).json(action);
});

server.post('/api/actions/:id/acknowledge', async (req: express.Request, res: Response) => {
  const result = await acknowledgeAction(req.params.id);
  if (!result) { res.status(404).json({ error: 'Action not found' }); return; }
  res.status(200).json(result);
});

server.post('/api/actions/:id/act', async (req: express.Request, res: Response) => {
  const note = req.body?.note || '';
  const result = await markActed(req.params.id, note);
  if (!result) { res.status(404).json({ error: 'Action not found' }); return; }
  res.status(200).json(result);
});

server.post('/api/actions/:id/dismiss', async (req: express.Request, res: Response) => {
  const reason = req.body?.reason || '';
  const result = await dismissAction(req.params.id, reason);
  if (!result) { res.status(404).json({ error: 'Action not found' }); return; }
  res.status(200).json(result);
});

server.post('/api/actions/:id/defer', async (req: express.Request, res: Response) => {
  const hours = req.body?.hours || 24;
  const result = await deferAction(req.params.id, hours);
  if (!result) { res.status(404).json({ error: 'Action not found' }); return; }
  res.status(200).json(result);
});

server.post('/api/actions/:id/outcome', async (req: express.Request, res: Response) => {
  const { outcomeNote, priceAtOutcome } = req.body || {};
  const result = await recordOutcome(req.params.id, outcomeNote, priceAtOutcome);
  if (!result) { res.status(404).json({ error: 'Action not found' }); return; }
  res.status(200).json(result);
});

// ── Workflow API ──

server.get('/api/workflows', async (_req: express.Request, res: Response) => {
  const active = await getActiveWorkflows();
  res.status(200).json(active);
});

server.get('/api/workflows/summary', async (_req: express.Request, res: Response) => {
  const summary = await getWorkflowSummary();
  res.status(200).json(summary);
});

server.get('/api/workflows/:id', async (req: express.Request, res: Response) => {
  const wf = await getWorkflow(req.params.id);
  if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
  res.status(200).json(wf);
});

// ── Mission Control Dashboard ──

server.get('/mission-control', (_req, res: Response) => {
  res.sendFile(path.join(__dirname, 'mission-control.html'));
});

// Apply JWT auth middleware — skip public routes
server.use((req, res, next) => {
  const publicPaths = ['/api/health', '/api/voice/status', '/voice', '/api/scheduled', '/api/analytics', '/api/workday', '/api/actions', '/api/workflows', '/mission-control'];
    // Allow all /api/scheduled/*, /api/analytics/*, /api/workday/*, /api/actions/*, /api/workflows/* paths through
    if (publicPaths.some(p => req.path === p) || req.path.startsWith('/api/scheduled') || req.path.startsWith('/api/analytics') || req.path.startsWith('/api/workday') || req.path.startsWith('/api/actions') || req.path.startsWith('/api/workflows') || req.path === '/mission-control') {
    return next();
  }
  return authorizeJWT(authConfig)(req, res, next);
});

// Agent 365 messaging endpoint — receives activities from Teams, Outlook, etc.
server.post('/api/messages', (req: Request, res: Response) => {
  const adapter = agentApplication.adapter as CloudAdapter;
  adapter.process(req, res, async (context) => {
    await agentApplication.run(context);
  });
});

// Agent-to-Agent (A2A) messages endpoint — same processing, separate logging
server.post('/api/agent-messages', (req: Request, res: Response) => {
  console.log('A2A message received from:', req.headers['x-agent-id'] || 'unknown-agent');
  const adapter = agentApplication.adapter as CloudAdapter;
  adapter.process(req, res, async (context) => {
    await agentApplication.run(context);
  });
});

const port = Number(process.env.PORT) || 3978;
const host = process.env.HOST ?? (isDevelopment ? 'localhost' : '0.0.0.0');

// Create raw HTTP server for WebSocket support (voice)
const httpServer = http.createServer((req, res) => {
  // Voice gate status — bypasses all Express middleware
  if (req.method === 'GET' && (req.url === '/api/voice/status' || req.url?.startsWith('/api/voice/status?'))) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ enabled: isVoiceEnabled() }));
    return;
  }
  // Everything else goes through Express
  server(req, res);
});

httpServer.listen(port, host, async () => {
  console.log(`\n  Portfolio Manager Digital Worker listening on ${host}:${port}`);
  console.log(`  Health:          http://${host}:${port}/api/health`);
  console.log(`  Messages:        http://${host}:${port}/api/messages`);
  console.log(`  A2A:             http://${host}:${port}/api/agent-messages`);
  console.log(`  Scheduler:       http://${host}:${port}/api/scheduled`);
  console.log(`  Mission Control: http://${host}:${port}/mission-control`);
  console.log(`  Analytics:       http://${host}:${port}/api/analytics`);
  console.log(`  Workday:         http://${host}:${port}/api/workday/state`);
  console.log(`  Voice:           http://${host}:${port}/voice`);
  console.log(`  Auth: ${authConfig.clientId || 'disabled (development mode)'}`);

  // Attach Voice Live WebSocket proxy
  attachVoiceWebSocket(httpServer);

  // All scheduled tasks are driven by external API calls — no in-process cron/timers.
  // See GET /api/scheduled for available endpoints and recommended schedules.
  console.log('\n  Scheduler endpoints available at /api/scheduled');
  console.log('  Portfolio Manager Digital Worker is ready!\n');

  // Pre-warm managed identity token to avoid first-message IMDS cold-start delay (~60s)
  if (!isDevelopment) {
    credential.getToken('https://cognitiveservices.azure.com/.default')
      .then(() => console.log('  Managed identity token pre-warmed successfully'))
      .catch((err: unknown) => console.warn('  Token pre-warm failed (will retry on first message):', err));
  }
}).on('error', (err: unknown) => {
  console.error('Server error:', err);
  process.exit(1);
});

function gracefulShutdown(signal: string) {
  console.log(`[Worker] ${signal} received — shutting down gracefully...`);
  httpServer.close(() => {
    console.log('[Worker] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[Worker] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
