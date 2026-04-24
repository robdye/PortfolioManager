// Portfolio Manager Digital Worker — Security Hardening
//
// Inspired by CorpGen's security patterns:
//   - Input sanitization (5 pattern categories)
//   - Timing-safe comparison for secrets
//   - Rate limiting per endpoint
//   - PII redaction in logs
//   - Prompt injection detection

import { timingSafeEqual, createHash } from 'crypto';
import { Request, Response, NextFunction } from 'express';

// ── Timing-Safe Secret Comparison ───────────────────────────────────

export function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

// ── Input Sanitization ──────────────────────────────────────────────

// Pattern categories for sanitization
const DANGEROUS_PATTERNS = [
  // Script injection
  /<script[\s>]/i,
  /javascript:/i,
  /on\w+\s*=/i,                       // onclick=, onerror=, etc.
  // SQL injection patterns
  /('|--|;|\bUNION\b|\bSELECT\b|\bDROP\b|\bDELETE\b|\bINSERT\b|\bUPDATE\b.*\bSET\b)/i,
  // Path traversal
  /\.\.[/\\]/,
  // Command injection
  /[;&|`$](?![\s])/,
  // Template injection
  /\{\{.*\}\}/,
  /\$\{.*\}/,
];

export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') return '';
  // Remove null bytes
  let clean = input.replace(/\0/g, '');
  // Trim to reasonable length (10KB max for any single input)
  clean = clean.substring(0, 10240);
  return clean;
}

export function detectInjection(input: string): { safe: boolean; matched?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(input)) {
      return { safe: false, matched: pattern.source };
    }
  }
  return { safe: true };
}

// ── Prompt Injection Detection ──────────────────────────────────────

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(previous|above|all)\s+(instructions?|prompts?)/i,
  /you\s+are\s+now\s+a/i,
  /disregard\s+(your|the)\s+(system|original)/i,
  /new\s+instructions?:/i,
  /system\s*:\s*you\s+are/i,
  /\bDAN\b.*\bjailbreak\b/i,
  /act\s+as\s+(if\s+)?you\s+(have\s+)?no\s+(restrictions|rules)/i,
];

export function detectPromptInjection(input: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some(p => p.test(input));
}

// ── Rate Limiter ────────────────────────────────────────────────────

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

export interface RateLimitConfig {
  windowMs: number;    // Time window in ms
  maxRequests: number; // Max requests per window
}

const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  '/api/messages': { windowMs: 60_000, maxRequests: 30 },
  '/api/scheduled': { windowMs: 60_000, maxRequests: 10 },
  '/api/analytics': { windowMs: 10_000, maxRequests: 20 },
  default: { windowMs: 60_000, maxRequests: 60 },
};

export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  // Find matching limit config
  const path = Object.keys(DEFAULT_LIMITS).find(p => req.path.startsWith(p)) || 'default';
  const config = DEFAULT_LIMITS[path];

  // Key by IP + path prefix
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const key = `${ip}:${path}`;

  const now = Date.now();
  let bucket = rateBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + config.windowMs };
    rateBuckets.set(key, bucket);
  }

  bucket.count++;

  if (bucket.count > config.maxRequests) {
    res.status(429).json({
      error: 'Too many requests',
      retryAfterMs: bucket.resetAt - now,
    });
    return;
  }

  // Clean up old buckets periodically
  if (rateBuckets.size > 1000) {
    for (const [k, b] of rateBuckets.entries()) {
      if (now >= b.resetAt) rateBuckets.delete(k);
    }
  }

  next();
}

// ── PII Redaction ───────────────────────────────────────────────────

const PII_PATTERNS = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL]' },
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, replacement: '[PHONE]' },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[CARD]' },
];

export function redactPII(text: string): string {
  let redacted = text;
  for (const { pattern, replacement } of PII_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

// ── Secure Headers Middleware ───────────────────────────────────────

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Mission Control is a self-contained HTML page with inline styles/scripts
  if (req.path === '/mission-control') {
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'");
  } else {
    res.setHeader('Content-Security-Policy', "default-src 'self'");
  }
  res.removeHeader('X-Powered-By');
  next();
}
