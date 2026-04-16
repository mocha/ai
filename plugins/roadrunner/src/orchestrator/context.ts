import type {
  InputType, RiskLevel, Stage, ArtifactRef, TaskSummary,
  ReviewFinding, SizingResult, SizingConfig, ResolutionRecord,
} from './types.js';

export interface OrchestratorContext {
  // From triage
  input_type: InputType;
  risk: RiskLevel;
  path: Stage[];
  existing_artifact: ArtifactRef | null;
  external_ref: string | null;
  decompose: boolean;
  domain_clusters: string[];

  // Task tracking (Record, not Map -- must be JSON-serializable)
  tasks: Record<number, TaskSummary>;
  current_task_id: number | null;
  task_count: number;
  tasks_complete: number;

  // Review tracking
  review_round: number;
  last_review_verdict: 'SHIP' | 'REVISE' | 'RETHINK' | null;
  last_review_findings: ReviewFinding[];

  // Spec/plan paths
  spec_path: string | null;
  plan_path: string | null;

  // Configuration (set once from risk level)
  max_review_rounds: number;
  worker_model: 'sonnet' | 'opus';
  worker_max_turns: number;
  review_model: 'sonnet' | 'opus';
  review_panel_size: number;
  worker_timeout_ms: number;
  review_timeout_ms: number;

  // Sizing gate (AMENDMENT)
  last_sizing_result: SizingResult | null;
  sizing_config: SizingConfig;

  // Resolution audit trail (AMENDMENT, bounded last 20)
  resolutions: ResolutionRecord[];

  // Pipeline metadata
  abort_reason: string | null;
  error: string | null;
}

export function createDefaultContext(): OrchestratorContext {
  return {
    input_type: 'raw-input',
    risk: 'standard',
    path: [],
    existing_artifact: null,
    external_ref: null,
    decompose: false,
    domain_clusters: [],

    tasks: {},
    current_task_id: null,
    task_count: 0,
    tasks_complete: 0,

    review_round: 0,
    last_review_verdict: null,
    last_review_findings: [],

    spec_path: null,
    plan_path: null,

    max_review_rounds: 2,
    worker_model: 'sonnet',
    worker_max_turns: 20,
    review_model: 'sonnet',
    review_panel_size: 3,
    worker_timeout_ms: 1_200_000,  // 20 min (standard default)
    review_timeout_ms: 600_000,    // 10 min (standard default)

    last_sizing_result: null,
    sizing_config: {
      max_prose_tokens: 2500,
      max_prose_lines: 200,
      max_file_blast_radius: 4,
    },

    resolutions: [],

    abort_reason: null,
    error: null,
  };
}
