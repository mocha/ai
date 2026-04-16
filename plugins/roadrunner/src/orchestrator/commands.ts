import type { RiskLevel, TaskSpec, TaskStatus, SizingResult } from './types.js';

export interface WorkerResult {
  status: 'DONE' | 'DONE_WITH_CONCERNS' | 'NEEDS_CONTEXT' | 'BLOCKED';
  result_path: string;
  cost_usd: number;
  duration_ms: number;
  files_changed: string[];
  concerns: string | null;
}

// To Layer 1
export interface RunTriage {
  type: 'RUN_TRIAGE';
  input: { type: string; content: string; user_risk_override: RiskLevel | null };
}

// To Layer 3
export interface Decompose {
  type: 'DECOMPOSE';
  spec_path: string;
  risk: RiskLevel;
}

export interface QueryNextTask {
  type: 'QUERY_NEXT_TASK';
  filter: { status: 'pending'; dependencies_met: true };
}

export interface UpdateTaskStatus {
  type: 'UPDATE_TASK_STATUS';
  task_id: number;
  status: TaskStatus;
}

export interface RedecomposeTask {
  type: 'REDECOMPOSE_TASK';
  task_id: number;
  reason: 'compaction_detected';
}

// AMENDED: pre-develop artifact decomposition
export interface DecomposeArtifact {
  type: 'DECOMPOSE_ARTIFACT';
  artifact_path: string;
  artifact_type: 'spec' | 'plan';
  reason: 'size_gate_mechanical' | 'size_gate_haiku' | 'agent_recommended';
  sizing_result?: SizingResult;
}

// To Layer 4
export interface GenerateExpert {
  type: 'GENERATE_EXPERT';
  task_id: number;
  task: TaskSpec;
  risk: RiskLevel;
  codebase_context: {
    entry_points: string[];
    recent_changes: string[];
    related_tests: string[];
  };
}

export interface RunReview {
  type: 'RUN_REVIEW';
  task_id: number;
  worktree_path: string;
  task_spec: TaskSpec;
  worker_result: WorkerResult;
  risk: RiskLevel;
  round: number;
}

// AMENDED: sizing gate Haiku dispatch
export interface DispatchHaikuSizing {
  type: 'DISPATCH_HAIKU_SIZING';
  artifact_path: string;
  artifact_type: 'spec' | 'plan';
  sizing_result: SizingResult;
}

// To Layer 5
export interface DispatchWorker {
  type: 'DISPATCH_WORKER';
  task_id: number;
  expert_prompt_path: string;
  task_spec: TaskSpec;
  worktree_branch: string;
  max_turns: number;
  model: 'sonnet' | 'opus';
}

// To User
export interface RequestApproval {
  type: 'REQUEST_APPROVAL';
  stage: string;
  summary: string;
  risk: RiskLevel;
}

export interface Escalate {
  type: 'ESCALATE';
  task_id: number;
  reason: string;
  options: Array<'retry' | 'skip' | 'abort'>;
}

// The union
export type OrchestratorCommand =
  | RunTriage
  | Decompose
  | QueryNextTask
  | UpdateTaskStatus
  | RedecomposeTask
  | DecomposeArtifact
  | GenerateExpert
  | RunReview
  | DispatchHaikuSizing
  | DispatchWorker
  | RequestApproval
  | Escalate;
