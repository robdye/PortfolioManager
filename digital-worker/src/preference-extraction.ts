// Portfolio Manager — Preference Extraction
// Extracts PM investment preferences and convictions from conversation text.
// Stores extracted preferences in Cosmos DB memory collection with provenance.
//
// Examples:
//   "I hate banks below 1x book" → { type: 'avoid', sector: 'banks', condition: 'P/B < 1.0' }
//   "Always tell me about earnings within 5 days" → { type: 'alert', event: 'earnings', window: '5d' }
//   "I'm bullish on UK gilts" → { type: 'conviction', asset: 'UK gilts', direction: 'bullish' }
//   "Never hold more than 5% in any single name" → { type: 'limit', metric: 'concentration', threshold: '5%' }

import { storeMemoryDocument, getUserMemory, MemoryDocument } from './cosmos-store';

// ── Types ──

export interface ExtractedPreference {
  type: 'avoid' | 'prefer' | 'alert' | 'conviction' | 'limit' | 'general';
  raw: string;
  sector?: string;
  asset?: string;
  condition?: string;
  direction?: 'bullish' | 'bearish' | 'neutral';
  event?: string;
  window?: string;
  metric?: string;
  threshold?: string;
  confidence: number; // 0-1
}

// ── Pattern Matching ──

const PREFERENCE_PATTERNS: Array<{
  pattern: RegExp;
  extract: (match: RegExpMatchArray, raw: string) => ExtractedPreference;
}> = [
  // "I hate/avoid/don't like [sector/asset]"
  {
    pattern: /\b(?:hate|avoid|don't like|never buy|stay away from)\b[^.]*\b(banks?|tech|energy|utilities|reits?|bonds?|gilts?|equities|crypto|commodities)\b/i,
    extract: (match, raw) => ({
      type: 'avoid',
      raw,
      sector: match[1].toLowerCase(),
      confidence: 0.85,
    }),
  },
  // "below/above Nx book/PE/yield"
  {
    pattern: /\b(below|above|under|over)\s+([\d.]+)x?\s*(book|p\/b|pe|p\/e|yield|div(?:idend)?)\b/i,
    extract: (match, raw) => ({
      type: 'limit',
      raw,
      condition: `${match[3].toUpperCase()} ${match[1].toLowerCase()} ${match[2]}`,
      metric: match[3].toLowerCase(),
      threshold: match[2],
      confidence: 0.80,
    }),
  },
  // "bullish/bearish on [asset]"
  {
    pattern: /\b(bullish|bearish|long|short|overweight|underweight)\b[^.]*\b(?:on\s+)?(.{3,40}?)(?:\.|$|,|\s-\s)/i,
    extract: (match, raw) => ({
      type: 'conviction',
      raw,
      asset: match[2].trim(),
      direction: /bullish|long|overweight/i.test(match[1]) ? 'bullish' : 'bearish',
      confidence: 0.75,
    }),
  },
  // "always tell me / alert me about [event]"
  {
    pattern: /\b(?:always|make sure to|don't forget to)\s+(?:tell|alert|notify|warn)\s+me\b[^.]*\b(earnings?|dividend|results?|upgrade|downgrade|news|rating)/i,
    extract: (match, raw) => ({
      type: 'alert',
      raw,
      event: match[1].toLowerCase(),
      confidence: 0.80,
    }),
  },
  // "within N days/hours"
  {
    pattern: /within\s+(\d+)\s*(days?|hours?|weeks?|d|h|w)\b/i,
    extract: (match, raw) => ({
      type: 'alert',
      raw,
      window: `${match[1]}${match[2][0]}`,
      confidence: 0.70,
    }),
  },
  // "never hold more than N%"
  {
    pattern: /\b(?:never|don't|limit|cap)\b[^.]*\b(?:more than|exceed|over)\s+([\d.]+)%/i,
    extract: (match, raw) => ({
      type: 'limit',
      raw,
      metric: 'concentration',
      threshold: `${match[1]}%`,
      confidence: 0.85,
    }),
  },
  // "I prefer/like/favour [sector/asset]"
  {
    pattern: /\b(?:prefer|like|favour|favor|love)\b[^.]*\b(banks?|tech|energy|utilities|reits?|bonds?|gilts?|equities|quality|value|growth|momentum)\b/i,
    extract: (match, raw) => ({
      type: 'prefer',
      raw,
      sector: match[1].toLowerCase(),
      confidence: 0.75,
    }),
  },
];

/**
 * Extract preferences from a conversation message.
 * Returns all matched preferences with confidence scores.
 */
export function extractPreferences(text: string): ExtractedPreference[] {
  const results: ExtractedPreference[] = [];

  for (const { pattern, extract } of PREFERENCE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      results.push(extract(match, text.substring(0, 200)));
    }
  }

  return results;
}

/**
 * Extract and persist preferences from a user message.
 * Call this on every user message to build up the preference profile.
 */
export async function extractAndStore(
  userId: string,
  conversationId: string,
  text: string,
  minConfidence = 0.7,
): Promise<ExtractedPreference[]> {
  const preferences = extractPreferences(text).filter(p => p.confidence >= minConfidence);

  for (const pref of preferences) {
    const doc: MemoryDocument = {
      id: `pref-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      userId,
      category: pref.type === 'conviction' ? 'conviction' : 'preference',
      content: JSON.stringify(pref),
      provenance: {
        conversationId,
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    };
    await storeMemoryDocument(doc);
  }

  if (preferences.length > 0) {
    console.log(`[PreferenceExtraction] Extracted ${preferences.length} preference(s) for user ${userId}`);
  }

  return preferences;
}

/**
 * Get all stored preferences for a user.
 */
export async function getUserPreferences(userId: string): Promise<ExtractedPreference[]> {
  const docs = await getUserMemory(userId, 'preference');
  return docs.map(d => {
    try {
      return JSON.parse(d.content) as ExtractedPreference;
    } catch {
      return null;
    }
  }).filter((p): p is ExtractedPreference => p !== null);
}

/**
 * Get all stored convictions for a user.
 */
export async function getUserConvictions(userId: string): Promise<ExtractedPreference[]> {
  const docs = await getUserMemory(userId, 'conviction');
  return docs.map(d => {
    try {
      return JSON.parse(d.content) as ExtractedPreference;
    } catch {
      return null;
    }
  }).filter((p): p is ExtractedPreference => p !== null);
}

/**
 * Format preferences into a system prompt fragment for the agent.
 */
export async function getPreferencePrompt(userId: string): Promise<string> {
  const [prefs, convictions] = await Promise.all([
    getUserPreferences(userId),
    getUserConvictions(userId),
  ]);

  if (prefs.length === 0 && convictions.length === 0) return '';

  const lines: string[] = ['## PM Preferences & Convictions'];

  if (prefs.length > 0) {
    lines.push('### Preferences:');
    for (const p of prefs) {
      const parts = [p.raw];
      if (p.condition) parts.push(`(${p.condition})`);
      lines.push(`- ${parts.join(' ')}`);
    }
  }

  if (convictions.length > 0) {
    lines.push('### Active Convictions:');
    for (const c of convictions) {
      lines.push(`- ${c.direction?.toUpperCase() || 'VIEW'}: ${c.asset || c.sector || c.raw}`);
    }
  }

  return lines.join('\n');
}
