export interface ResolutionRecord {
  timestamp: string;
  seam: 'artifact_path' | 'task_id' | 'finding_file';
  reference: string;
  candidates: string[];
  resolved_to: string | null;
  method: 'exact' | 'glob' | 'git_follow' | 'llm' | 'user';
}

export interface TaskSummary {
  id: number;
  title: string;
  status: TaskStatus;
  review_round: number;
  worker_result_path: string | null;
  expert_prompt_path: string | null;
  cost_usd: number;
  duration_ms: number;
}

export interface SizingResult {
  token_count: number;
  prose_line_count: number;
  file_blast_radius: number;
  verdict: 'under' | 'over' | 'ambiguous';
}

export interface SizingConfig {
  max_prose_tokens: number;
  max_prose_lines: number;
  max_file_blast_radius: number;
}

export interface TaskSpec {
  id: number;
  title: string;
  dependencies: number[];
  status: string;
  details: string;
  acceptanceCriteria: string[];
  relevantFiles: string[];
}

export interface ReviewFinding {
  severity: string;
  description: string;
  file: string;
  line: number;
}

export interface ArtifactRef {
  type: 'spec' | 'plan' | 'task';
  path: string;
}

export type InputType = 'spec' | 'plan' | 'task' | 'raw-idea' | 'raw-problem' | 'raw-input' | 'external-ref';
export type RiskLevel = 'trivial' | 'standard' | 'elevated' | 'critical';
export type Stage = 'triage' | 'prepare' | 'brainstorm' | 'spec_review' | 'write_plan' | 'plan_review' | 'develop' | 'finish';
export type TaskStatus = 'pending' | 'expert_ready' | 'in_progress' | 'review' | 'done' | 'blocked' | 'skipped';
export type QueryOutcome = 'task_ready' | 'all_complete' | 'all_blocked';
