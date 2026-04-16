import type { OrchestratorCommand, GenerateExpert, RunReview } from '../orchestrator/commands.js';
import type { OrchestratorEvent, ReviewComplete } from '../orchestrator/events.js';
import type { ReviewFinding } from '../orchestrator/types.js';
import type { ReviewConfig, SubAgentResult, TypedFinding } from './types.js';
import { generateExpert } from './generate-expert.js';
import { validateDrift } from './drift-validator.js';
import { runSpecComplianceReview } from './spec-compliance.js';
import { runPanelReview } from './panel-review.js';
import { writeVerdict } from './verdict-writer.js';
import { getPanelConfig } from './panel-config.js';

type SendEvent = (event: OrchestratorEvent) => void;

/**
 * Create a command handler for the review layer (Layer 4).
 *
 * Handles GENERATE_EXPERT and RUN_REVIEW commands from the orchestrator.
 * Routes to expert generation, drift validation, spec compliance review,
 * and panel review modules. Replaces the stubs in the worker handler.
 */
export function createReviewHandler(
  config: ReviewConfig,
  sendEvent: SendEvent,
  /** Injectable CLI dispatcher for testing */
  dispatcher?: (prompt: string, config: ReviewConfig) => Promise<SubAgentResult>,
): (command: OrchestratorCommand) => void {
  // Internal state: spec compliance failure count per task
  const specFailures = new Map<number, number>();

  return (command: OrchestratorCommand) => {
    switch (command.type) {
      case 'GENERATE_EXPERT':
        handleGenerateExpert(command, config, sendEvent, dispatcher).catch(err => {
          console.error(`[review] GENERATE_EXPERT error for task ${command.task_id}:`, err);
          sendEvent({
            type: 'DISPATCH_ERROR',
            failed_command: 'GENERATE_EXPERT',
            error_message: String(err),
            attempts: 1,
          });
        });
        break;

      case 'RUN_REVIEW':
        handleRunReview(command, config, sendEvent, specFailures, dispatcher).catch(err => {
          console.error(`[review] RUN_REVIEW error for task ${command.task_id}:`, err);
          sendEvent({
            type: 'DISPATCH_ERROR',
            failed_command: 'RUN_REVIEW',
            error_message: String(err),
            attempts: 1,
          });
        });
        break;

      default:
        // Not our command — ignore (other handlers will pick it up)
        break;
    }
  };
}

// ---------------------------------------------------------------------------
// GENERATE_EXPERT handler
// ---------------------------------------------------------------------------

async function handleGenerateExpert(
  command: GenerateExpert,
  config: ReviewConfig,
  sendEvent: SendEvent,
  dispatcher?: (prompt: string, config: ReviewConfig) => Promise<SubAgentResult>,
): Promise<void> {
  // Trivial risk: short-circuit with minimal expert prompt
  if (command.risk === 'trivial') {
    sendEvent({
      type: 'EXPERT_READY',
      task_id: command.task_id,
      expert_prompt_path: '',
      drift_check: 'pass',
      drift_details: null,
    });
    return;
  }

  // Generate vocabulary-routed expert prompt
  const expertResult = await generateExpert(command, 'build', config, dispatcher);

  // Run drift validation
  const driftResult = await validateDrift(command.task, config.project_root);

  sendEvent({
    type: 'EXPERT_READY',
    task_id: command.task_id,
    expert_prompt_path: expertResult.expert_prompt_path,
    drift_check: driftResult.pass ? 'pass' : 'fail',
    drift_details: driftResult.pass
      ? null
      : driftResult.mismatches.map(m => m.details).join('; '),
  });
}

// ---------------------------------------------------------------------------
// RUN_REVIEW handler
// ---------------------------------------------------------------------------

async function handleRunReview(
  command: RunReview,
  config: ReviewConfig,
  sendEvent: SendEvent,
  specFailures: Map<number, number>,
  dispatcher?: (prompt: string, config: ReviewConfig) => Promise<SubAgentResult>,
): Promise<void> {
  const { task_id, risk, round } = command;
  const panelConfig = getPanelConfig(risk);

  // Trivial risk: auto-SHIP
  if (risk === 'trivial') {
    const event: ReviewComplete = {
      type: 'REVIEW_COMPLETE',
      task_id,
      verdict: 'SHIP',
      round,
      report_path: '',
      findings: [],
      gate: 'code_quality',
    };
    sendEvent(event);
    return;
  }

  // Gate 1: Spec compliance solo review
  const specResult = await runSpecComplianceReview(command, config, dispatcher);

  if (!specResult.compliant) {
    // Track consecutive spec compliance failures
    const failures = (specFailures.get(task_id) ?? 0) + 1;
    specFailures.set(task_id, failures);

    // 3 consecutive failures → RETHINK
    const verdict = failures >= 3 ? 'RETHINK' : 'REVISE';

    const event: ReviewComplete = {
      type: 'REVIEW_COMPLETE',
      task_id,
      verdict,
      round,
      report_path: '',
      findings: typedFindingsToReviewFindings(specResult.findings),
      gate: 'spec_compliance',
    };

    writeVerdict(event, 'spec_compliance', 1, 'sonnet', config);
    sendEvent(event);
    return;
  }

  // Spec passed — reset failure counter
  specFailures.delete(task_id);

  // Gate 2: Code quality panel review
  const panelSynthesis = await runPanelReview(command, config, dispatcher);

  const event: ReviewComplete = {
    type: 'REVIEW_COMPLETE',
    task_id,
    verdict: panelSynthesis.verdict,
    round,
    report_path: '',
    findings: typedFindingsToReviewFindings(panelSynthesis.all_findings),
    gate: 'code_quality',
  };

  writeVerdict(event, 'code_quality', panelConfig.panel_size, panelConfig.model, config);
  sendEvent(event);
}

/** Convert internal TypedFinding to orchestrator's ReviewFinding. */
function typedFindingsToReviewFindings(findings: TypedFinding[]): ReviewFinding[] {
  return findings.map(f => ({
    severity: f.severity,
    description: f.description,
    file: f.file,
    line: f.line ?? 0,
  }));
}
