// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — Briefing prompt template

/**
 * Generate the structured morning briefing prompt.
 * This is shared between the Teams message handler and the scheduled email briefing.
 */
export function buildBriefingPrompt(data: {
  holdings: unknown;
  pipeline: unknown;
  quotes: Array<{ ticker: string; data: unknown }>;
}): string {
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  // Trim holdings to essential fields only (avoid massive Dataverse JSON)
  let holdingsSummary = 'unavailable';
  try {
    let arr: any[] = [];
    if (typeof data.holdings === 'string') {
      const match = (data.holdings as string).match(/\[[\s\S]*\]/);
      if (match) arr = JSON.parse(match[0]);
    } else if (Array.isArray(data.holdings)) {
      arr = data.holdings;
    }
    if (arr.length > 0) {
      holdingsSummary = JSON.stringify(arr.map((h: any) => ({
        Ticker: h.Ticker, Company: h.Company, Sector: h.Sector,
        Shares: h.Shares, Type: h.Type, CurrencyExposure: h.CurrencyExposure || '',
      })));
    }
  } catch { /* use unavailable */ }

  // Trim pipeline to key deal fields only
  let pipelineSummary = 'unavailable';
  try {
    if (data.pipeline && typeof data.pipeline === 'string' && data.pipeline.length > 5000) {
      pipelineSummary = data.pipeline.substring(0, 5000) + '... (truncated)';
    } else if (data.pipeline) {
      pipelineSummary = typeof data.pipeline === 'string' ? data.pipeline : JSON.stringify(data.pipeline).substring(0, 5000);
    }
  } catch { /* use unavailable */ }

  return `You are producing a Morning Briefing for ${today}. Use the real portfolio data provided below.

=== REAL PORTFOLIO DATA ===
HOLDINGS: ${holdingsSummary}
CRM PIPELINE (Prospects & Clients): ${pipelineSummary}
MARKET DATA: ${JSON.stringify(data.quotes)}

=== BRIEFING FORMAT — FOLLOW EXACTLY ===

**1. Industry Overview**
Focus on financial services, wealth platforms, AI-driven innovation. Only last 14 days.
Include direct links for all cited stories. Cover key market moves and sector trends.

**2. Prospects Section**
From the CRM pipeline data above, identify companies in prospect/qualify stages.
Search for recent news for each prospect company. Include ONLY prospects with relevant news.
For each company with news, format as:
### COMPANY — $PRICE ↑/↓
- Concise bullet points with context
- Group related updates together
Add prospects with no material news to the Appendix.

**3. Clients Section**
From the portfolio holdings data, identify current holdings (Shares > 0) as clients.
Search for recent news for each holding. Include ONLY clients with relevant news.
For each company with news, format as:
### COMPANY (TICKER) — $PRICE ↑/↓
- Use the market data provided to show real prices
- Concise bullet points on material developments
Add clients with no material news to the Appendix.

**4. C-Suite & Leadership Moves**
Any executive appointments, departures, or board changes across holdings and prospects.

**5. Overall Commentary**
Executive summary synthesising trends for portfolio positioning. 2-3 paragraphs max.
Strategic implications and recommended actions.

**6. In the News — Microsoft**
Search for recent Microsoft stories relevant to financial services, AI, and enterprise:
- Azure AI / Copilot developments
- Financial services partnerships
- Regulatory or market-moving announcements

**7. Appendix**
List companies searched with no material news, grouped into:
- **Prospects**: [list]
- **Clients**: [list]

=== SHARE PRICE RULES ===
- Use the market data provided to show current prices
- Compare with 7 days ago using the 5DayPriceReturnDaily metric
- Show ↑ for positive, ↓ for negative

=== EDITORIAL GUIDELINES ===
- Executive tone: factual, concise, strategic
- No duplication across sections
- No speculation or sensational language
- No unreliable sources
- Only meaningful developments for senior leaders
- If no relevant updates for a company: DO NOT create a section — list in Appendix
- Use real company names, tickers, and prices from the data above — never use placeholders`;
}
