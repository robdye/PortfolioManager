// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — Agent handler
//
// Extends AgentApplication with:
// - Portfolio Manager persona
// - Email notification handling
// - Meeting calendar integration with post-meeting summaries
// - Agent install/uninstall lifecycle

import { configDotenv } from 'dotenv';
configDotenv();

import { TurnState, AgentApplication, TurnContext, MemoryStorage } from '@microsoft/agents-hosting';
import { Activity, ActivityTypes } from '@microsoft/agents-activity';
import { BaggageBuilder } from '@microsoft/agents-a365-observability';
import { AgenticTokenCacheInstance, BaggageBuilderUtils } from '@microsoft/agents-a365-observability-hosting';
import { getObservabilityAuthenticationScope } from '@microsoft/agents-a365-runtime';

// Notification Imports
import '@microsoft/agents-a365-notifications';
import { AgentNotificationActivity, NotificationType, createEmailResponseActivity } from '@microsoft/agents-a365-notifications';

import { Client, getClient } from './client';
import tokenCache, { createAgenticTokenCacheKey } from './token-cache';
import { mcpClient } from './mcp-client';
import { sendBriefing } from './morning-briefing';
import { buildBriefingPrompt } from './briefing-prompt';
import { sendEmail, resolveUserEmail } from './email-service';
import { trimFinancials } from './trim-financials';
import { addMessage, getHistory } from './conversation-memory';
import { simulateTrade } from './trade-simulation';
import { searchCompanyNews } from './news-search';
import { detectVoiceCommand, enableVoice, disableVoice, isVoiceEnabled } from './voice/voiceGate';

const MANAGER_EMAIL = process.env.MANAGER_EMAIL || '';
const MANAGER_NAME = process.env.MANAGER_NAME || 'Manager';

export class PortfolioManagerAgent extends AgentApplication<TurnState> {
  static authHandlerName: string = 'agentic';

  constructor() {
    super({
      storage: new MemoryStorage(),
      authorization: {
        agentic: {
          type: 'agentic',
        },
      },
    });

    // Route agent notifications (email, Word comments, etc.)
    this.onAgentNotification('agents:*', async (
      context: TurnContext,
      state: TurnState,
      agentNotificationActivity: AgentNotificationActivity
    ) => {
      await this.handleAgentNotificationActivity(context, state, agentNotificationActivity);
    }, 1, [PortfolioManagerAgent.authHandlerName]);

    // Handle direct messages
    this.onActivity(ActivityTypes.Message, async (context: TurnContext, state: TurnState) => {
      await this.handleAgentMessageActivity(context, state);
    }, [PortfolioManagerAgent.authHandlerName]);

    // Handle agent install/uninstall events
    this.onActivity(ActivityTypes.InstallationUpdate, async (context: TurnContext, state: TurnState) => {
      await this.handleInstallationUpdateActivity(context, state);
    });
  }

  /**
   * Handle incoming user messages with Portfolio Manager persona.
   */
  async handleAgentMessageActivity(turnContext: TurnContext, state: TurnState): Promise<void> {
    const userMessage = turnContext.activity.text?.trim() || '';
    const from = turnContext.activity?.from;
    const userId = from?.aadObjectId || from?.id || 'unknown';

    console.log(`Turn received from — DisplayName: '${(from?.name ?? "(unknown)").substring(0, 3)}***', UserId: '${userId.substring(0, 8)}...'`);
    const displayName = from?.name ?? 'unknown';

    if (!userMessage) {
      await turnContext.sendActivity('Hello! I\'m your Portfolio Manager. How can I help you today?');
      return;
    }

    // Store user message in conversation memory
    addMessage(userId, 'user', userMessage);

    const lowerMsg = userMessage.toLowerCase();

    // === VOICE COMMANDS ===
    const voiceCmd = detectVoiceCommand(lowerMsg);
    if (voiceCmd) {
      if (voiceCmd === 'enable') {
        enableVoice();
        const voiceUrl = process.env.VOICE_URL || `https://${process.env.WEBSITE_HOSTNAME || 'localhost:3978'}/voice`;
        await turnContext.sendActivity(
          `Voice interface **enabled**. Open the voice page here: ${voiceUrl}`
        );
      } else if (voiceCmd === 'disable') {
        disableVoice();
        await turnContext.sendActivity('Voice interface **disabled**. The voice page will show an offline screen.');
      } else if (voiceCmd === 'status') {
        const state = isVoiceEnabled() ? 'enabled' : 'disabled';
        await turnContext.sendActivity(`Voice interface is currently **${state}**.`);
      }
      return;
    }

    // === BRIEFING COMMANDS ===
    if (lowerMsg.includes('morning briefing') || lowerMsg.includes('daily brief')) {
      await turnContext.sendActivity('Generating your morning briefing now...');
      await turnContext.sendActivity({ type: 'typing' } as Activity);
      await this.handleBriefingRequest(turnContext);
      return;
    }

    // === TRADE SIMULATION ===
    if (lowerMsg.includes('what if') || lowerMsg.includes('simulate') || (lowerMsg.includes('sell') && lowerMsg.includes('buy'))) {
      await turnContext.sendActivity('Running trade simulation...');
      await turnContext.sendActivity({ type: 'typing' } as Activity);
      await this.handleTradeSimulation(turnContext, userMessage, displayName);
      return;
    }

    // === NEWS SEARCH ===
    if (lowerMsg.includes('news for') || lowerMsg.includes('latest news') || lowerMsg.match(/news\s+(on|about)\s+/)) {
      await turnContext.sendActivity('Searching for news...');
      await turnContext.sendActivity({ type: 'typing' } as Activity);
      await this.handleNewsSearch(turnContext, userMessage, displayName);
      return;
    }

    // === STANDARD MESSAGE ===
    await turnContext.sendActivity('Got it — working on it...');
    await turnContext.sendActivity({ type: 'typing' } as Activity);

    let typingInterval: ReturnType<typeof setInterval> | undefined;
    const startTypingLoop = () => {
      typingInterval = setInterval(() => {
        turnContext.sendActivity({ type: 'typing' } as Activity).catch((err) => { console.error('[Agent] Failed to send typing indicator:', (err as Error).message); });
      }, 4000);
    };
    const stopTypingLoop = () => { clearInterval(typingInterval); };

    startTypingLoop();

    const baggageScope = BaggageBuilderUtils.fromTurnContext(
      new BaggageBuilder(), turnContext
    ).sessionDescription('Portfolio Manager conversation')
      .build();

    await this.preloadObservabilityToken(turnContext);

    try {
      await baggageScope.run(async () => {
        const client: Client = await getClient(
          this.authorization,
          PortfolioManagerAgent.authHandlerName,
          turnContext,
          displayName
        );

        // The agent has function tools (read_portfolio, get_crm_pipeline, etc.)
        // that it can call autonomously. No need to pre-fetch data into the prompt.
        let enrichedPrompt = userMessage;

        // Add brief conversation history for context continuity (limit to avoid token explosion)
        const history = getHistory(userId);
        if (history) {
          // Truncate history to ~2000 chars to stay within token limits
          const trimmedHistory = history.length > 2000 ? history.substring(history.length - 2000) : history;
          enrichedPrompt = `Previous conversation:\n${trimmedHistory}\n\nUser query: ${userMessage}`;
        }

        const response = await client.invokeAgentWithScope(enrichedPrompt);
        addMessage(userId, 'assistant', response.substring(0, 500));
        await turnContext.sendActivity(response);
      });
    } catch (error) {
      console.error('LLM query error:', error);
      const err = error as any;
      await turnContext.sendActivity(`I apologize, I encountered an error processing your request: ${err.message || err}`);
    } finally {
      stopTypingLoop();
      baggageScope.dispose();
    }
  }

  /**
   * Handle a request for a morning briefing via direct message.
   */
  private async handleBriefingRequest(turnContext: TurnContext): Promise<void> {
    try {
      const client: Client = await getClient(
        this.authorization,
        PortfolioManagerAgent.authHandlerName,
        turnContext,
        turnContext.activity.from?.name ?? 'Manager'
      );

      console.log('[Briefing] Fetching data from MCP servers...');
      const [holdings, pipeline] = await Promise.allSettled([
        mcpClient.getPortfolioHoldings(),
        mcpClient.getCrmPipeline(),
      ]);

      // Fetch market quotes for holdings with shares > 0
      const quotes: Array<{ ticker: string; data: unknown }> = [];
      try {
        const holdingsVal = holdings.status === 'fulfilled' ? holdings.value : null;
        if (holdingsVal) {
          let tickers: string[] = [];
          const holdingsStr = typeof holdingsVal === 'string' ? holdingsVal : JSON.stringify(holdingsVal);
          const match = holdingsStr.match(/\[[\s\S]*\]/);
          if (match) {
            const arr = JSON.parse(match[0]);
            tickers = arr.filter((h: any) => h.Ticker && h.Shares > 0).map((h: any) => h.Ticker).slice(0, 8);
          }
          if (tickers.length > 0) {
            console.log(`[Briefing] Fetching quotes for: ${tickers.join(', ')}`);
            const results = await Promise.allSettled(tickers.map(t => mcpClient.getBasicFinancials(t)));
            results.forEach((r, i) => {
              if (r.status === 'fulfilled') quotes.push(trimFinancials(tickers[i], r.value));
            });
          }
        }
      } catch (e) {
        console.warn('[Briefing] Quote fetch error:', e);
      }

      const prompt = buildBriefingPrompt({
        holdings: holdings.status === 'fulfilled' ? holdings.value : 'unavailable',
        pipeline: pipeline.status === 'fulfilled' ? pipeline.value : 'unavailable',
        quotes,
      });

      const response = await client.invokeAgentWithScope(prompt);
      await turnContext.sendActivity(response);
    } catch (error) {
      console.error('Briefing request error:', error);
      await turnContext.sendActivity('I was unable to generate the briefing at this time. I\'ll retry shortly.');
    }
  }

  /**
   * Handle trade simulation requests.
   */
  private async handleTradeSimulation(turnContext: TurnContext, userMessage: string, displayName: string): Promise<void> {
    try {
      const client: Client = await getClient(this.authorization, PortfolioManagerAgent.authHandlerName, turnContext, displayName);
      const tradeData = await simulateTrade(userMessage);

      const prompt = `The user wants to simulate a trade. Here is the current portfolio and market data:

${tradeData}

User request: "${userMessage}"

Analyze this trade simulation:
1. Show the current position (if any) in the mentioned stocks
2. Calculate the approximate cost/proceeds of the trade
3. Show how the portfolio allocation would change
4. Highlight any risks (concentration, sector exposure)
5. Give your professional recommendation

Use real numbers from the data above.`;

      const response = await client.invokeAgentWithScope(prompt);
      const userId = turnContext.activity?.from?.aadObjectId || 'unknown';
      addMessage(userId, 'assistant', response.substring(0, 500));
      await turnContext.sendActivity(response);
    } catch (error) {
      console.error('[Trade] Simulation error:', error);
      await turnContext.sendActivity('I encountered an error running the trade simulation. Please try again.');
    }
  }

  /**
   * Handle news search requests.
   */
  private async handleNewsSearch(turnContext: TurnContext, userMessage: string, displayName: string): Promise<void> {
    try {
      // Extract ticker or company name from the message
      const tickerMatch = userMessage.match(/\b([A-Z]{1,5})\b/);
      const companyMatch = userMessage.match(/news\s+(?:for|on|about)\s+(.+?)(?:\?|$)/i);
      const searchTerm = companyMatch?.[1]?.trim() || tickerMatch?.[0] || '';

      if (!searchTerm) {
        await turnContext.sendActivity('Please specify a company or ticker symbol. Example: "news for MSFT" or "latest news on AstraZeneca"');
        return;
      }

      const news = await searchCompanyNews(searchTerm, searchTerm);

      if (news.length === 0) {
        await turnContext.sendActivity(`No recent news found for ${searchTerm}.`);
        return;
      }

      const client: Client = await getClient(this.authorization, PortfolioManagerAgent.authHandlerName, turnContext, displayName);
      const prompt = `The user asked for news about "${searchTerm}". Here are the results:

${JSON.stringify(news.slice(0, 8))}

Summarize these news items in a clear, structured format:
- Group by theme
- Include source and date for each item
- Add your analysis of potential portfolio impact
- If URLs are available, mention them`;

      const response = await client.invokeAgentWithScope(prompt);
      const userId = turnContext.activity?.from?.aadObjectId || 'unknown';
      addMessage(userId, 'assistant', response.substring(0, 500));
      await turnContext.sendActivity(response);
    } catch (error) {
      console.error('[News] Search error:', error);
      await turnContext.sendActivity('I encountered an error searching for news. Please try again.');
    }
  }

  /**
   * Check if a message is portfolio-related to decide on context enrichment.
   */
  private isPortfolioRelated(message: string): boolean {
    const keywords = ['portfolio', 'holding', 'position', 'stock', 'performance',
      'p&l', 'pnl', 'return', 'risk', 'exposure', 'concentration', 'sector',
      'quote', 'price', 'market', 'news', 'earnings', 'analyst'];
    const lower = message.toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
  }

  /**
   * Detect if the user wants something emailed rather than shown in chat.
   */
  private isEmailRequest(msg: string): boolean {
    return /\b(email|send.*email|mail\s+(me|it|this|to)|send\s+(me|it|this|to).*email|email\s+(me|it|this|to))\b/i.test(msg);
  }

  /** Resolve an AAD object ID (from Teams mention) to an email via Graph API */
  private async resolveAadIdToEmail(aadId: string): Promise<string | null> {
    // Strip Teams-specific prefixes like "29:" or "28:"
    const cleanId = aadId.replace(/^\d+:/, '');
    try {
      const { resolveUserEmail: resolve } = await import('./email-service.js');
      // Try direct user lookup by ID via Graph
      const clientId = process.env.GRAPH_APP_ID || process.env.clientId || process.env.connections__service_connection__settings__clientId || '';
      const clientSecret = process.env.GRAPH_APP_SECRET || process.env.clientSecret || process.env.connections__service_connection__settings__clientSecret || '';
      const tenantId = process.env.GRAPH_TENANT_ID || process.env.tenantId || process.env.connections__service_connection__settings__tenantId || '';
      if (!clientId || !clientSecret || !tenantId) return null;

      const body = `client_id=${clientId}&client_secret=${encodeURIComponent(clientSecret)}&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default&grant_type=client_credentials`;
      const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!tokenRes.ok) return null;
      const tokenData = await tokenRes.json() as any;

      const userRes = await fetch(`https://graph.microsoft.com/v1.0/users/${cleanId}?$select=mail,userPrincipalName,displayName`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!userRes.ok) return null;
      const user = await userRes.json() as any;
      return user.mail || user.userPrincipalName || null;
    } catch {
      return null;
    }
  }

  /**
   * Extract the email recipient from the message. Falls back to the sender or manager.
   */
  private extractEmailTarget(msg: string, from?: any, turnContext?: TurnContext): string {
    // Check for explicit email addresses in the message
    const emailMatch = msg.match(/[\w.+-]+@[\w.-]+\.\w+/);
    if (emailMatch) return emailMatch[0];

    // Check for @mentions in Teams activity entities
    if (turnContext?.activity?.entities) {
      const mentions = turnContext.activity.entities.filter(
        (e: any) => e.type === 'mention' && e.mentioned?.id !== turnContext.activity.recipient?.id
      );
      console.log(`[Email] Found ${mentions.length} mention(s) in activity entities`);
      if (mentions.length > 0) {
        const mentioned = mentions[0] as any;
        const mentionedId = mentioned.mentioned?.id;
        const mentionedName = mentioned.mentioned?.name;
        console.log(`[Email] Mention: id=${mentionedId}, name=${mentionedName}`);

        // If ID looks like an email/UPN, use it directly
        if (mentionedId && mentionedId.includes('@') && !mentionedId.startsWith('28:') && !mentionedId.startsWith('29:')) {
          return mentionedId;
        }
        // If we have a name, look it up via Graph
        if (mentionedName) {
          return `@lookup:${mentionedName}`;
        }
        // If we only have an AAD object ID, look it up directly
        if (mentionedId) {
          return `@aadlookup:${mentionedId}`;
        }
      }
    }

    // Try to extract a person's name from the message text
    // Patterns: "email <Name> ...", "send <Name> ...", "e-mail <Name> ..."
    const namePatterns = [
      /(?:email|e-mail|send|mail)\s+(?:the\s+)?(?:daily\s+brief|briefing|morning\s+briefing)\s+(?:to\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
      /(?:email|e-mail|send|mail)\s+(?:to\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
      /(?:email|e-mail|send|mail)\s+([A-Z][a-z]+)\s+(?:the|a|my|this)/i,
    ];
    for (const pattern of namePatterns) {
      const nameMatch = msg.match(pattern);
      if (nameMatch && nameMatch[1]) {
        const name = nameMatch[1].trim();
        const skipWords = ['the', 'this', 'my', 'me', 'all', 'team', 'everyone'];
        if (!skipWords.includes(name.toLowerCase())) {
          return `@lookup:${name}`;
        }
      }
    }

    // "email me" → always use manager email
    return MANAGER_EMAIL || 'admin@ABSx68251802.onmicrosoft.com';
  }

  /** Resolve @lookup: and @aadlookup: markers to actual email addresses */
  private async resolveEmail(target: string): Promise<string> {
    if (target.startsWith('@lookup:')) {
      const name = target.replace('@lookup:', '');
      console.log(`[Email] Resolving name "${name}" via Graph user search...`);
      const resolved = await resolveUserEmail(name);
      console.log(`[Email] Resolved: ${resolved || 'NOT FOUND'}`);
      return resolved || MANAGER_EMAIL || 'admin@ABSx68251802.onmicrosoft.com';
    }
    if (target.startsWith('@aadlookup:')) {
      const aadId = target.replace('@aadlookup:', '');
      console.log(`[Email] Resolving AAD ID "${aadId}" via Graph...`);
      try {
        const resolved = await this.resolveAadIdToEmail(aadId);
        console.log(`[Email] AAD resolved: ${resolved || 'NOT FOUND'}`);
        return resolved || MANAGER_EMAIL || 'admin@ABSx68251802.onmicrosoft.com';
      } catch (err) {
        console.error(`[Email] AAD lookup failed:`, (err as Error).message);
        return MANAGER_EMAIL || 'admin@ABSx68251802.onmicrosoft.com';
      }
    }
    return target;
  }

  /**
   * Generate briefing and send it via email instead of chat.
   */
  private async handleBriefingEmailRequest(turnContext: TurnContext, emailTo: string): Promise<void> {
    try {
      const client: Client = await getClient(
        this.authorization,
        PortfolioManagerAgent.authHandlerName,
        turnContext,
        turnContext.activity.from?.name ?? 'Manager'
      );

      // Fetch data
      const [holdings, pipeline] = await Promise.allSettled([
        mcpClient.getPortfolioHoldings(),
        mcpClient.getCrmPipeline(),
      ]);

      const quotes: Array<{ ticker: string; data: unknown }> = [];
      try {
        const holdingsVal = holdings.status === 'fulfilled' ? holdings.value : null;
        if (holdingsVal) {
          const holdingsStr = typeof holdingsVal === 'string' ? holdingsVal : JSON.stringify(holdingsVal);
          const match = holdingsStr.match(/\[[\s\S]*\]/);
          if (match) {
            const arr = JSON.parse(match[0]);
            const tickers = arr.filter((h: any) => h.Ticker && h.Shares > 0).map((h: any) => h.Ticker).slice(0, 8);
            const results = await Promise.allSettled(tickers.map((t: string) => mcpClient.getBasicFinancials(t)));
            results.forEach((r, i) => {
              if (r.status === 'fulfilled') quotes.push(trimFinancials(tickers[i], r.value));
            });
          }
        }
      } catch (e) {
        console.warn('[Email Briefing] Quote fetch error:', e);
      }

      const prompt = buildBriefingPrompt({
        holdings: holdings.status === 'fulfilled' ? holdings.value : 'unavailable',
        pipeline: pipeline.status === 'fulfilled' ? pipeline.value : 'unavailable',
        quotes,
      }) + '\n\nIMPORTANT: Format the output as clean HTML suitable for an email body. Use proper HTML tags (<h2>, <h3>, <ul>, <li>, <p>, <strong>) for structure.';

      const briefingContent = await client.invokeAgentWithScope(prompt);

      const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

      const sent = await sendEmail({
        to: emailTo,
        subject: `Morning Briefing — ${today}`,
        body: briefingContent,
        isHtml: true,
      });

      if (sent) {
        await turnContext.sendActivity(`Morning briefing has been emailed to **${emailTo}**.`);
      } else {
        await turnContext.sendActivity(`I was unable to send the email. Here's the briefing in chat instead:\n\n${briefingContent}`);
      }
    } catch (error) {
      console.error('[Email Briefing] Error:', error);
      await turnContext.sendActivity('I encountered an error generating the email briefing. Please try again.');
    }
  }

  /**
   * Handle a generic email request — compose content via LLM and send.
   */
  private async handleEmailRequest(
    turnContext: TurnContext, userMessage: string, emailTo: string, displayName: string
  ): Promise<void> {
    try {
      const client: Client = await getClient(
        this.authorization,
        PortfolioManagerAgent.authHandlerName,
        turnContext,
        displayName
      );

      // Get portfolio context
      let context = '';
      try {
        const holdings = await mcpClient.getPortfolioHoldings();
        if (holdings) context = `Portfolio data: ${JSON.stringify(holdings)}\n`;
      } catch { /* continue without data */ }

      const prompt = `${context}The user asked: "${userMessage}"

Compose a professional email based on what the user is asking. 
Return ONLY the email content as HTML (using <h2>, <p>, <ul>, <li>, <strong> tags).
Do NOT include email headers (To/From/Subject) — just the body content.
Also return a suggested subject line on the FIRST line, prefixed with "SUBJECT: ".`;

      const response = await client.invokeAgentWithScope(prompt);

      // Parse subject from first line
      let subject = 'Portfolio Manager Update';
      let body = response;
      const lines = response.split('\n');
      if (lines[0]?.startsWith('SUBJECT:')) {
        subject = lines[0].replace('SUBJECT:', '').trim();
        body = lines.slice(1).join('\n').trim();
      }

      const sent = await sendEmail({ to: emailTo, subject, body, isHtml: true });

      if (sent) {
        await turnContext.sendActivity(`Email sent to **${emailTo}** with subject: "${subject}"`);
      } else {
        await turnContext.sendActivity(`I was unable to send the email to ${emailTo}. Here's what I would have sent:\n\n${body}`);
      }
    } catch (error) {
      console.error('[Email] Error:', error);
      await turnContext.sendActivity('I encountered an error sending the email. Please try again.');
    }
  }

  /**
   * Route incoming notifications to the appropriate handler.
   */
  async handleAgentNotificationActivity(
    context: TurnContext,
    state: TurnState,
    agentNotificationActivity: AgentNotificationActivity
  ): Promise<void> {
    switch (agentNotificationActivity.notificationType) {
      case NotificationType.EmailNotification:
        await this.handleEmailNotification(context, state, agentNotificationActivity);
        break;
      default:
        console.log(`Received notification of type: ${agentNotificationActivity.notificationType}`);
        await context.sendActivity(
          `I received a ${agentNotificationActivity.notificationType} notification and I'm processing it.`
        );
    }
  }

  /**
   * Handle email notifications — the agent can receive emails and respond.
   */
  private async handleEmailNotification(
    context: TurnContext,
    state: TurnState,
    activity: AgentNotificationActivity
  ): Promise<void> {
    const emailNotification = activity.emailNotification;

    if (!emailNotification) {
      const errorResponse = createEmailResponseActivity('I could not find the email notification details.');
      await context.sendActivity(errorResponse);
      return;
    }

    try {
      const client: Client = await getClient(
        this.authorization,
        PortfolioManagerAgent.authHandlerName,
        context,
        context.activity.from?.name
      );

      // Retrieve and process the email
      const emailContent = await client.invokeAgentWithScope(
        `You have a new email from ${context.activity.from?.name} with id '${emailNotification.id}', ` +
        `ConversationId '${emailNotification.conversationId}'. Please retrieve this message and return it in text format.`
      );

      // Check if it's a meeting-related email (invite, summary request)
      const isMeetingRelated = /meeting|calendar|invite|agenda|minutes|summary/i.test(emailContent);

      let response: string;

      if (isMeetingRelated) {
        // Handle meeting-related emails with portfolio context
        response = await client.invokeAgentWithScope(
          `You received a meeting-related email. Process it and take appropriate action:

EMAIL CONTENT: ${emailContent}

If this is a meeting invite:
- Accept the meeting
- Prepare a brief portfolio-relevant briefing for the meeting topic
- Reply confirming attendance with any relevant portfolio data

If this is a request for meeting notes/summary:
- Generate a structured meeting summary
- Include key discussion points, decisions, and action items
- Send the summary to all meeting participants

Respond with your analysis and any actions taken.`
        );
      } else {
        // Standard email processing with portfolio context
        response = await client.invokeAgentWithScope(
          `Process this email and respond appropriately as the Portfolio Manager:

EMAIL CONTENT: ${emailContent}

Provide a helpful, data-driven response. If the email asks about portfolio positions, 
performance, or market data, use your MCP tools to gather current information before responding.`
        );
      }

      const emailResponseActivity = createEmailResponseActivity(
        response || 'I have processed your email and will follow up shortly.'
      );
      await context.sendActivity(emailResponseActivity);
    } catch (error) {
      console.error('Email notification error:', error);
      const errorResponse = createEmailResponseActivity(
        'I encountered an issue processing your email. I\'ll have my manager follow up.'
      );
      await context.sendActivity(errorResponse);
    }
  }

  /**
   * Handle agent install (hire) and uninstall (remove) lifecycle events.
   */
  async handleInstallationUpdateActivity(context: TurnContext, state: TurnState): Promise<void> {
    const from = context.activity?.from;
    console.log(`InstallationUpdate — Action: '${context.activity.action ?? "(none)"}', DisplayName: '${from?.name ?? "(unknown)"}'`);

    if (context.activity.action === 'add') {
      await context.sendActivity(
        `Hello! I'm your Portfolio Manager Digital Worker. I've been hired to help manage your investment portfolio.\n\n` +
        `Here's what I'll do for you:\n` +
        `- **Morning Briefing** — Every weekday at 09:00, I'll email you a comprehensive portfolio briefing\n` +
        `- **Live Monitoring** — I'll watch for significant price movements (>${process.env.PRICE_CHANGE_THRESHOLD || '2'}%) and alert you immediately\n` +
        `- **Meeting Support** — Include me in meetings and I'll send summaries to all participants\n` +
        `- **On-demand Analysis** — Ask me anything about the portfolio, market, or CRM data\n\n` +
        `I'm connected to your Finnhub market data, CRM, and Portfolio management systems. Let's get started!`
      );
    } else if (context.activity.action === 'remove') {
      await context.sendActivity(
        'Thank you for the opportunity. I\'ve enjoyed managing your portfolio. All scheduled briefings have been stopped. Goodbye!'
      );
    }
  }

  /**
   * Preload observability token for A365 telemetry.
   */
  private async preloadObservabilityToken(turnContext: TurnContext): Promise<void> {
    const agentId = turnContext?.activity?.recipient?.agenticAppId ?? '';
    const tenantId = turnContext?.activity?.recipient?.tenantId ?? '';

    if (process.env.Use_Custom_Resolver === 'true') {
      const aauToken = await this.authorization.exchangeToken(turnContext, 'agentic', {
        scopes: getObservabilityAuthenticationScope(),
      });
      const cacheKey = createAgenticTokenCacheKey(agentId, tenantId);
      tokenCache.set(cacheKey, aauToken?.token || '');
    } else {
      await AgenticTokenCacheInstance.RefreshObservabilityToken(
        agentId,
        tenantId,
        turnContext,
        this.authorization,
        getObservabilityAuthenticationScope()
      );
    }
  }
}

export const agentApplication = new PortfolioManagerAgent();
