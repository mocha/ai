import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ReviewComplete } from '../orchestrator/events.js';
import type { VerdictFile, ReviewConfig, FindingSeverity } from './types.js';
import { validateVerdictFile } from './validate.js';

/**
 * Write a verdict JSON file to .roadrunner/verdicts/TASK-{id}.json.
 * Validates the structure before writing.
 *
 * @returns The path to the written verdict file.
 */
export function writeVerdict(
  event: ReviewComplete,
  gate: 'spec_compliance' | 'code_quality',
  panelSize: number,
  model: string,
  config: ReviewConfig,
): string {
  const verdictsDir = path.join(config.artifact_root, 'verdicts');
  fs.mkdirSync(verdictsDir, { recursive: true });

  const summary = computeFindingsSummary(event.findings);

  const verdictFile: VerdictFile = {
    task_id: event.task_id,
    verdict: event.verdict,
    gate,
    round: event.round,
    timestamp: new Date().toISOString(),
    report_path: event.report_path,
    findings_summary: summary,
    panel_size: panelSize,
    model,
  };

  // Validate before writing
  validateVerdictFile(verdictFile);

  const filePath = path.join(verdictsDir, `TASK-${event.task_id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(verdictFile, null, 2), 'utf8');

  return filePath;
}

/** Compute findings summary counts from a findings array. */
function computeFindingsSummary(
  findings: Array<{ severity: string }>,
): VerdictFile['findings_summary'] {
  const summary = { blocking: 0, major: 0, minor: 0, suggestion: 0 };

  for (const finding of findings) {
    const severity = finding.severity as FindingSeverity;
    if (severity in summary) {
      summary[severity]++;
    }
  }

  return summary;
}
