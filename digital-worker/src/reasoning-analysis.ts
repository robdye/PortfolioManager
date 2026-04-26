// Portfolio Manager — Reasoning Analysis
// Routes complex investment decisions to an o-series reasoning model.
// Covers: stress tests, scenario analysis, "should we trim?", challenge holdings.
// Falls back to standard model if reasoning deployment is not configured.

import { getOpenAIClient, isAzureOpenAI, getModelName } from './openai-config';

// ── Types ──

export interface AnalysisResult {
  analysis: string;
  chainOfThought: string[];
  confidence: number;
  recommendations: string[];
}

export interface PortfolioContext {
  holdings: Array<{ symbol: string; weight: number; pnl: number; sector: string }>;
  totalAUM: number;
  benchmarkIndex: string;
  riskBudget?: number;
}

export interface MarketScenario {
  name: string;
  description: string;
  assumptions: Record<string, string>;
  probability?: number;
}

// ── Helpers ──

function getReasoningDeployment(): string | undefined {
  return process.env.AZURE_OPENAI_REASONING_DEPLOYMENT;
}

function isReasoningAvailable(): boolean {
  return !!(getReasoningDeployment() && (process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_API_BASE));
}

async function callModel(systemPrompt: string, userPrompt: string): Promise<string> {
  const useReasoning = isReasoningAvailable();
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_API_BASE || '';
  const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY || '';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';
  const deployment = useReasoning ? getReasoningDeployment()! : getModelName();

  if (isAzureOpenAI() && endpoint && apiKey) {
    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: useReasoning ? 1 : 0.2,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Azure OpenAI ${res.status}: ${errText}`);
    }
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }

  const client = getOpenAIClient();
  if (!client) {
    throw new Error('No OpenAI client configured. Set AZURE_OPENAI_ENDPOINT + key or OPENAI_API_KEY.');
  }
  const completion = await client.chat.completions.create({
    model: deployment,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
  });
  return completion.choices?.[0]?.message?.content ?? '';
}

function parseAnalysisResponse(raw: string): AnalysisResult {
  try {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const toParse = jsonMatch ? jsonMatch[1].trim() : raw.trim();
    const parsed = JSON.parse(toParse);
    return {
      analysis: parsed.analysis ?? raw,
      chainOfThought: Array.isArray(parsed.chainOfThought) ? parsed.chainOfThought : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    };
  } catch {
    return {
      analysis: raw,
      chainOfThought: [],
      confidence: 0.5,
      recommendations: [],
    };
  }
}

// ── Public API ──

/**
 * Perform stress test analysis on the portfolio under a given scenario.
 */
export async function analyzeStressTest(
  portfolio: PortfolioContext,
  scenario: MarketScenario
): Promise<AnalysisResult> {
  const systemPrompt = `You are an expert portfolio risk analyst performing stress test analysis.
Think step-by-step: identify exposures, estimate scenario impact on each holding, calculate portfolio-level P&L impact, assess liquidity risk.
Return JSON:
{
  "analysis": "detailed stress test narrative",
  "chainOfThought": ["step 1", "step 2", ...],
  "confidence": 0.0-1.0,
  "recommendations": ["action 1", ...]
}`;

  const userPrompt = `Stress test this portfolio under the given scenario:

**Portfolio (${portfolio.holdings.length} holdings, AUM: ${portfolio.totalAUM}):**
${JSON.stringify(portfolio.holdings, null, 2)}

**Benchmark:** ${portfolio.benchmarkIndex}
**Risk Budget:** ${portfolio.riskBudget ?? 'not set'}

**Scenario: ${scenario.name}**
${scenario.description}
Assumptions: ${JSON.stringify(scenario.assumptions)}
${scenario.probability ? `Probability: ${(scenario.probability * 100).toFixed(0)}%` : ''}

Estimate the portfolio impact, identify most vulnerable positions, and recommend hedging actions.`;

  const raw = await callModel(systemPrompt, userPrompt);
  return parseAnalysisResponse(raw);
}

/**
 * Analyze whether to trim or exit a specific holding.
 */
export async function analyzeTrimDecision(
  symbol: string,
  holdingContext: {
    weight: number;
    costBasis: number;
    currentPrice: number;
    pnlPct: number;
    holdingPeriod: string;
    sector: string;
    analystConsensus?: string;
    recentNews?: string[];
  },
  portfolioContext: PortfolioContext
): Promise<AnalysisResult> {
  const systemPrompt = `You are a senior portfolio manager evaluating whether to trim, hold, or add to a position.
Consider: fundamental thesis, valuation, momentum, portfolio concentration, tax implications, and opportunity cost.
Think through the bull and bear cases before making a recommendation.
Return JSON:
{
  "analysis": "detailed decision rationale",
  "chainOfThought": ["consideration 1", "consideration 2", ...],
  "confidence": 0.0-1.0,
  "recommendations": ["recommended action with specific size"]
}`;

  const userPrompt = `Should we trim ${symbol}?

**Position:**
- Weight: ${holdingContext.weight}%
- Cost basis: ${holdingContext.costBasis} → Current: ${holdingContext.currentPrice} (${holdingContext.pnlPct > 0 ? '+' : ''}${holdingContext.pnlPct.toFixed(1)}%)
- Holding period: ${holdingContext.holdingPeriod}
- Sector: ${holdingContext.sector}
${holdingContext.analystConsensus ? `- Analyst consensus: ${holdingContext.analystConsensus}` : ''}
${holdingContext.recentNews?.length ? `- Recent news: ${holdingContext.recentNews.join('; ')}` : ''}

**Portfolio context:**
- AUM: ${portfolioContext.totalAUM}
- Benchmark: ${portfolioContext.benchmarkIndex}
- Holdings: ${portfolioContext.holdings.length}

Provide a thorough analysis with a clear recommendation.`;

  const raw = await callModel(systemPrompt, userPrompt);
  return parseAnalysisResponse(raw);
}

/**
 * Challenge all holdings — the "devil's advocate" analysis.
 */
export async function challengeHoldings(
  portfolio: PortfolioContext,
  userPreferences?: string
): Promise<AnalysisResult> {
  const systemPrompt = `You are a critical investment analyst challenging every position in a portfolio.
For each holding, present the bear case: what could go wrong, what the market is pricing in that we might be wrong about.
Be provocative but grounded in evidence. Flag concentration risks, crowded trades, and thesis drift.
Return JSON:
{
  "analysis": "holding-by-holding challenge",
  "chainOfThought": ["challenge logic 1", "challenge logic 2", ...],
  "confidence": 0.0-1.0,
  "recommendations": ["trim X because...", "watch Y closely because...", ...]
}`;

  const userPrompt = `Challenge these holdings:

**Portfolio:**
${JSON.stringify(portfolio.holdings, null, 2)}

**AUM:** ${portfolio.totalAUM}
**Benchmark:** ${portfolio.benchmarkIndex}
${userPreferences ? `\n**PM preferences to consider:** ${userPreferences}` : ''}

Be the devil's advocate. For each material position, present the strongest bear case.`;

  const raw = await callModel(systemPrompt, userPrompt);
  return parseAnalysisResponse(raw);
}

/**
 * Run scenario analysis across multiple macro paths.
 */
export async function analyzeScenarios(
  portfolio: PortfolioContext,
  scenarios: MarketScenario[]
): Promise<AnalysisResult> {
  const systemPrompt = `You are a macro strategist running scenario analysis on a portfolio.
For each scenario, estimate probability-weighted returns and identify optimal portfolio adjustments.
Aggregate into a risk/return cone and provide portfolio-level recommendations.
Return JSON:
{
  "analysis": "scenario-by-scenario analysis with probability-weighted aggregate",
  "chainOfThought": ["reasoning for scenario 1", "reasoning for scenario 2", ...],
  "confidence": 0.0-1.0,
  "recommendations": ["portfolio adjustment 1", ...]
}`;

  const userPrompt = `Run scenario analysis:

**Portfolio:**
${JSON.stringify(portfolio.holdings, null, 2)}

**Scenarios:**
${scenarios.map(s => `- ${s.name} (${s.probability ? (s.probability * 100).toFixed(0) + '%' : 'unknown probability'}): ${s.description}`).join('\n')}

Estimate the impact of each scenario and recommend portfolio adjustments.`;

  const raw = await callModel(systemPrompt, userPrompt);
  return parseAnalysisResponse(raw);
}
