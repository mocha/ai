// ---------------------------------------------------------------------------
// Per-task telemetry record
// ---------------------------------------------------------------------------

export interface TaskTelemetry {
  task_id: number;
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
  model: string;
  tokens: {
    input: number | null;
    output: number | null;
    cache_read: number | null;
    cache_creation: number | null;
  };
  pipeline_run_id: string;
  stage: string;
  session_id: string;
  status: string;
  round: number;
  anomalies: AnomalyRecord[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Anomaly detection
// ---------------------------------------------------------------------------

export interface AnomalyRecord {
  type: string;
  description: string;
  threshold: number;
  actual: number;
}

// ---------------------------------------------------------------------------
// Pipeline summary
// ---------------------------------------------------------------------------

export interface PipelineSummary {
  pipeline_run_id: string;
  total_cost_usd: number;
  total_duration_ms: number;
  task_count: number;
  per_stage_cost: Record<string, number>;
  per_stage_duration: Record<string, number>;
  per_task: Array<{
    task_id: number;
    cost_usd: number;
    duration_ms: number;
    stage: string;
    model: string;
  }>;
  anomalies: AnomalyRecord[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface TelemetryConfig {
  /** Root directory for artifacts (default: '.roadrunner') */
  artifact_root: string;
  /** Anomaly thresholds */
  thresholds: AnomalyThresholds;
}

export interface AnomalyThresholds {
  /** Per-task cost spike (USD). Default: 2.00 */
  cost_spike_usd: number;
  /** Per-task slow threshold (ms). Default: 900_000 (15 min) */
  slow_task_ms: number;
  /** Per-task excessive turns. Default: 25 */
  excessive_turns: number;
  /** Pipeline total cost spike (USD). Default: 15.00 */
  pipeline_cost_spike_usd: number;
  /** Stage cost fraction imbalance. Default: 0.60 */
  stage_imbalance_ratio: number;
}

export const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  cost_spike_usd: 2.0,
  slow_task_ms: 900_000,
  excessive_turns: 25,
  pipeline_cost_spike_usd: 15.0,
  stage_imbalance_ratio: 0.6,
};

export function createDefaultTelemetryConfig(): TelemetryConfig {
  return {
    artifact_root: '.roadrunner',
    thresholds: { ...DEFAULT_THRESHOLDS },
  };
}

// ---------------------------------------------------------------------------
// Worker result file schema (read from .roadrunner/results/TASK-{id}.json)
// ---------------------------------------------------------------------------

/** Shape of the result artifact written by the worker layer. */
export interface WorkerResultFile {
  task_id: number;
  status: string;
  round: number;
  model: string;
  timestamp: string;
  cost_usd: number;
  duration_ms: number;
  files_changed: string[];
  concerns: string | null;
  hook_events: unknown[];
  // CLI JSON fields (may be absent in older results)
  num_turns?: number;
  session_id?: string;
  is_error?: boolean;
}

// ---------------------------------------------------------------------------
// Metadata passed from orchestrator (fields not in the result file)
// ---------------------------------------------------------------------------

export interface TelemetryMeta {
  pipeline_run_id: string;
  stage: string;
  model: string;
}
