import type { TypedFinding, FindingSeverity } from '../types.js';
import { isValidSeverity } from '../validate.js';

/**
 * Parse a reviewer sub-agent's structured markdown output into typed findings.
 *
 * Expected output format from the reviewer:
 *
 * ## Strengths
 * - ...
 *
 * ## Issues
 * - [blocking] Description here | file.ts:42
 * - [major] Another issue | other.ts:10
 *
 * ## Missing
 * - [major] Missing requirement X
 *
 * ## Verdict
 * SHIP | REVISE | RETHINK
 */
export function parseReviewOutput(output: string): ParsedReviewOutput {
  const findings: TypedFinding[] = [];
  let verdict: 'SHIP' | 'REVISE' | 'RETHINK' | null = null;

  // Extract verdict
  const verdictMatch = output.match(/##\s*Verdict\s*\n+(SHIP|REVISE|RETHINK)/im);
  if (verdictMatch) {
    verdict = verdictMatch[1].toUpperCase() as 'SHIP' | 'REVISE' | 'RETHINK';
  }

  // Extract findings from Issues and Missing sections
  const sections = ['Issues', 'Missing'];
  for (const section of sections) {
    const sectionRegex = new RegExp(
      `##\\s*${section}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
      'i',
    );
    const sectionMatch = output.match(sectionRegex);
    if (!sectionMatch) continue;

    const lines = sectionMatch[1].split('\n');
    for (const line of lines) {
      const finding = parseFindingLine(line.trim());
      if (finding) findings.push(finding);
    }
  }

  return { findings, verdict };
}

/**
 * Parse a single finding line.
 *
 * Supported formats:
 * - [severity] description | file:line
 * - [severity] description (file:line)
 * - [severity] description
 * - **severity**: description | file:line
 */
export function parseFindingLine(line: string): TypedFinding | null {
  if (!line || line.startsWith('#')) return null;

  // Strip leading bullet markers
  const stripped = line.replace(/^[-*•]\s*/, '');
  if (!stripped) return null;

  // Pattern 1: [severity] description | file:line
  const bracketMatch = stripped.match(
    /^\[(\w+)]\s+(.+?)(?:\s*[|]\s*(.+?))?$/,
  );
  if (bracketMatch) {
    const severity = normalizeSeverity(bracketMatch[1]);
    if (!severity) return null;
    const { file, line: lineNum } = parseFileRef(bracketMatch[3]);
    return {
      severity,
      description: bracketMatch[2].trim(),
      file,
      line: lineNum,
    };
  }

  // Pattern 2: **severity**: description | file:line
  const boldMatch = stripped.match(
    /^\*\*(\w+)\*\*:?\s+(.+?)(?:\s*[|]\s*(.+?))?$/,
  );
  if (boldMatch) {
    const severity = normalizeSeverity(boldMatch[1]);
    if (!severity) return null;
    const { file, line: lineNum } = parseFileRef(boldMatch[3]);
    return {
      severity,
      description: boldMatch[2].trim(),
      file,
      line: lineNum,
    };
  }

  return null;
}

/** Parse a "file:line" reference. */
function parseFileRef(ref: string | undefined): { file: string; line: number | null } {
  if (!ref) return { file: '', line: null };

  const parts = ref.trim().match(/^(.+?):(\d+)$/);
  if (parts) {
    return { file: parts[1], line: parseInt(parts[2], 10) };
  }

  return { file: ref.trim(), line: null };
}

/** Normalize severity strings to valid FindingSeverity values. */
function normalizeSeverity(raw: string): FindingSeverity | null {
  const lower = raw.toLowerCase();

  // Direct matches
  if (isValidSeverity(lower)) return lower;

  // Common aliases
  const aliases: Record<string, FindingSeverity> = {
    'critical': 'blocking',
    'block': 'blocking',
    'high': 'major',
    'medium': 'minor',
    'low': 'suggestion',
    'nit': 'suggestion',
    'nitpick': 'suggestion',
    'warn': 'minor',
    'warning': 'minor',
    'error': 'major',
    'info': 'suggestion',
  };

  return aliases[lower] ?? null;
}

export interface ParsedReviewOutput {
  findings: TypedFinding[];
  verdict: 'SHIP' | 'REVISE' | 'RETHINK' | null;
}
