import type { ExpertResult, PanelSynthesis, TypedFinding } from './types.js';

/**
 * Synthesize findings from multiple expert reviewers into a consolidated verdict.
 *
 * Implements the consolidation rules from spec section 9.3:
 * - "One Rethink vetoes": any expert Rethink → consolidated Rethink
 * - "All Ship": every expert Ship → consolidated Ship
 * - Otherwise: Revise
 *
 * Also identifies consensus findings (flagged by 2+ experts) and unique findings
 * (flagged by exactly 1 expert).
 */
export function synthesizeFindings(results: ExpertResult[]): PanelSynthesis {
  if (results.length === 0) {
    return {
      verdict: 'SHIP',
      consensus: [],
      unique: [],
      disagreements: [],
      all_findings: [],
    };
  }

  // --- Verdict consolidation ---
  const hasRethink = results.some(r => r.verdict === 'RETHINK');
  const allShip = results.every(r => r.verdict === 'SHIP');

  let verdict: 'SHIP' | 'REVISE' | 'RETHINK';
  if (hasRethink) {
    verdict = 'RETHINK';
  } else if (allShip) {
    verdict = 'SHIP';
  } else {
    verdict = 'REVISE';
  }

  // --- Finding classification ---
  const allFindings: TypedFinding[] = [];
  const findingsByDescription = new Map<string, { finding: TypedFinding; experts: string[] }>();

  for (const result of results) {
    for (const finding of result.findings) {
      allFindings.push(finding);

      // Group by normalized description for consensus detection
      const key = normalizeFindingKey(finding);
      const existing = findingsByDescription.get(key);
      if (existing) {
        existing.experts.push(result.expert_id);
        // Use the highest severity
        if (severityRank(finding.severity) > severityRank(existing.finding.severity)) {
          existing.finding = { ...finding };
        }
      } else {
        findingsByDescription.set(key, {
          finding: { ...finding },
          experts: [result.expert_id],
        });
      }
    }
  }

  const consensus: TypedFinding[] = [];
  const unique: TypedFinding[] = [];

  for (const { finding, experts } of findingsByDescription.values()) {
    if (experts.length >= 2) {
      consensus.push(finding);
    } else {
      unique.push(finding);
    }
  }

  // --- Disagreement detection ---
  const disagreements: string[] = [];
  const verdictCounts = new Map<string, number>();
  for (const result of results) {
    verdictCounts.set(result.verdict, (verdictCounts.get(result.verdict) ?? 0) + 1);
  }

  if (verdictCounts.size > 1) {
    const parts = Array.from(verdictCounts.entries())
      .map(([v, c]) => `${c} expert(s) say ${v}`)
      .join(', ');
    disagreements.push(`Verdict disagreement: ${parts}`);
  }

  return {
    verdict,
    consensus,
    unique,
    disagreements,
    all_findings: allFindings,
  };
}

/**
 * Normalize a finding to a key for grouping.
 * Uses description + file to detect when multiple experts flag the same issue.
 */
function normalizeFindingKey(finding: TypedFinding): string {
  const desc = finding.description.toLowerCase().trim();
  const file = finding.file.toLowerCase().trim();
  return `${file}:${desc}`;
}

/** Severity ranking for comparison (higher = more severe). */
function severityRank(severity: string): number {
  switch (severity) {
    case 'blocking': return 4;
    case 'major': return 3;
    case 'minor': return 2;
    case 'suggestion': return 1;
    default: return 0;
  }
}
