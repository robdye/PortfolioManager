// Content Safety — Azure AI Content Safety middleware for prompt shield protection

import ContentSafetyClient, { isUnexpected } from '@azure-rest/ai-content-safety';
import { DefaultAzureCredential } from '@azure/identity';

export interface ContentSafetyResult {
  safe: boolean;
  categories: {
    hate: number;
    violence: number;
    selfHarm: number;
    sexual: number;
  };
  blocked: boolean;
  reason?: string;
}

const PASS_THROUGH_RESULT: ContentSafetyResult = {
  safe: true,
  categories: { hate: 0, violence: 0, selfHarm: 0, sexual: 0 },
  blocked: false,
};

const BLOCKED_MISCONFIGURED: ContentSafetyResult = {
  safe: false,
  categories: { hate: 0, violence: 0, selfHarm: 0, sexual: 0 },
  blocked: true,
  reason: 'Content safety service misconfigured — failing closed for security',
};

// When true, content safety blocks on ANY service error (recommended for production)
const CONTENT_SAFETY_REQUIRED = process.env.CONTENT_SAFETY_REQUIRED === 'true';

function getClient() {
  const endpoint = process.env.CONTENT_SAFETY_ENDPOINT;
  if (!endpoint) return null;

  const key = process.env.CONTENT_SAFETY_KEY;
  if (key) {
    return ContentSafetyClient(endpoint, { key } as any);
  }
  return ContentSafetyClient(endpoint, new DefaultAzureCredential());
}

function redactSnippet(text: string, maxLen = 50): string {
  const snippet = text.substring(0, maxLen).replace(/\n/g, ' ');
  return snippet.length < text.length ? `${snippet}…` : snippet;
}

/**
 * Analyze input text for content safety violations and prompt injection attempts.
 */
export async function analyzeInput(text: string): Promise<ContentSafetyResult> {
  const client = getClient();
  if (!client) return PASS_THROUGH_RESULT;

  try {
    // Text content analysis
    const analysisResult = await analyzeText(client, text);
    if (!analysisResult.safe) {
      console.warn(`[ContentSafety] Input blocked (${analysisResult.reason}): "${redactSnippet(text)}"`);
      return analysisResult;
    }

    // Prompt Shield — jailbreak / injection detection
    const shieldResult = await checkPromptShield(client, text);
    if (!shieldResult.safe) {
      console.warn(`[ContentSafety] Input blocked by Prompt Shield (${shieldResult.reason}): "${redactSnippet(text)}"`);
      return shieldResult;
    }

    return analysisResult;
  } catch (err) {
    const message = (err as Error).message || '';
    console.error('[ContentSafety] Input analysis error:', message);
    if (CONTENT_SAFETY_REQUIRED || /401|403|Unauthorized|Forbidden/.test(message)) {
      return BLOCKED_MISCONFIGURED;
    }
    return PASS_THROUGH_RESULT;
  }
}

/**
 * Analyze output text for content safety violations.
 */
export async function analyzeOutput(text: string): Promise<ContentSafetyResult> {
  const client = getClient();
  if (!client) return PASS_THROUGH_RESULT;

  try {
    const result = await analyzeText(client, text);
    if (!result.safe) {
      console.warn(`[ContentSafety] Output blocked (${result.reason}): "${redactSnippet(text)}"`);
    }
    return result;
  } catch (err) {
    const message = (err as Error).message || '';
    console.error('[ContentSafety] Output analysis error:', message);
    if (CONTENT_SAFETY_REQUIRED || /401|403|Unauthorized|Forbidden/.test(message)) {
      return BLOCKED_MISCONFIGURED;
    }
    return PASS_THROUGH_RESULT;
  }
}

async function analyzeText(client: ReturnType<typeof ContentSafetyClient>, text: string): Promise<ContentSafetyResult> {
  const response = await client.path('/text:analyze').post({
    body: {
      text,
      categories: ['Hate', 'Violence', 'SelfHarm', 'Sexual'],
    },
  });

  if (isUnexpected(response)) {
    throw new Error(`Content Safety API error: ${response.status}`);
  }

  const body = response.body;
  const categories = {
    hate: 0,
    violence: 0,
    selfHarm: 0,
    sexual: 0,
  };

  const blockedCategories: string[] = [];

  if (body.categoriesAnalysis) {
    for (const cat of body.categoriesAnalysis) {
      const severity = cat.severity ?? 0;
      switch (cat.category) {
        case 'Hate': categories.hate = severity; break;
        case 'Violence': categories.violence = severity; break;
        case 'SelfHarm': categories.selfHarm = severity; break;
        case 'Sexual': categories.sexual = severity; break;
      }
      if (severity >= 2) {
        blockedCategories.push(cat.category);
      }
    }
  }

  const blocked = blockedCategories.length > 0;
  return {
    safe: !blocked,
    categories,
    blocked,
    reason: blocked ? `Content flagged for: ${blockedCategories.join(', ')}` : undefined,
  };
}

async function checkPromptShield(client: ReturnType<typeof ContentSafetyClient>, text: string): Promise<ContentSafetyResult> {
  try {
    const response = await (client as any).pathUnchecked('/text:shieldPrompt').post({
      body: {
        userPrompt: text,
      },
    });

    if (response.status !== '200') {
      throw new Error(`Prompt Shield API error: ${response.status}`);
    }

    const body = response.body;
    const attackDetected =
      body.userPromptAnalysis?.attackDetected === true;

    return {
      safe: !attackDetected,
      categories: { hate: 0, violence: 0, selfHarm: 0, sexual: 0 },
      blocked: attackDetected,
      reason: attackDetected ? 'Prompt injection or jailbreak attempt detected' : undefined,
    };
  } catch (err) {
    console.error('[ContentSafety] Prompt Shield check failed:', (err as Error).message);
    return PASS_THROUGH_RESULT;
  }
}
