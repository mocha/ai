import type { RunReview } from '../orchestrator/commands.js';
import type { SpecComplianceResult, ReviewConfig, SubAgentResult } from './types.js';
import { buildSpecCompliancePrompt } from './prompts/spec-compliance-prompt.js';
import { parseReviewOutput } from './parsers/review-output-parser.js';
import { generateExpert } from './generate-expert.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Run a spec compliance solo review.
 *
 * Dispatches a single reviewer sub-agent that checks whether the implementation
 * matches the task requirements. Does NOT evaluate code quality.
 *
 * Returns compliant: true if no blocking or major findings.
 */
export async function runSpecComplianceReview(
  command: RunReview,
  config: ReviewConfig,
  /** Injectable CLI dispatcher for testing */
  dispatcher?: (prompt: string, config: ReviewConfig) => Promise<SubAgentResult>,
): Promise<SpecComplianceResult> {
  // Generate vocabulary-routed reviewer prompt
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
    config,
    dispatcher,
  );

  // Build the spec compliance review prompt
  const reviewPrompt = buildSpecCompliancePrompt(command);

  // Combine expert prompt with review prompt
  const fullPrompt = `${reviewPrompt}\n\n---\n\nYour expert prompt is at: ${expertResult.expert_prompt_path}\nRead it for domain vocabulary context before proceeding with the review.`;

  // Dispatch the reviewer
  const result = dispatcher
    ? await dispatcher(fullPrompt, config)
    : await invokeClaudeCli(fullPrompt, config);

  if (result.exit_code !== 0 && !result.stdout.trim()) {
    console.warn(`[review] Spec compliance review failed (exit ${result.exit_code}): ${result.stderr}`);
    // Treat CLI failure as non-compliant with a single finding
    return {
      compliant: false,
      findings: [{
        severity: 'blocking',
        description: `Spec compliance review failed: ${result.stderr.slice(0, 200)}`,
        file: '',
        line: null,
      }],
    };
  }

  const parsed = parseReviewOutput(result.stdout);

  if (parsed.findings.length === 0 && parsed.verdict === null) {
    // Sub-agent returned non-conforming output
    console.warn('[review] Spec compliance reviewer returned unparseable output');
    return {
      compliant: false,
      findings: [{
        severity: 'blocking',
        description: 'Spec compliance reviewer returned unparseable output — treating as non-compliant',
        file: '',
        line: null,
      }],
    };
  }

  const hasBlockingOrMajor = parsed.findings.some(
    f => f.severity === 'blocking' || f.severity === 'major',
  );

  return {
    compliant: !hasBlockingOrMajor,
    findings: parsed.findings,
  };
}

async function invokeClaudeCli(
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
