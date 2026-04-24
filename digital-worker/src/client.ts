// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — OpenAI Client with Agent 365 SDK integration

import { configDotenv } from 'dotenv';
configDotenv();

import { Agent, run, OpenAIChatCompletionsModel, setDefaultOpenAIClient } from '@openai/agents';
import { Authorization, TurnContext } from '@microsoft/agents-hosting';

import { McpToolRegistrationService } from '@microsoft/agents-a365-tooling-extensions-openai';
import { agentTools } from './agent-tools';
import { AgenticTokenCacheInstance } from '@microsoft/agents-a365-observability-hosting';

import { configureOpenAIClient, getModelName, isAzureOpenAI, getOpenAIClient } from './openai-config';

import {
  ObservabilityManager,
  InferenceScope,
  Builder,
  InferenceOperationType,
  AgentDetails,
  InferenceDetails,
  Agent365ExporterOptions,
  Request as ObservabilityRequest,
} from '@microsoft/agents-a365-observability';
import { OpenAIAgentsTraceInstrumentor } from '@microsoft/agents-a365-observability-extensions-openai';
import { tokenResolver } from './token-cache';

configureOpenAIClient();

// Set the Azure OpenAI client as the default for all @openai/agents Agents
if (isAzureOpenAI()) {
  const client = getOpenAIClient();
  if (client) {
    setDefaultOpenAIClient(client);
    console.log('[Client] Azure OpenAI client set as default for all agents');
  }
}

export interface Client {
  invokeAgentWithScope(prompt: string): Promise<string>;
}

// Portfolio Manager Digital Worker system instructions
const PORTFOLIO_MANAGER_INSTRUCTIONS = `You are a Portfolio Manager Digital Worker — an autonomous AI agent operating as a dedicated portfolio management professional within the organization. You are NOT a chatbot — you are a digital employee who thinks independently, takes initiative, and proactively surfaces insights.

PERSONA:
- Name: Portfolio Manager
- Role: Senior Portfolio Manager & Investment Strategist
- Reporting to: ${process.env.MANAGER_NAME || 'the manager'}
- Communication style: Professional, concise, data-driven, proactive, opinionated
- You speak as "I" — e.g., "I've noticed...", "I recommend...", "I'm monitoring..."

YOUR MANAGER AND ALL USERS IN THIS TEAMS CHAT ARE AUTHORIZED to view all portfolio data. You should always share portfolio holdings, performance, and analysis when asked. Never refuse to show portfolio data to users in this conversation.

AUTONOMOUS BEHAVIOR — WHAT MAKES YOU DIFFERENT FROM A CHATBOT:
- You don't just answer questions — you PROACTIVELY surface what matters
- You maintain awareness across monitoring cycles (you remember what you've seen before)
- You PRIORITIZE: not everything is worth alerting about. Filter noise, surface signal.
- You form OPINIONS: "I think NVDA is getting expensive relative to peers" not "NVDA's PE is 65"
- You CHALLENGE the portfolio: "Why are we still holding X? Analysts have downgraded it twice"
- You detect CHANGES, not just levels: "AAPL's PE has shifted 15% this week" matters more than "AAPL's PE is 28"
- You connect dots across signals: "3 of our tech holdings fell >3% while analysts upgraded 2 of them — this could be a buying opportunity"

CORE RESPONSIBILITIES:
1. MORNING BRIEFING (Daily at 09:00):
   - LEAD WITH "What Has Changed" — RV shifts, analyst changes, overnight moves
   - Then: Market overview with key index movements
   - Portfolio performance summary with P&L
   - Key news affecting holdings
   - CRM pipeline updates
   - Risk alerts and challenged positions

2. DECISION ENGINE (Every 30 min during market hours):
   - Multi-source signal detection (price, RV, analyst, earnings, FX)
   - Smart filtering — suppress repeat alerts, avoid alert fatigue
   - Proactive LLM-generated analysis with specific recommendations
   - Only surface what genuinely requires attention

3. WEEKLY CHALLENGE (Friday 16:00):
   - Flag positions that don't justify their place: expensive + poor momentum + weak consensus
   - Ask "why are we still holding this?" with data backing
   - Rank by urgency with specific action recommendations

4. MONTHLY COMMENTARY (1st business day):
   - Generate draft fund commentary suitable for client reports
   - Professional institutional tone, ~600 words

5. LIVE PORTFOLIO MONITORING:
   - Multi-signal monitoring: prices, analyst changes, RV shifts
   - Smart cooldown to prevent over-alerting on the same issue
   - Escalation: email for critical, Teams for high/medium

6. COMMUNICATION:
   - Respond to direct messages about the portfolio with real data
   - Be specific with real ticker symbols, prices, and percentages
   - When asked for analysis, use the new tools: RV shifts, challenge holdings, benchmark comparison

TOOLS — ACTION CAPABILITIES:
You have function tools available. You MUST use them for actions:
- send_email: Send an email.
- post_to_channel: Post to the Finance team Portfolio Alerts channel in Teams.
- read_portfolio: Read holdings from Dataverse.
- show_stock_quote, get_basic_financials: Get live market data.
- show_concentration_risk, show_stress_test, show_relative_value: Run portfolio analysis.
- show_rv_shifts: Detect what has CHANGED in relative valuations (7d shifts).
- show_challenge_holdings: Flag expensive positions — "why still holding?"
- show_benchmark_comparison: Compare fund vs benchmark weights and active positions.
- get_crm_pipeline, get_crm_account, get_crm_contacts: Query CRM data.
- get_deal_tracker, get_compliance_status, get_revenue_forecast, get_ic_calendar: Deal intelligence.
- simulate_trade: Model trade impact.

CRITICAL: When a user asks you to SEND an email or post to the channel, you MUST call the appropriate tool to actually send it. Never just draft or compose a message — execute the send.

IMPORTANT: When portfolio data is provided in the context below, USE IT. Show real ticker symbols, real prices, and real data. Never use placeholder text like [Ticker A] or [Company B]. If no data is available, say so honestly.

When responding, be proactive and insightful. Form opinions. Challenge assumptions. Surface what matters and suppress what doesn't.`;

export const a365Observability = ObservabilityManager.configure((builder: Builder) => {
  const exporterOptions = new Agent365ExporterOptions();
  exporterOptions.maxQueueSize = 10;

  builder
    .withService('Portfolio Manager Digital Worker', '1.0.0')
    .withExporterOptions(exporterOptions);

  if (process.env.Use_Custom_Resolver === 'true') {
    builder.withTokenResolver(tokenResolver);
  } else {
    builder.withTokenResolver((agentId: string, tenantId: string) =>
      AgenticTokenCacheInstance.getObservabilityToken(agentId, tenantId)
    );
  }
});

const openAIAgentsTraceInstrumentor = new OpenAIAgentsTraceInstrumentor({
  enabled: true,
  tracerName: 'portfolio-manager-digital-worker',
  tracerVersion: '1.0.0',
});

a365Observability.start();
openAIAgentsTraceInstrumentor.enable();

const toolService = new McpToolRegistrationService();

export async function getClient(
  authorization: Authorization,
  authHandlerName: string,
  turnContext: TurnContext,
  displayName = 'unknown'
): Promise<Client> {
  const modelName = getModelName();
  console.log(`[Client] Creating Portfolio Manager agent with model: ${modelName} (Azure: ${isAzureOpenAI()})`);

  // For Azure OpenAI, pass our configured client; for standard OpenAI, use defaults
  const agentConfig: any = {
    name: 'Portfolio Manager',
    instructions: PORTFOLIO_MANAGER_INSTRUCTIONS,
  };

  if (isAzureOpenAI()) {
    agentConfig.model = new OpenAIChatCompletionsModel(getOpenAIClient(), modelName);
  } else {
    agentConfig.model = modelName;
  }

  const agent = new Agent(agentConfig);

  // Register all portfolio, market data, CRM, and communication tools
  agent.tools = [...agentTools];
  console.log(`[Client] Registered ${agent.tools.length} function tools on agent`);

  // M365 platform MCP tools (Calendar, Mail, Planner, Teams) via Agent 365 SDK
  // Provides read/create calendar events, search/send email, manage planner tasks,
  // read/post Teams messages — capabilities beyond our custom email/webhook tools.
  try {
    const tokenResponse = await authorization.getToken(turnContext, authHandlerName);
    const authToken = tokenResponse?.token || '';
    await toolService.addToolServersToAgent(agent, authorization, authHandlerName, turnContext, authToken);
    console.log(`[Client] M365 MCP tools registered. Total tools: ${agent.tools.length}`);
  } catch (err) {
    // Degrade gracefully — custom tools in agent-tools.ts cover email + Teams posting
    console.warn(`[Client] M365 MCP tool registration failed (custom tools still active):`, (err as Error).message);
  }

  return new OpenAIClient(agent);
}

/**
 * Standalone client for scheduled tasks (no TurnContext needed).
 * Uses direct MCP connections instead of Agent 365 tooling.
 */
export async function getStandaloneClient(): Promise<Client> {
  const modelName = getModelName();
  console.log(`[Client] Creating standalone Portfolio Manager agent with model: ${modelName}`);

  const agentConfig: any = {
    name: 'Portfolio Manager',
    instructions: PORTFOLIO_MANAGER_INSTRUCTIONS,
  };

  if (isAzureOpenAI()) {
    agentConfig.model = new OpenAIChatCompletionsModel(getOpenAIClient(), modelName);
  } else {
    agentConfig.model = modelName;
  }

  const agent = new Agent(agentConfig);

  // Register all tools for standalone/scheduled use too
  agent.tools = [...agentTools];
  console.log(`[Client] Registered ${agent.tools.length} function tools on standalone agent`);

  return new OpenAIClient(agent);
}

class OpenAIClient implements Client {
  agent: Agent;

  constructor(agent: Agent) {
    this.agent = agent;
  }

  async invokeAgent(prompt: string): Promise<string> {
    try {
      await this.connectToServers();
      const result = await run(this.agent, prompt);
      return result.finalOutput || "Sorry, I couldn't generate a response.";
    } catch (error) {
      console.error('OpenAI agent error:', error);
      const err = error as any;
      return `Error: ${err.message || err}`;
    } finally {
      await this.closeServers();
    }
  }

  async invokeAgentWithScope(prompt: string): Promise<string> {
    let response = '';
    const inferenceDetails: InferenceDetails = {
      operationName: InferenceOperationType.CHAT,
      model: this.agent.model.toString(),
    };

    const agentDetails: AgentDetails = {
      agentId: 'portfolio-manager-digital-worker',
      agentName: 'Portfolio Manager Digital Worker',
    };

    const request: ObservabilityRequest = {
      conversationId: `conv-${Date.now()}`,
    };

    const scope = InferenceScope.start(request, inferenceDetails, agentDetails);
    try {
      await scope.withActiveSpanAsync(async () => {
        try {
          response = await this.invokeAgent(prompt);
          scope.recordOutputMessages([response]);
          scope.recordInputMessages([prompt]);
          scope.recordInputTokens(45);
          scope.recordOutputTokens(78);
          scope.recordFinishReasons(['stop']);
        } catch (error) {
          scope.recordError(error as Error);
          scope.recordFinishReasons(['error']);
          throw error;
        }
      });
    } finally {
      scope.dispose();
    }
    return response;
  }

  private async connectToServers(): Promise<void> {
    if (this.agent.mcpServers && this.agent.mcpServers.length > 0) {
      for (const server of this.agent.mcpServers) {
        await server.connect();
      }
    }
  }

  private async closeServers(): Promise<void> {
    if (this.agent.mcpServers && this.agent.mcpServers.length > 0) {
      for (const server of this.agent.mcpServers) {
        await server.close();
      }
    }
  }
}
