/**
 * Portfolio Manager — Computer Use Agent (CUA)
 * Drives Bloomberg terminals, broker portals, and fund-admin web apps
 * where no API exists. Governed by Purview audit trail.
 */

// ── Types ──

export type TargetApp = 'bloomberg' | 'broker-portal' | 'fund-admin' | 'custodian' | 'custom';

export interface CUASession {
  sessionId: string;
  targetApp: TargetApp;
  status: 'active' | 'paused' | 'completed' | 'failed';
  startedAt: Date;
  actions: CUAAction[];
  screenshotCount: number;
}

export interface CUAAction {
  type: 'click' | 'type' | 'scroll' | 'screenshot' | 'wait' | 'navigate' | 'read';
  target?: string;
  value?: string;
  timestamp: Date;
  result?: string;
  screenshot?: string; // base64
}

export interface CUAConfig {
  targetApp: TargetApp;
  targetUrl: string;
  task: string;
  maxActions?: number;
  timeoutMs?: number;
  requireApproval?: boolean;
}

// ── Session Management ──

const activeSessions = new Map<string, CUASession>();

export function createSession(config: CUAConfig): CUASession {
  const session: CUASession = {
    sessionId: `cua-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    targetApp: config.targetApp,
    status: 'active',
    startedAt: new Date(),
    actions: [],
    screenshotCount: 0,
  };

  activeSessions.set(session.sessionId, session);
  console.log(`[CUA] Session created: ${session.sessionId} for ${config.targetApp}`);
  return session;
}

// ── Action Execution ──
// In production this delegates to Azure AI Foundry's Computer Use API.
// For demo, we simulate the action pipeline.

export async function executeAction(sessionId: string, action: CUAAction): Promise<CUAAction> {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.status !== 'active') throw new Error(`Session ${sessionId} is ${session.status}`);

  const endpoint = process.env.FOUNDRY_CUA_ENDPOINT;

  if (endpoint) {
    // Real CUA execution via Azure AI Foundry
    try {
      const response = await fetch(`${endpoint}/sessions/${sessionId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.FOUNDRY_CUA_KEY}` },
        body: JSON.stringify(action),
      });

      if (!response.ok) throw new Error(`CUA API error: ${response.status}`);
      const result = await response.json() as Record<string, unknown>;
      action.result = result.output as string;
      if (result.screenshot) {
        action.screenshot = result.screenshot as string;
        session.screenshotCount++;
      }
    } catch (err) {
      action.result = `CUA execution failed: ${(err as Error).message}`;
    }
  } else {
    // Simulated execution for demo
    action.result = simulateAction(session.targetApp, action);
  }

  action.timestamp = new Date();
  session.actions.push(action);
  console.log(`[CUA:${sessionId}] ${action.type} ${action.target || ''} → ${action.result?.substring(0, 80) || 'ok'}`);
  return action;
}

function simulateAction(app: TargetApp, action: CUAAction): string {
  const simulations: Record<TargetApp, Record<string, string>> = {
    bloomberg: {
      click: 'Clicked Bloomberg terminal element',
      type: `Typed "${action.value}" into Bloomberg command line`,
      read: 'Read Bloomberg panel: AAPL US Equity — Last: 198.45 Chg: +2.12 (+1.08%)',
      navigate: `Navigated to Bloomberg function: ${action.target}`,
      screenshot: 'Captured Bloomberg terminal screenshot',
    },
    'broker-portal': {
      click: 'Clicked broker portal element',
      type: `Entered "${action.value}" in broker form field`,
      read: 'Read trade confirmation: Order #BR-2025-0412 FILLED — 500 MSFT @ $421.30',
      navigate: `Navigated to broker page: ${action.target}`,
      screenshot: 'Captured broker portal screenshot',
    },
    'fund-admin': {
      click: 'Clicked fund admin element',
      type: `Entered "${action.value}" in fund admin field`,
      read: 'Read NAV: Fund ABC — NAV per unit: £124.56 — AUM: £2.1bn',
      navigate: `Navigated to fund admin page: ${action.target}`,
      screenshot: 'Captured fund admin screenshot',
    },
    custodian: {
      click: 'Clicked custodian portal element',
      type: `Entered "${action.value}" in custodian field`,
      read: 'Read settlement status: Trade T+2 settling 2025-04-28 — Status: Matched',
      navigate: `Navigated to custodian page: ${action.target}`,
      screenshot: 'Captured custodian portal screenshot',
    },
    custom: {
      click: 'Clicked element',
      type: `Typed "${action.value}"`,
      read: 'Read page content',
      navigate: `Navigated to: ${action.target}`,
      screenshot: 'Captured screenshot',
    },
  };

  return simulations[app]?.[action.type] || `Executed ${action.type} on ${app}`;
}

// ── Session Management ──

export function getSession(sessionId: string): CUASession | undefined {
  return activeSessions.get(sessionId);
}

export function completeSession(sessionId: string): CUASession | undefined {
  const session = activeSessions.get(sessionId);
  if (session) session.status = 'completed';
  return session;
}

export function getAuditTrail(sessionId: string): Array<{ action: string; timestamp: Date; result: string }> {
  const session = activeSessions.get(sessionId);
  if (!session) return [];
  return session.actions.map(a => ({
    action: `${a.type} ${a.target || ''}`.trim(),
    timestamp: a.timestamp,
    result: a.result || '',
  }));
}

export function getActiveSessions(): CUASession[] {
  return Array.from(activeSessions.values()).filter(s => s.status === 'active');
}

export function getCUAStatus(): { enabled: boolean; activeSessions: number; totalActions: number } {
  const sessions = Array.from(activeSessions.values());
  return {
    enabled: !!process.env.FOUNDRY_CUA_ENDPOINT,
    activeSessions: sessions.filter(s => s.status === 'active').length,
    totalActions: sessions.reduce((sum, s) => sum + s.actions.length, 0),
  };
}
