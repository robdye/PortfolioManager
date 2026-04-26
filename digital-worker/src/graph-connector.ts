/**
 * Portfolio Manager — Microsoft Graph Connector
 * Indexes portfolio data, research, and trade history into M365 Search & Copilot.
 */

import { Client } from '@microsoft/microsoft-graph-client';

// ── Types ──

export interface GraphConnectorConfig {
  connectionId: string;
  name: string;
  description: string;
}

export interface IndexItem {
  id: string;
  title: string;
  content: string;
  url?: string;
  itemType: 'research' | 'trade' | 'portfolio' | 'compliance' | 'meeting-note';
  metadata: Record<string, string>;
  lastModified: Date;
}

// ── Schema Definition ──

const PM_SCHEMA = {
  baseType: 'microsoft.graph.externalItem',
  properties: [
    { name: 'ticker', type: 'String', isSearchable: true, isRetrievable: true, isQueryable: true },
    { name: 'assetClass', type: 'String', isSearchable: true, isRetrievable: true, isQueryable: true },
    { name: 'itemType', type: 'String', isSearchable: false, isRetrievable: true, isQueryable: true },
    { name: 'author', type: 'String', isSearchable: true, isRetrievable: true },
    { name: 'rating', type: 'String', isSearchable: false, isRetrievable: true, isQueryable: true },
    { name: 'confidence', type: 'String', isSearchable: false, isRetrievable: true },
    { name: 'sector', type: 'String', isSearchable: true, isRetrievable: true, isQueryable: true },
    { name: 'region', type: 'String', isSearchable: true, isRetrievable: true, isQueryable: true },
    { name: 'lastModified', type: 'DateTime', isSearchable: false, isRetrievable: true, isQueryable: true },
  ],
};

// ── Connection Management ──

let graphClient: Client | null = null;
const CONNECTION_ID = process.env.GRAPH_CONNECTOR_ID || 'PortfolioManagerResearch';

function getGraphClient(): Client | null {
  if (graphClient) return graphClient;

  const token = process.env.GRAPH_CONNECTOR_TOKEN;
  if (!token) {
    console.log('[GraphConnector] No token configured — running in simulation mode');
    return null;
  }

  graphClient = Client.init({ authProvider: (done) => done(null, token) });
  return graphClient;
}

export async function createConnection(config?: Partial<GraphConnectorConfig>): Promise<{ connectionId: string; status: string }> {
  const client = getGraphClient();
  const connectionId = config?.connectionId || CONNECTION_ID;

  if (!client) {
    return { connectionId, status: 'simulated — no Graph token' };
  }

  try {
    await client.api('/external/connections').post({
      id: connectionId,
      name: config?.name || 'Portfolio Manager Research & Trades',
      description: config?.description || 'Investment research, trade history, portfolio data, and compliance reports indexed for Copilot.',
    });

    // Register schema
    await client.api(`/external/connections/${connectionId}/schema`).patch({ ...PM_SCHEMA });

    return { connectionId, status: 'created' };
  } catch (err: any) {
    if (err.statusCode === 409) return { connectionId, status: 'already-exists' };
    throw err;
  }
}

// ── Item Indexing ──

export async function indexItem(item: IndexItem): Promise<{ id: string; status: string }> {
  const client = getGraphClient();

  if (!client) {
    console.log(`[GraphConnector] Simulated index: ${item.itemType} — ${item.title}`);
    return { id: item.id, status: 'simulated' };
  }

  try {
    await client.api(`/external/connections/${CONNECTION_ID}/items/${item.id}`).put({
      acl: [{ type: 'everyone', value: 'everyone', accessType: 'grant' }],
      properties: {
        title: item.title,
        content: item.content,
        url: item.url,
        itemType: item.itemType,
        lastModified: item.lastModified.toISOString(),
        ...item.metadata,
      },
      content: { type: 'text', value: item.content },
    });

    return { id: item.id, status: 'indexed' };
  } catch (err) {
    console.error(`[GraphConnector] Index failed for ${item.id}:`, (err as Error).message);
    return { id: item.id, status: `error: ${(err as Error).message}` };
  }
}

export async function indexBatch(items: IndexItem[]): Promise<{ total: number; indexed: number; errors: number }> {
  let indexed = 0, errors = 0;

  for (const item of items) {
    const result = await indexItem(item);
    if (result.status === 'indexed' || result.status === 'simulated') indexed++;
    else errors++;
  }

  return { total: items.length, indexed, errors };
}

// ── Sync from Portfolio Data ──

export async function syncResearchNotes(notes: Array<{ id: string; ticker: string; title: string; body: string; author: string; date: Date }>): Promise<{ synced: number }> {
  const items: IndexItem[] = notes.map(n => ({
    id: `research-${n.id}`,
    title: `${n.ticker}: ${n.title}`,
    content: n.body,
    itemType: 'research' as const,
    metadata: { ticker: n.ticker, author: n.author },
    lastModified: n.date,
  }));

  const result = await indexBatch(items);
  return { synced: result.indexed };
}

export async function syncTradeHistory(trades: Array<{ id: string; ticker: string; side: string; quantity: number; price: number; date: Date }>): Promise<{ synced: number }> {
  const items: IndexItem[] = trades.map(t => ({
    id: `trade-${t.id}`,
    title: `${t.side.toUpperCase()} ${t.quantity} ${t.ticker} @ ${t.price}`,
    content: `Trade executed: ${t.side} ${t.quantity} shares of ${t.ticker} at $${t.price} on ${t.date.toISOString().split('T')[0]}`,
    itemType: 'trade' as const,
    metadata: { ticker: t.ticker },
    lastModified: t.date,
  }));

  const result = await indexBatch(items);
  return { synced: result.indexed };
}

export function getConnectorStatus(): { connectionId: string; configured: boolean } {
  return { connectionId: CONNECTION_ID, configured: !!process.env.GRAPH_CONNECTOR_TOKEN };
}
