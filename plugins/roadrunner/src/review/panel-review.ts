import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunReview } from '../orchestrator/commands.js';
import type { PanelSynthesis, ExpertResult, ReviewConfig, SubAgentResult } from './types.js';
import { generateExpert } from './generate-expert.js';
import { buildPanelReviewPrompt } from './prompts/panel-expert-prompt.js';
import { parseReviewOutput } from './parsers/review-output-parser.js';
import { synthesizeFindings } from './synthesize-findings.js';
import { getPanelConfig, getAdaptiveRound1Size, getAdaptiveRound2Size } from './panel-config.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Run a code quality panel review.
 *
 * Dispatches multiple expert reviewers in parallel, each with a distinct
 * vocabulary-routed prompt. Synthesizes findings into a consolidated verdict.
 */
export async function runPanelReview(
  command: RunReview,
  config: ReviewConfig,
  /** Injectable CLI dispatcher for testing */
  dispatcher?: (prompt: string, config: ReviewConfig) => Promise<SubAgentResult>,
): Promise<PanelSynthesis> {
  const panelConfig = getPanelConfig(command.risk);

  if (panelConfig.panel_size === 0) {
    // Trivial risk: skip panel review, auto-SHIP
    return {
      verdict: 'SHIP',
      consensus: [],
      unique: [],
      disagreements: [],
      all_findings: [],
    };
  }

  // Determine effective panel size (adaptive narrowing for critical)
  const effectiveSize = panelConfig.adaptive_narrowing && command.round > 1
    ? getAdaptiveRound2Size()
    : panelConfig.adaptive_narrowing
      ? getAdaptiveRound1Size()
      : panelConfig.panel_size;

  // Generate expert prompts for each panelist (sequentially to avoid CLI conflicts)
  const expertPrompts: string[] = [];
  for (let i = 0; i < effectiveSize; i++) {
    const expertResult = await generateExpert(
      {
        type: 'GENERATE_EXPERT',
        task_id: command.task_id,
        task: command.task_spec,
        risk: command.risk,
        codebase_context: {
          entry_points: command.task_spec.relevantFiles,
          recent_changes: [],
          related_tests: [],
        },
      },
      'critique',
      {
        ...config,
        // Use unique artifact path per expert to avoid file conflicts
        artifact_root: path.join(config.artifact_root, `panel-${i}`),
      },
      dispatcher,
    );
    expertPrompts.push(expertResult.expert_prompt_path);
  }

  // Build review prompts for each panelist
  const reviewPrompts = expertPrompts.map((expertPath, i) => {
    const basePrompt = buildPanelReviewPrompt(command, i, effectiveSize);
    return `${basePrompt}\n\n---\n\nYour expert prompt is at: ${expertPath}\nRead it for domain vocabulary context before proceeding.`;
  });

  // Dispatch all panelists in parallel
  const dispatchFn = dispatcher ?? defaultDispatcher;
  const results = await Promise.all(
    reviewPrompts.map(async (prompt, i): Promise<ExpertResult> => {
      const result = await dispatchFn(prompt, config);
      const parsed = parseReviewOutput(result.stdout);

      // Write per-expert report
      const reportsDir = path.join(config.artifact_root, 'reports');
      fs.mkdirSync(reportsDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const reportPath = path.join(reportsDir, `R-${timestamp}-panel-expert-${i}.md`);
      fs.writeFileSync(reportPath, result.stdout, 'utf8');

      return {
        expert_id: `expert-${i}`,
        identity: `Panel expert ${i + 1} of ${effectiveSize}`,
        verdict: parsed.verdict ?? 'REVISE',
        findings: parsed.findings,
        report_path: reportPath,
      };
    }),
  );

  // Write panel synthesis report
  const synthesis = synthesizeFindings(results);

  const reportsDir = path.join(config.artifact_root, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const synthesisPath = path.join(reportsDir, `R-${timestamp}-panel-synthesis.md`);
  fs.writeFileSync(synthesisPath, formatSynthesisReport(synthesis, results), 'utf8');

  return synthesis;
}

async function defaultDispatcher(
  prompt: string,
  config: ReviewConfig,
): Promise<SubAgentResult> {
  try {
    const { stdout, stderr } = await execFileAsync(config.claude_bin, [
      '--print',
      '-p',
      prompt,
    ], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300_000,
    });

    return { stdout, stderr, exit_code: 0 };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execErr.stdout ?? '',
      stderr: execErr.stderr ?? String(err),
      exit_code: execErr.code ?? 1,
    };
  }
}

function formatSynthesisReport(synthesis: PanelSynthesis, results: ExpertResult[]): string {
  const lines: string[] = [];
  lines.push('# Panel Review Synthesis');
  lines.push('');
  lines.push(`**Verdict:** ${synthesis.verdict}`);
  lines.push(`**Panel size:** ${results.length}`);
  lines.push('');

  lines.push('## Panel Composition');
  for (const result of results) {
    lines.push(`- ${result.expert_id}: ${result.identity} — verdict: ${result.verdict}`);
  }
  lines.push('');

  if (synthesis.consensus.length > 0) {
    lines.push('## Consensus Findings');
    for (const f of synthesis.consensus) {
      lines.push(`- [${f.severity}] ${f.description}${f.file ? ` | ${f.file}${f.line ? `:${f.line}` : ''}` : ''}`);
    }
    lines.push('');
  }

  if (synthesis.unique.length > 0) {
    lines.push('## Unique Findings');
    for (const f of synthesis.unique) {
      lines.push(`- [${f.severity}] ${f.description}${f.file ? ` | ${f.file}${f.line ? `:${f.line}` : ''}` : ''}`);
    }
    lines.push('');
  }

  if (synthesis.disagreements.length > 0) {
    lines.push('## Disagreements');
    for (const d of synthesis.disagreements) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
