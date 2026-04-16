import type { FindingSeverity, TypedFinding, VerdictFile } from './types.js';

// ---------------------------------------------------------------------------
// Validation helpers — hand-written, no Zod dependency
// ---------------------------------------------------------------------------

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  'blocking',
  'major',
  'minor',
  'suggestion',
]);

const VALID_VERDICTS: ReadonlySet<string> = new Set([
  'SHIP',
  'REVISE',
  'RETHINK',
]);

const VALID_GATES: ReadonlySet<string> = new Set([
  'spec_compliance',
  'code_quality',
]);

export function isValidSeverity(s: string): s is FindingSeverity {
  return VALID_SEVERITIES.has(s);
}

export function isValidVerdict(v: string): v is 'SHIP' | 'REVISE' | 'RETHINK' {
  return VALID_VERDICTS.has(v);
}

export function isValidGate(g: string): g is 'spec_compliance' | 'code_quality' {
  return VALID_GATES.has(g);
}

/** Validate and narrow a finding from sub-agent output. Returns null if invalid. */
export function validateFinding(raw: unknown): TypedFinding | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const severity = String(obj.severity ?? '');
  if (!isValidSeverity(severity)) return null;

  const description = String(obj.description ?? '');
  if (!description) return null;

  return {
    severity,
    description,
    file: String(obj.file ?? ''),
    line: typeof obj.line === 'number' ? obj.line : null,
  };
}

/** Validate a verdict file structure before writing to disk. Throws on invalid. */
export function validateVerdictFile(data: VerdictFile): void {
  if (typeof data.task_id !== 'number') {
    throw new Error('VerdictFile: task_id must be a number');
  }
  if (!isValidVerdict(data.verdict)) {
    throw new Error(`VerdictFile: invalid verdict "${data.verdict}"`);
  }
  if (!isValidGate(data.gate)) {
    throw new Error(`VerdictFile: invalid gate "${data.gate}"`);
  }
  if (typeof data.round !== 'number' || data.round < 0) {
    throw new Error(`VerdictFile: invalid round ${data.round}`);
  }
  if (!data.timestamp) {
    throw new Error('VerdictFile: timestamp is required');
  }
  const summary = data.findings_summary;
  if (
    typeof summary?.blocking !== 'number' ||
    typeof summary?.major !== 'number' ||
    typeof summary?.minor !== 'number' ||
    typeof summary?.suggestion !== 'number'
  ) {
    throw new Error('VerdictFile: findings_summary must have numeric blocking/major/minor/suggestion');
  }
}
