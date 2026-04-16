import type {
  SizingResult,
  TaskSummary,
  TaskSpec,
  ReviewFinding,
  ArtifactRef,
  InputType,
  RiskLevel,
  Stage,
} from './types.js';

// Re-export TaskSummary for consumers that import from events
export type { TaskSummary };

// From Layer 1 (Triage)
export interface TriageComplete {
  type: 'TRIAGE_COMPLETE';
  input_type: InputType;
  risk: RiskLevel;
  path: Stage[];
  existing_artifact: ArtifactRef | null;
  external_ref: string | null;
  decompose: boolean;
  domain_clusters: string[];
}

// From Layer 3 (Task Substrate) — unified query response
export interface QueryResult {
  type: 'QUERY_RESULT';
  outcome: 'task_ready' | 'all_complete' | 'all_blocked';
  task?: TaskSpec;
  blocked_task_ids?: number[];
  blocked_reasons?: string[];
}

export interface DecompositionComplete {
  type: 'DECOMPOSITION_COMPLETE';
  task_count: number;
  task_ids: number[];
  domains: string[];
}

// STATUS_ROLLUP retained as global notification (not load-bearing for routing)
export interface StatusRollup {
  type: 'STATUS_ROLLUP';
  parent_id: number;
  children_complete: number;
  children_total: number;
  all_complete: boolean;
}

// From Layer 4 (Expert Generation)
export interface ExpertReady {
  type: 'EXPERT_READY';
  task_id: number;
  expert_prompt_path: string;
  drift_check: 'pass' | 'fail';
  drift_details: string | null;
}

// From Layer 4 (Review)
export interface ReviewComplete {
  type: 'REVIEW_COMPLETE';
  task_id: number;
  verdict: 'SHIP' | 'REVISE' | 'RETHINK';
  round: number;
  report_path: string;
  findings: ReviewFinding[];
  /** Which review gate produced this verdict. Spec compliance revisions
   *  do not count against the code quality round cap. */
  gate: 'spec_compliance' | 'code_quality';
}

// From Layer 5 (Worker Execution)
export interface WorkerComplete {
  type: 'WORKER_COMPLETE';
  task_id: number;
  status: 'DONE' | 'DONE_WITH_CONCERNS' | 'NEEDS_CONTEXT' | 'BLOCKED';
  result_path: string;
  cost_usd: number;
  duration_ms: number;
  files_changed: string[];
  concerns: string | null;
}

// From Layer 7 (Context Engineering)
export interface CompactionDetected {
  type: 'COMPACTION_DETECTED';
  task_id: number;
  session_id: string;
  utilization_at_compaction: number;
}

// From User
export interface UserApprove {
  type: 'USER_APPROVE';
  stage: string;
  decision: 'proceed' | 'abort';
}

export interface UserEscalationResponse {
  type: 'USER_ESCALATION_RESPONSE';
  task_id: number;
  action: 'retry' | 'skip' | 'abort';
}

// Internal
export interface Start {
  type: 'START';
  input: { type: string; content: string; user_risk_override: RiskLevel | null };
}

// Completion events carry decomposition signal
export interface PrepareComplete {
  type: 'PREPARE_COMPLETE';
  spec_path: string;
  decomposition_recommended: boolean;
  decomposition_rationale: string | null;
}

export interface BrainstormComplete {
  type: 'BRAINSTORM_COMPLETE';
  spec_path: string;
  decomposition_recommended: boolean;
  decomposition_rationale: string | null;
}

export interface PlanComplete {
  type: 'PLAN_COMPLETE';
  plan_path: string;
  decomposition_recommended: boolean;
  decomposition_rationale: string | null;
}

export interface FinishComplete {
  type: 'FINISH_COMPLETE';
  summary: string;
}

// Dispatch error with retry count
export interface DispatchError {
  type: 'DISPATCH_ERROR';
  failed_command: string;
  error_message: string;
  attempts: number;
}

// Sizing gate events
export interface SizingAmbiguous {
  type: 'SIZING_AMBIGUOUS';
  sizing_result: SizingResult;
}

export interface HaikuSizingResult {
  type: 'HAIKU_SIZING_RESULT';
  answer: 'single' | 'multiple';
  rationale: string;
}

// The discriminated union of all orchestrator events
export type OrchestratorEvent =
  | Start
  | TriageComplete
  | QueryResult
  | DecompositionComplete
  | StatusRollup
  | ExpertReady
  | ReviewComplete
  | WorkerComplete
  | CompactionDetected
  | UserApprove
  | UserEscalationResponse
  | PrepareComplete
  | BrainstormComplete
  | PlanComplete
  | FinishComplete
  | DispatchError
  | SizingAmbiguous
  | HaikuSizingResult;
