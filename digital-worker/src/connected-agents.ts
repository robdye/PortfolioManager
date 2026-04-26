/**
 * Portfolio Manager — Agent-to-Agent (A2A) Protocol
 * Federation layer for cross-firm agent communication.
 * Enables: broker settlement bots, custodian agents, counterparty negotiation.
 */

import crypto from 'crypto';

// ── Types ──

export interface ConnectedAgent {
  id: string;
  name: string;
  endpoint: string;
  capabilities: string[];
  protocol: 'a2a' | 'mcp' | 'rest';
  status: 'online' | 'offline' | 'degraded';
  lastSeen: Date;
  trustLevel: 'internal' | 'partner' | 'external';
}

export interface A2AMessage {
  messageId: string;
  fromAgent: string;
  toAgent: string;
  type: 'request' | 'response' | 'notification' | 'negotiation';
  payload: Record<string, unknown>;
  timestamp: Date;
  correlationId?: string;
  ttlMs?: number;
}

export interface A2ACapability {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

// ── Agent Registry ──

const registry = new Map<string, ConnectedAgent>();
const messageLog: A2AMessage[] = [];
const MAX_LOG = 1000;

export function registerAgent(agent: Omit<ConnectedAgent, 'lastSeen' | 'status'>): ConnectedAgent {
  const full: ConnectedAgent = { ...agent, status: 'online', lastSeen: new Date() };
  registry.set(agent.id, full);
  console.log(`[A2A] Registered agent: ${agent.name} (${agent.id}) — ${agent.capabilities.length} capabilities`);
  return full;
}

export function getRegisteredAgents(): ConnectedAgent[] {
  return Array.from(registry.values());
}

export function discoverCapabilities(agentId: string): string[] {
  return registry.get(agentId)?.capabilities || [];
}

// ── Message Routing ──

export async function sendMessage(message: Omit<A2AMessage, 'messageId' | 'timestamp'>): Promise<A2AMessage> {
  const full: A2AMessage = {
    ...message,
    messageId: `a2a-${crypto.randomUUID()}`,
    timestamp: new Date(),
  };

  messageLog.push(full);
  if (messageLog.length > MAX_LOG) messageLog.shift();

  const target = registry.get(message.toAgent);
  if (!target) {
    console.warn(`[A2A] Target agent not found: ${message.toAgent}`);
    return full;
  }

  if (target.protocol === 'a2a' && target.endpoint) {
    try {
      const response = await fetch(`${target.endpoint}/a2a/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(full),
      });

      if (!response.ok) {
        console.error(`[A2A] Send failed to ${target.name}: ${response.status}`);
        target.status = 'degraded';
      } else {
        target.lastSeen = new Date();
        target.status = 'online';
      }
    } catch (err) {
      console.error(`[A2A] Send failed to ${target.name}:`, (err as Error).message);
      target.status = 'offline';
    }
  } else {
    // Local dispatch for demo/testing
    console.log(`[A2A] Local dispatch: ${full.fromAgent} → ${full.toAgent}: ${full.type}`);
  }

  return full;
}

// ── Negotiation Protocol ──

export interface NegotiationState {
  negotiationId: string;
  counterparty: string;
  status: 'proposed' | 'counter-offered' | 'accepted' | 'rejected' | 'expired';
  rounds: Array<{ from: string; proposal: Record<string, unknown>; timestamp: Date }>;
  maxRounds: number;
}

const negotiations = new Map<string, NegotiationState>();

export function startNegotiation(
  counterpartyId: string,
  initialProposal: Record<string, unknown>,
  maxRounds = 5,
): NegotiationState {
  const state: NegotiationState = {
    negotiationId: `neg-${crypto.randomUUID()}`,
    counterparty: counterpartyId,
    status: 'proposed',
    rounds: [{ from: 'pm-digital-worker', proposal: initialProposal, timestamp: new Date() }],
    maxRounds,
  };

  negotiations.set(state.negotiationId, state);

  sendMessage({
    fromAgent: 'pm-digital-worker',
    toAgent: counterpartyId,
    type: 'negotiation',
    payload: { negotiationId: state.negotiationId, action: 'propose', ...initialProposal },
    correlationId: state.negotiationId,
  });

  return state;
}

export function respondToNegotiation(
  negotiationId: string,
  action: 'accept' | 'reject' | 'counter',
  counterProposal?: Record<string, unknown>,
): NegotiationState | undefined {
  const state = negotiations.get(negotiationId);
  if (!state) return undefined;

  if (action === 'accept') state.status = 'accepted';
  else if (action === 'reject') state.status = 'rejected';
  else {
    if (state.rounds.length >= state.maxRounds) {
      state.status = 'expired';
    } else {
      state.status = 'counter-offered';
      state.rounds.push({ from: 'pm-digital-worker', proposal: counterProposal || {}, timestamp: new Date() });
    }
  }

  return state;
}

// ── Health & Status ──

export async function healthCheckAgents(): Promise<Array<{ id: string; name: string; status: string }>> {
  const results: Array<{ id: string; name: string; status: string }> = [];

  for (const [, agent] of registry) {
    if (agent.endpoint) {
      try {
        const resp = await fetch(`${agent.endpoint}/health`, { signal: AbortSignal.timeout(5000) });
        agent.status = resp.ok ? 'online' : 'degraded';
        agent.lastSeen = new Date();
      } catch {
        agent.status = 'offline';
      }
    }
    results.push({ id: agent.id, name: agent.name, status: agent.status });
  }

  return results;
}

export function getMessageLog(limit = 50): A2AMessage[] {
  return messageLog.slice(-limit);
}

export function getA2AStatus(): { registeredAgents: number; activeNegotiations: number; messageCount: number } {
  return {
    registeredAgents: registry.size,
    activeNegotiations: Array.from(negotiations.values()).filter(n => ['proposed', 'counter-offered'].includes(n.status)).length,
    messageCount: messageLog.length,
  };
}

// ── Default Agents ──

export function registerDefaultAgents(): void {
  registerAgent({
    id: 'broker-settlement-bot',
    name: 'Broker Settlement Bot',
    endpoint: process.env.BROKER_AGENT_ENDPOINT || '',
    capabilities: ['settle-trade', 'confirm-allocation', 'query-settlement-status'],
    protocol: 'a2a',
    trustLevel: 'partner',
  });

  registerAgent({
    id: 'custodian-agent',
    name: 'Custodian Agent',
    endpoint: process.env.CUSTODIAN_AGENT_ENDPOINT || '',
    capabilities: ['query-holdings', 'confirm-receipt', 'corporate-actions'],
    protocol: 'a2a',
    trustLevel: 'partner',
  });

  registerAgent({
    id: 'market-data-agent',
    name: 'Market Data Agent',
    endpoint: process.env.MARKET_DATA_AGENT_ENDPOINT || '',
    capabilities: ['real-time-quotes', 'historical-data', 'analytics'],
    protocol: 'mcp',
    trustLevel: 'internal',
  });
}
