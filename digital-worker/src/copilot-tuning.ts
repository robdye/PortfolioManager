/**
 * Portfolio Manager — Copilot Tuning Pipeline
 * Fine-tune a small model on the firm's investment memos, IC minutes, and house research
 * so the agent writes in the firm's voice and reflects its convictions.
 */

// ── Types ──

export interface TrainingExample {
  id: string;
  source: 'investment-memo' | 'ic-minutes' | 'house-research' | 'client-report' | 'trade-rationale';
  prompt: string;
  completion: string;
  metadata: {
    author?: string;
    date?: string;
    assetClass?: string;
    tags?: string[];
  };
}

export interface TuningJob {
  jobId: string;
  status: 'pending' | 'preparing' | 'training' | 'succeeded' | 'failed' | 'cancelled';
  modelName: string;
  exampleCount: number;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
  metrics?: { trainingLoss?: number; validationLoss?: number; epochs?: number };
}

export interface TuningConfig {
  baseModel: string;
  suffix: string;
  epochs?: number;
  batchSize?: number;
  learningRateMultiplier?: number;
}

// ── Training Data Extraction ──

const trainingExamples: TrainingExample[] = [];

export function addTrainingExample(example: Omit<TrainingExample, 'id'>): TrainingExample {
  const full: TrainingExample = {
    ...example,
    id: `te-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
  };
  trainingExamples.push(full);
  return full;
}

export function extractFromInvestmentMemo(memoText: string, metadata?: TrainingExample['metadata']): TrainingExample[] {
  const examples: TrainingExample[] = [];

  // Extract thesis sections
  const thesisMatch = memoText.match(/(?:thesis|investment case|rationale)[:\s]*\n?([\s\S]{50,500}?)(?:\n\n|\n[A-Z])/i);
  if (thesisMatch) {
    examples.push(addTrainingExample({
      source: 'investment-memo',
      prompt: 'Write an investment thesis for this position.',
      completion: thesisMatch[1].trim(),
      metadata: metadata || {},
    }));
  }

  // Extract risk sections
  const riskMatch = memoText.match(/(?:risks?|key concerns?)[:\s]*\n?([\s\S]{50,500}?)(?:\n\n|\n[A-Z])/i);
  if (riskMatch) {
    examples.push(addTrainingExample({
      source: 'investment-memo',
      prompt: 'What are the key risks for this position?',
      completion: riskMatch[1].trim(),
      metadata: metadata || {},
    }));
  }

  return examples;
}

export function extractFromICMinutes(minutesText: string, metadata?: TrainingExample['metadata']): TrainingExample[] {
  const examples: TrainingExample[] = [];

  // Extract decision points
  const decisions = minutesText.match(/(?:decision|resolved|agreed|action)[:\s]*\n?([\s\S]{30,300}?)(?:\n\n|\n[A-Z•\-])/gi);
  if (decisions) {
    for (const d of decisions.slice(0, 5)) {
      examples.push(addTrainingExample({
        source: 'ic-minutes',
        prompt: 'Summarise the IC decision on this item.',
        completion: d.replace(/^(?:decision|resolved|agreed|action)[:\s]*/i, '').trim(),
        metadata: metadata || {},
      }));
    }
  }

  return examples;
}

// ── Format for Fine-Tuning API ──

export function formatForOpenAI(examples: TrainingExample[]): string {
  return examples
    .map(e => JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a portfolio manager writing in the firm\'s house style.' },
        { role: 'user', content: e.prompt },
        { role: 'assistant', content: e.completion },
      ],
    }))
    .join('\n');
}

// ── Tuning Job Management ──

const jobs: TuningJob[] = [];

export async function createTuningJob(config: TuningConfig): Promise<TuningJob> {
  const examples = getTrainingExamples();
  if (examples.length < 10) {
    throw new Error(`Need at least 10 training examples, have ${examples.length}`);
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;

  const job: TuningJob = {
    jobId: `ftjob-${Date.now()}`,
    status: 'pending',
    modelName: `${config.baseModel}:ft-${config.suffix}`,
    exampleCount: examples.length,
    createdAt: new Date(),
  };

  if (endpoint && apiKey) {
    try {
      const trainingData = formatForOpenAI(examples);
      const blob = new Blob([trainingData], { type: 'application/jsonl' });

      // Upload training file
      const formData = new FormData();
      formData.append('file', blob, 'training.jsonl');
      formData.append('purpose', 'fine-tune');

      const uploadResp = await fetch(`${endpoint}/openai/files?api-version=2024-10-21`, {
        method: 'POST',
        headers: { 'api-key': apiKey },
        body: formData,
      });

      if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`);
      const uploadResult = await uploadResp.json() as Record<string, string>;

      // Create fine-tuning job
      const ftResp = await fetch(`${endpoint}/openai/fine_tuning/jobs?api-version=2024-10-21`, {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.baseModel,
          training_file: uploadResult.id,
          suffix: config.suffix,
          hyperparameters: {
            n_epochs: config.epochs || 3,
            batch_size: config.batchSize || 1,
            learning_rate_multiplier: config.learningRateMultiplier || 1.8,
          },
        }),
      });

      if (!ftResp.ok) throw new Error(`Fine-tune job creation failed: ${ftResp.status}`);
      const ftResult = await ftResp.json() as Record<string, string>;
      job.jobId = ftResult.id;
      job.status = 'preparing';
    } catch (err) {
      job.status = 'failed';
      job.error = (err as Error).message;
    }
  } else {
    // Simulated for demo
    job.status = 'succeeded';
    job.completedAt = new Date();
    job.metrics = { trainingLoss: 0.42, validationLoss: 0.51, epochs: 3 };
    console.log(`[Tuning] Simulated job ${job.jobId}: ${job.exampleCount} examples → ${job.modelName}`);
  }

  jobs.push(job);
  return job;
}

export function getTrainingExamples(): TrainingExample[] {
  return [...trainingExamples];
}

export function getTuningJobs(): TuningJob[] {
  return [...jobs];
}

export function getTuningStatus(): { exampleCount: number; jobCount: number; latestJob?: TuningJob } {
  return {
    exampleCount: trainingExamples.length,
    jobCount: jobs.length,
    latestJob: jobs[jobs.length - 1],
  };
}
