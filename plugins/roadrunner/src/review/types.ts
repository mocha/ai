// ---------------------------------------------------------------------------
// Finding severity — narrows the orchestrator's `string` type
// ---------------------------------------------------------------------------

export type FindingSeverity = 'blocking' | 'major' | 'minor' | 'suggestion';

/** Typed finding with literal severity */
export interface TypedFinding {
  severity: FindingSeverity;
  description: string;
  file: string;
  line: number | null;
}

// ---------------------------------------------------------------------------
// Drift validation
// ---------------------------------------------------------------------------

export interface DriftResult {
  pass: boolean;
  mismatches: DriftMismatch[];
}

export interface DriftMismatch {
  type: 'file_missing' | 'identifier_not_found' | 'location_changed';
  reference: string;
  expected_location: string | null;
  actual_location: string | null;
  details: string;
}

// ---------------------------------------------------------------------------
// Panel configuration
// ---------------------------------------------------------------------------

export interface PanelConfig {
  panel_size: number;
  model: 'sonnet' | 'opus';
  max_rounds: number;
  adaptive_narrowing: boolean;
}

// ---------------------------------------------------------------------------
// Verdict persistence
// ---------------------------------------------------------------------------

export interface VerdictFile {
  task_id: number;
  verdict: 'SHIP' | 'REVISE' | 'RETHINK';
  gate: 'spec_compliance' | 'code_quality';
  round: number;
  timestamp: string;
  report_path: string;
  findings_summary: {
    blocking: number;
    major: number;
    minor: number;
    suggestion: number;
  };
  panel_size: number;
  model: string;
}

// ---------------------------------------------------------------------------
// Internal review results
// ---------------------------------------------------------------------------

export interface SpecComplianceResult {
  compliant: boolean;
  findings: TypedFinding[];
}

export interface PanelSynthesis {
  verdict: 'SHIP' | 'REVISE' | 'RETHINK';
  consensus: TypedFinding[];
  unique: TypedFinding[];
  disagreements: string[];
  all_findings: TypedFinding[];
}

export interface ExpertResult {
  expert_id: string;
  identity: string;
  verdict: 'SHIP' | 'REVISE' | 'RETHINK';
  findings: TypedFinding[];
  report_path: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ReviewConfig {
  /** Root directory for artifacts (default: '.roadrunner') */
  artifact_root: string;
  /** Path to claude CLI binary (default: 'claude') */
  claude_bin: string;
  /** Path to Skylark _shared/ methodology directory */
  methodology_path: string;
  /** Project root for drift validation and worktree operations */
  project_root: string;
}

export function createDefaultReviewConfig(projectRoot: string): ReviewConfig {
  return {
    artifact_root: '.roadrunner',
    claude_bin: 'claude',
    methodology_path: '',
    project_root: projectRoot,
  };
}

// ---------------------------------------------------------------------------
// Expert generation
// ---------------------------------------------------------------------------

export interface GenerateExpertResult {
  expert_prompt_path: string;
  vocabulary_cluster_count: number;
}

// ---------------------------------------------------------------------------
// CLI invocation (shared utility type for sub-agent dispatch)
// ---------------------------------------------------------------------------

export interface SubAgentResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}
