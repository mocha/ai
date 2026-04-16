// Layer 4: Review & Expert Generation
//
// Command handler for GENERATE_EXPERT and RUN_REVIEW.
// Registers on the event bus alongside the task substrate and worker handlers.

export { createReviewHandler } from './handler.js';
export { generateExpert, countVocabularyClusters } from './generate-expert.js';
export { validateDrift, extractIdentifiers } from './drift-validator.js';
export { runSpecComplianceReview } from './spec-compliance.js';
export { runPanelReview } from './panel-review.js';
export { synthesizeFindings } from './synthesize-findings.js';
export { writeVerdict } from './verdict-writer.js';
export { getPanelConfig } from './panel-config.js';

export type {
  ReviewConfig,
  FindingSeverity,
  TypedFinding,
  DriftResult,
  DriftMismatch,
  PanelConfig,
  VerdictFile,
  SpecComplianceResult,
  PanelSynthesis,
  ExpertResult,
  GenerateExpertResult,
  SubAgentResult,
} from './types.js';

export { createDefaultReviewConfig } from './types.js';
