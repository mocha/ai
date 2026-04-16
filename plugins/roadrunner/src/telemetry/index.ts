// Layer 6: Telemetry Bridge (Phase 1 — local-only)
//
// Event observer that writes per-task and per-pipeline telemetry to
// .roadrunner/telemetry/. Anomaly detection warns on cost/duration spikes.

export { createTelemetryObserver } from './handler.js';
export { writeTaskTelemetry } from './writer.js';
export { buildPipelineSummary, formatCostSummary } from './rollup.js';
export { detectTaskAnomalies, detectPipelineAnomalies } from './anomalies.js';

export type {
  TaskTelemetry,
  PipelineSummary,
  AnomalyRecord,
  AnomalyThresholds,
  TelemetryConfig,
  TelemetryMeta,
  WorkerResultFile,
} from './types.js';

export { createDefaultTelemetryConfig, DEFAULT_THRESHOLDS } from './types.js';
