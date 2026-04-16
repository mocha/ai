import type { OrchestratorEvent, WorkerComplete } from '../orchestrator/events.js';
import type { TelemetryConfig, TelemetryMeta } from './types.js';
import { writeTaskTelemetry } from './writer.js';
import { buildPipelineSummary, formatCostSummary } from './rollup.js';

/**
 * Create an event observer for telemetry.
 *
 * Unlike command handlers (which register on the bus), this is an event
 * observer that the orchestrator calls after processing events. It does
 * not modify state or emit events — it only writes telemetry files.
 *
 * The observer is called with every event. It only acts on:
 * - WORKER_COMPLETE: writes per-task telemetry
 * - FINISH_COMPLETE: builds pipeline rollup and prints cost summary
 *
 * Telemetry failures are logged but never thrown — they must not block
 * the pipeline.
 */
export function createTelemetryObserver(
  config: TelemetryConfig,
  getPipelineMeta: () => { pipeline_run_id: string; stage: string; model: string },
): (event: OrchestratorEvent) => void {
  return (event: OrchestratorEvent) => {
    try {
      switch (event.type) {
        case 'WORKER_COMPLETE':
          handleWorkerComplete(event, config, getPipelineMeta());
          break;
        case 'FINISH_COMPLETE':
          handleFinishComplete(config, getPipelineMeta().pipeline_run_id);
          break;
      }
    } catch (err) {
      console.error(`[TELEMETRY] Error processing ${event.type}:`, err);
    }
  };
}

function handleWorkerComplete(
  event: WorkerComplete,
  config: TelemetryConfig,
  meta: TelemetryMeta,
): void {
  if (!event.result_path) {
    console.warn(`[TELEMETRY] WORKER_COMPLETE for task ${event.task_id} has no result_path, skipping`);
    return;
  }

  writeTaskTelemetry(event.result_path, meta, config);
}

function handleFinishComplete(
  config: TelemetryConfig,
  pipelineRunId: string,
): void {
  if (!pipelineRunId) {
    console.warn('[TELEMETRY] No pipeline_run_id, skipping rollup');
    return;
  }

  const summary = buildPipelineSummary(pipelineRunId, config);
  console.log(formatCostSummary(summary));

  for (const anomaly of summary.anomalies) {
    console.error(`[TELEMETRY] ${anomaly.description}`);
  }
}
