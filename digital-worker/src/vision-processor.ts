/**
 * Portfolio Manager — Vision Processor
 * GPT-4o vision for broker PDFs, Bloomberg screenshots, term sheets, and charts.
 * Uses Azure Document Intelligence for structured extraction.
 */

import OpenAI from 'openai';
import { getOpenAIClient, getModelName, isAzureOpenAI } from './openai-config';

// ── Types ──

export type DocumentType = 'broker-research' | 'term-sheet' | 'bloomberg-screenshot' | 'chart' | 'fund-factsheet' | 'custom';

export interface VisionResult {
  documentType: DocumentType;
  extractedData: Record<string, unknown>;
  summary: string;
  confidence: number;
  rawText?: string;
  processingTimeMs: number;
}

interface ExtractionSchema {
  documentType: DocumentType;
  systemPrompt: string;
  fields: string[];
}

// ── Extraction Schemas ──

const SCHEMAS: ExtractionSchema[] = [
  {
    documentType: 'broker-research',
    systemPrompt: `You are a financial document analyst. Extract key data from this broker research report.
Return JSON with: ticker, company, rating (buy/hold/sell), targetPrice, currentPrice, analystName, firm, date, keyPoints (array), risks (array), thesis (string).`,
    fields: ['ticker', 'company', 'rating', 'targetPrice', 'currentPrice', 'analystName', 'firm', 'date', 'keyPoints', 'risks', 'thesis'],
  },
  {
    documentType: 'term-sheet',
    systemPrompt: `You are a financial document analyst. Extract key terms from this term sheet.
Return JSON with: issuer, instrument, currency, notional, maturity, coupon, spread, rating, settlementDate, structure, covenants (array).`,
    fields: ['issuer', 'instrument', 'currency', 'notional', 'maturity', 'coupon', 'spread', 'rating', 'settlementDate', 'structure', 'covenants'],
  },
  {
    documentType: 'bloomberg-screenshot',
    systemPrompt: `You are a market data analyst. Extract data from this Bloomberg terminal screenshot.
Return JSON with: ticker, lastPrice, change, changePercent, volume, bid, ask, open, high, low, marketCap, pe, dividend, fields (array of any other visible data points).`,
    fields: ['ticker', 'lastPrice', 'change', 'changePercent', 'volume', 'bid', 'ask', 'open', 'high', 'low', 'marketCap', 'pe', 'dividend'],
  },
  {
    documentType: 'chart',
    systemPrompt: `You are a technical analyst. Describe what you see in this financial chart.
Return JSON with: ticker, timeframe, chartType, trend (bullish/bearish/neutral), supportLevels (array), resistanceLevels (array), patterns (array), indicators (array), narrative (string).`,
    fields: ['ticker', 'timeframe', 'chartType', 'trend', 'supportLevels', 'resistanceLevels', 'patterns', 'indicators', 'narrative'],
  },
  {
    documentType: 'fund-factsheet',
    systemPrompt: `You are a fund analyst. Extract key data from this fund factsheet.
Return JSON with: fundName, isin, manager, aum, inception, benchmark, ytdReturn, oneYearReturn, threeYearReturn, fiveYearReturn, topHoldings (array), sectorAllocation (object), fees, riskRating.`,
    fields: ['fundName', 'isin', 'manager', 'aum', 'inception', 'benchmark', 'ytdReturn', 'oneYearReturn', 'threeYearReturn', 'fiveYearReturn', 'topHoldings', 'sectorAllocation', 'fees', 'riskRating'],
  },
];

// ── Core Processing ──

export async function processImage(
  imageData: string | Buffer,
  documentType: DocumentType = 'custom',
  customPrompt?: string,
): Promise<VisionResult> {
  const startTime = Date.now();
  const client = getOpenAIClient();

  const base64 = Buffer.isBuffer(imageData) ? imageData.toString('base64') : imageData;
  const schema = SCHEMAS.find(s => s.documentType === documentType);

  const systemPrompt = customPrompt || schema?.systemPrompt ||
    'You are a financial document analyst. Extract all relevant data from this image and return as structured JSON.';

  try {
    const response = await client.chat.completions.create({
      model: getModelName(),
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyse this image and extract the data as instructed.' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}`, detail: 'high' } },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content || '';
    const extractedData = parseJsonResponse(content);

    return {
      documentType,
      extractedData,
      summary: (extractedData as Record<string, string>)._summary || content.substring(0, 200),
      confidence: (extractedData as Record<string, number>)._confidence || estimateConfidence(extractedData, schema),
      rawText: content,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error('[Vision] Processing failed:', (err as Error).message);
    return {
      documentType,
      extractedData: { error: (err as Error).message },
      summary: `Vision processing failed: ${(err as Error).message}`,
      confidence: 0,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

export async function processDocument(
  documentUrl: string,
  documentType: DocumentType = 'broker-research',
): Promise<VisionResult> {
  const startTime = Date.now();
  const diEndpoint = process.env.DOCUMENT_INTELLIGENCE_ENDPOINT;
  const diKey = process.env.DOCUMENT_INTELLIGENCE_KEY;

  if (!diEndpoint || !diKey) {
    return {
      documentType,
      extractedData: { error: 'Document Intelligence not configured' },
      summary: 'Document Intelligence not configured — set DOCUMENT_INTELLIGENCE_ENDPOINT and DOCUMENT_INTELLIGENCE_KEY',
      confidence: 0,
      processingTimeMs: Date.now() - startTime,
    };
  }

  try {
    const analyzeResponse = await fetch(`${diEndpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': diKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ urlSource: documentUrl }),
    });

    if (!analyzeResponse.ok) {
      throw new Error(`DI analyze failed: ${analyzeResponse.status}`);
    }

    const operationUrl = analyzeResponse.headers.get('operation-location');
    if (!operationUrl) throw new Error('No operation-location header');

    let result: any;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollResponse = await fetch(operationUrl, { headers: { 'Ocp-Apim-Subscription-Key': diKey } });
      result = await pollResponse.json();
      if (result.status === 'succeeded') break;
      if (result.status === 'failed') throw new Error('DI analysis failed');
    }

    const extractedText = result?.analyzeResult?.content || '';
    const schema = SCHEMAS.find(s => s.documentType === documentType);

    const visionResult = await processTextWithLLM(extractedText, documentType, schema);

    return {
      ...visionResult,
      rawText: extractedText,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error('[Vision] Document processing failed:', (err as Error).message);
    return {
      documentType,
      extractedData: { error: (err as Error).message },
      summary: `Document processing failed: ${(err as Error).message}`,
      confidence: 0,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

async function processTextWithLLM(text: string, documentType: DocumentType, schema?: ExtractionSchema): Promise<VisionResult> {
  const startTime = Date.now();
  const client = getOpenAIClient();

  const systemPrompt = schema?.systemPrompt || 'Extract all relevant financial data and return as structured JSON.';

  const response = await client.chat.completions.create({
    model: getModelName(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Extract data from this document text:\n\n${text.substring(0, 8000)}` },
    ],
    max_tokens: 4096,
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content || '';
  const extractedData = parseJsonResponse(content);

  return {
    documentType,
    extractedData,
    summary: content.substring(0, 200),
    confidence: estimateConfidence(extractedData, schema),
    processingTimeMs: Date.now() - startTime,
  };
}

// ── Helpers ──

function parseJsonResponse(text: string): Record<string, unknown> {
  try {
    const jsonMatch = text.match(/```json?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]);
    return JSON.parse(text);
  } catch {
    return { rawResponse: text };
  }
}

function estimateConfidence(data: Record<string, unknown>, schema?: ExtractionSchema): number {
  if (!schema) return 0.5;
  const extracted = Object.keys(data).filter(k => !k.startsWith('_') && k !== 'rawResponse');
  return Math.min(1, extracted.length / schema.fields.length);
}

export function getSupportedDocumentTypes(): DocumentType[] {
  return SCHEMAS.map(s => s.documentType);
}
