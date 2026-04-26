/**
 * Purview Agent DLP — Data sensitivity classification and access control.
 * Classifies portfolio records by sensitivity level and enforces
 * label-aware tool access.
 *
 * Sensitivity levels (aligned with Microsoft Purview MIP labels):
 * - Public: Stock quotes, sector ETF data, market news
 * - Internal: Market data, analyst consensus, research
 * - Confidential: Trade orders, client portfolio values, deal pipeline, client PII
 * - Highly Confidential: Insider information, compliance records, audit trails
 */

export type SensitivityLabel = 'public' | 'internal' | 'confidential' | 'highly-confidential';

export interface ClassifiedRecord {
  recordId: string;
  table: string;
  sensitivityLabel: SensitivityLabel;
  piiDetected: boolean;
  restrictedFields: string[];
  classifiedAt: string;
}

// PII patterns for detection
const PII_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,          // SSN
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Credit card
  /\b[A-Z]{2}\d{6,9}\b/,              // Passport
  /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/, // Phone
  /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/, // Email (personal)
  /\b[A-Z]{2}\d{10}\b/,               // ISIN
  /\b\d{9}\b/,                         // CUSIP
  /\b\d{6,10}[A-Z]?\b/,               // Account number
];

// Field names that indicate sensitive data
const SENSITIVE_FIELDS = [
  'password', 'secret', 'token', 'api_key', 'credential',
  'ssn', 'social_security', 'credit_card', 'bank_account',
  'salary', 'compensation', 'account_number', 'isin', 'cusip',
  'portfolio_value', 'net_worth', 'deal_value',
];

// Tables/entities with default higher sensitivity
const TABLE_SENSITIVITY: Record<string, SensitivityLabel> = {
  'trade_orders': 'confidential',
  'client_portfolios': 'confidential',
  'client_contacts': 'confidential',
  'deal_pipeline': 'confidential',
  'market_quotes': 'public',
  'sector_etfs': 'public',
  'analyst_consensus': 'internal',
  'research_reports': 'internal',
  'news_feed': 'public',
  'compliance_records': 'highly-confidential',
  'audit_trail': 'highly-confidential',
  'insider_positions': 'highly-confidential',
  'ic_minutes': 'confidential',
};

/**
 * Classify a record by sensitivity.
 */
export function classifyRecord(
  table: string,
  record: Record<string, unknown>,
  recordId?: string,
): ClassifiedRecord {
  let label = TABLE_SENSITIVITY[table] || 'internal';
  let piiDetected = false;
  const restrictedFields: string[] = [];

  // Check for PII in field values
  for (const [field, value] of Object.entries(record)) {
    if (typeof value !== 'string') continue;

    // Check field name sensitivity
    if (SENSITIVE_FIELDS.some(sf => field.toLowerCase().includes(sf))) {
      restrictedFields.push(field);
      if (label === 'public' || label === 'internal') label = 'confidential';
    }

    // Check value for PII patterns
    for (const pattern of PII_PATTERNS) {
      if (pattern.test(value)) {
        piiDetected = true;
        restrictedFields.push(field);
        if (label === 'public' || label === 'internal') label = 'confidential';
        break;
      }
    }
  }

  // Insider trading / market manipulation content escalates to highly-confidential
  const textContent = JSON.stringify(record).toLowerCase();
  if (/insider.trading|material.non.public|mnpi|front.running|market.manipulation/i.test(textContent)) {
    label = 'highly-confidential';
  }

  return {
    recordId: recordId || (record.id as string) || 'unknown',
    table,
    sensitivityLabel: label,
    piiDetected,
    restrictedFields: [...new Set(restrictedFields)],
    classifiedAt: new Date().toISOString(),
  };
}

/**
 * Check if a tool operation is allowed given the record's sensitivity.
 * Blocks export/bulk operations on confidential+ records.
 */
export function isOperationAllowed(
  operation: 'read' | 'write' | 'export' | 'bulk_read',
  classification: ClassifiedRecord,
): { allowed: boolean; reason?: string } {
  if (classification.sensitivityLabel === 'public') {
    return { allowed: true };
  }

  if (classification.sensitivityLabel === 'internal') {
    if (operation === 'export') {
      return { allowed: false, reason: 'Export of internal records requires approval' };
    }
    return { allowed: true };
  }

  if (classification.sensitivityLabel === 'confidential') {
    if (operation === 'export' || operation === 'bulk_read') {
      return {
        allowed: false,
        reason: `${operation} blocked: record contains ${classification.piiDetected ? 'PII data' : 'confidential portfolio information'}`,
      };
    }
    return { allowed: true };
  }

  if (classification.sensitivityLabel === 'highly-confidential') {
    if (operation === 'read') {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `${operation} blocked: highly confidential record. Compliance team approval required.`,
    };
  }

  return { allowed: true };
}

/**
 * Redact PII from a record for safe display.
 */
export function redactPii(record: Record<string, unknown>, classification: ClassifiedRecord): Record<string, unknown> {
  if (classification.restrictedFields.length === 0) return record;

  const redacted = { ...record };
  for (const field of classification.restrictedFields) {
    if (field in redacted && typeof redacted[field] === 'string') {
      redacted[field] = '[REDACTED — PII]';
    }
  }
  return redacted;
}

/**
 * Get DLP status summary.
 */
export function getDlpStatus(): {
  enabled: boolean;
  sensitivityLevels: string[];
  piiPatternsCount: number;
  protectedTables: string[];
} {
  return {
    enabled: true,
    sensitivityLevels: ['public', 'internal', 'confidential', 'highly-confidential'],
    piiPatternsCount: PII_PATTERNS.length,
    protectedTables: Object.keys(TABLE_SENSITIVITY),
  };
}
