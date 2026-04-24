// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Portfolio Manager Digital Worker — News search service
// Combines Finnhub MCP company news with Bing web search

import { mcpClient } from './mcp-client';

interface NewsItem {
  source: string;
  headline: string;
  summary?: string;
  url?: string;
  datetime?: string;
  ticker?: string;
}

/**
 * Search for company news using Finnhub MCP + web search.
 */
export async function searchCompanyNews(ticker: string, company: string): Promise<NewsItem[]> {
  const results: NewsItem[] = [];

  // 1. Finnhub MCP company news
  try {
    const finnhubNews = await mcpClient.getCompanyNews(ticker);
    if (finnhubNews && typeof finnhubNews === 'string') {
      // Parse the HTML response for news data (embedded in __TOOL_DATA__)
      const dataMatch = (finnhubNews as string).match(/window\.__TOOL_DATA__\s*=\s*({[\s\S]*?});\s*<\/script>/);
      if (dataMatch) {
        try {
          const data = JSON.parse(dataMatch[1]);
          if (data.news && Array.isArray(data.news)) {
            data.news.slice(0, 5).forEach((n: any) => {
              results.push({
                source: 'Finnhub',
                headline: n.headline || n.title,
                summary: n.summary,
                url: n.url,
                datetime: n.datetime ? new Date(n.datetime * 1000).toISOString() : undefined,
                ticker,
              });
            });
          }
        } catch { /* parse error, skip */ }
      }
    }
  } catch (err) {
    console.warn(`[News] Finnhub news fetch failed for ${ticker}:`, (err as Error).message);
  }

  // 2. Bing Web Search (if BING_SEARCH_API_KEY is configured)
  const bingKey = process.env.BING_SEARCH_API_KEY;
  if (bingKey) {
    try {
      const query = encodeURIComponent(`${company} ${ticker} stock news`);
      const res = await fetch(
        `https://api.bing.microsoft.com/v7.0/news/search?q=${query}&count=5&freshness=Week&mkt=en-US`,
        { headers: { 'Ocp-Apim-Subscription-Key': bingKey } }
      );
      if (res.ok) {
        const data = await res.json() as any;
        if (data.value) {
          data.value.forEach((n: any) => {
            results.push({
              source: 'Bing',
              headline: n.name,
              summary: n.description,
              url: n.url,
              datetime: n.datePublished,
              ticker,
            });
          });
        }
      }
    } catch (err) {
      console.warn(`[News] Bing search failed for ${company}:`, (err as Error).message);
    }
  }

  return results;
}

/**
 * Search market-wide news from Finnhub.
 */
export async function searchMarketNews(): Promise<NewsItem[]> {
  const results: NewsItem[] = [];

  try {
    const news = await mcpClient.getMarketNews();
    if (news && typeof news === 'string') {
      const dataMatch = (news as string).match(/window\.__TOOL_DATA__\s*=\s*({[\s\S]*?});\s*<\/script>/);
      if (dataMatch) {
        try {
          const data = JSON.parse(dataMatch[1]);
          if (data.news && Array.isArray(data.news)) {
            data.news.slice(0, 10).forEach((n: any) => {
              results.push({
                source: 'Finnhub',
                headline: n.headline || n.title,
                summary: n.summary,
                url: n.url,
                datetime: n.datetime ? new Date(n.datetime * 1000).toISOString() : undefined,
              });
            });
          }
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    console.warn('[News] Market news fetch failed:', (err as Error).message);
  }

  return results;
}

/**
 * Get news for multiple tickers in parallel.
 */
export async function searchPortfolioNews(
  holdings: Array<{ ticker: string; company: string }>
): Promise<Map<string, NewsItem[]>> {
  const newsMap = new Map<string, NewsItem[]>();
  const results = await Promise.allSettled(
    holdings.map(h => searchCompanyNews(h.ticker, h.company))
  );
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.length > 0) {
      newsMap.set(holdings[i].ticker, r.value);
    }
  });
  return newsMap;
}
