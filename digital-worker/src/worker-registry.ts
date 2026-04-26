// Portfolio Manager — Worker Registry & Intent Router
// Classifies user messages to the appropriate specialist worker.
// Uses keyword/pattern matching with LLM fallback for ambiguous cases.

import type { WorkerDefinition } from './agent-harness';
import {
  marketResearcher,
  riskAnalyst,
  trader,
  complianceOfficer,
  clientRelationship,
  commandCenter,
} from './worker-definitions';

// ── Intent Classification ──

export interface ClassificationResult {
  worker: WorkerDefinition;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

const PATTERNS: Array<{
  worker: WorkerDefinition;
  keywords: RegExp[];
  negativeKeywords?: RegExp[];
}> = [
  {
    worker: marketResearcher,
    keywords: [
      /\bquote\b/i,
      /\bprice\b/i,
      /\bnews\b/i,
      /\banalyst/i,
      /\bconsensus/i,
      /\bearnings/i,
      /\bresearch/i,
      /\bsector\b/i,
      /\bmarket\s+data/i,
      /\btechnical/i,
      /\bchart/i,
      /\bupgrade/i,
      /\bdowngrade/i,
      /\btarget\s+price/i,
      /\bwhat.*happening.*market/i,
      /\bwhat's.*trading/i,
      /\bdeep.dive/i,
      /\bfundamental/i,
    ],
  },
  {
    worker: riskAnalyst,
    keywords: [
      /\brisk/i,
      /\bstress\s*test/i,
      /\bscenario/i,
      /\bconcentration/i,
      /\bexposure/i,
      /\bVaR\b/i,
      /\bdrawdown/i,
      /\bhedg/i,
      /\bvolatility/i,
      /\bcorrelation/i,
      /\brate\s*shock/i,
      /\bchallenge/i,
      /\bshould\s+we\s+trim/i,
      /\bshould\s+we\s+sell/i,
      /\bshould\s+we\s+reduce/i,
      /\bhow\s+exposed/i,
      /\bworst\s+case/i,
      /\bdownside/i,
      /\bFX\s+exposure/i,
    ],
    negativeKeywords: [
      /\bclient.*risk/i,  // client risk tolerance → client-relationship
    ],
  },
  {
    worker: trader,
    keywords: [
      /\btrade\b/i,
      /\bbuy\b/i,
      /\bsell\b/i,
      /\bexecute/i,
      /\border\b/i,
      /\bposition\b/i,
      /\brebalance/i,
      /\brelative\s+value/i,
      /\bbenchmark/i,
      /\bsimulat/i,
      /\btrim\b/i,
      /\badd\s+to/i,
      /\bclose\s+position/i,
      /\bentry\s+point/i,
      /\bexit\b/i,
      /\bswitch\b/i,
      /\bswap\b/i,
    ],
  },
  {
    worker: complianceOfficer,
    keywords: [
      /\bcompliance/i,
      /\bregulat/i,
      /\blimit\s+breach/i,
      /\brestricted/i,
      /\baudit/i,
      /\bmandate/i,
      /\bguideline/i,
      /\bpolicy/i,
      /\bconcentration\s+limit/i,
      /\bcheck\s+limits/i,
    ],
  },
  {
    worker: clientRelationship,
    keywords: [
      /\bclient/i,
      /\bCRM\b/i,
      /\bmeeting/i,
      /\bpipeline/i,
      /\bopportunit/i,
      /\brelationship/i,
      /\bclient.*360/i,
      /\bbrief\b/i,
      /\breport\b/i,
      /\bprepare\b/i,
      /\bdraft\s+email/i,
      /\bsend\s+email/i,
      /\bcommunicat/i,
    ],
    negativeKeywords: [
      /\bmarket.*brief/i,  // market briefing → command-center
    ],
  },
];

/**
 * Classify a user message to determine which specialist worker should handle it.
 */
export function classifyIntent(message: string): ClassificationResult {
  const lower = message.toLowerCase();

  const scores = PATTERNS.map(({ worker, keywords, negativeKeywords }) => {
    let score = 0;
    const matchedKeywords: string[] = [];

    for (const pattern of keywords) {
      if (pattern.test(message)) {
        score++;
        matchedKeywords.push(pattern.source);
      }
    }

    if (negativeKeywords) {
      for (const pattern of negativeKeywords) {
        if (pattern.test(message)) score -= 0.5;
      }
    }

    return { worker, score, matchedKeywords };
  });

  scores.sort((a, b) => b.score - a.score);

  const best = scores[0];
  const secondBest = scores[1];

  // No matches → Command Center
  if (best.score === 0) {
    if (/briefing|morning|status|overview|summary|dashboard|portfolio/i.test(lower)) {
      return {
        worker: commandCenter,
        confidence: 'medium',
        reason: 'General portfolio overview request → Command Center',
      };
    }
    return {
      worker: commandCenter,
      confidence: 'low',
      reason: 'No domain-specific keywords detected → Command Center',
    };
  }

  // Multiple strong matches → cross-domain → Command Center
  if (secondBest && secondBest.score > 0 && best.score - secondBest.score <= 1) {
    return {
      worker: commandCenter,
      confidence: 'medium',
      reason: `Cross-domain request: ${best.worker.id} (${best.score}) + ${secondBest.worker.id} (${secondBest.score}) → Command Center`,
    };
  }

  const confidence = best.score >= 3 ? 'high' : best.score >= 2 ? 'medium' : 'low';
  return {
    worker: best.worker,
    confidence,
    reason: `Matched ${best.worker.name}: ${best.matchedKeywords.join(', ')}`,
  };
}

/**
 * Get a worker by ID.
 */
export function getWorkerById(id: string): WorkerDefinition | undefined {
  return PATTERNS.find(p => p.worker.id === id)?.worker ?? (id === 'command-center' ? commandCenter : undefined);
}
