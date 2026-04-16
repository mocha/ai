import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  TaskTelemetry,
  TelemetryConfig,
  TelemetryMeta,
  WorkerResultFile,
} from './types.js';
import { detectTaskAnomalies } from './anomalies.js';

/**
 * Read a worker result file and write a structured telemetry record.
 *
 * Pure transformation: result JSON in → telemetry JSON out.
 * The only side effect is the file write to .roadrunner/telemetry/.
 *
 * @returns The written telemetry record (also useful for Langfuse bridging later).
 */
export function writeTaskTelemetry(
  resultPath: string,
  meta: TelemetryMeta,
  config: TelemetryConfig,
): TaskTelemetry {
  const result = readResultFile(resultPath);
  const telemetry = buildTelemetryRecord(result, meta);

  // Run anomaly detection
  telemetry.anomalies = detectTaskAnomalies(telemetry, config.thresholds);

  // Write telemetry file
  const telemetryDir = path.join(config.artifact_root, 'telemetry');
  fs.mkdirSync(telemetryDir, { recursive: true });

  const filePath = path.join(telemetryDir, `TASK-${telemetry.task_id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(telemetry, null, 2), 'utf8');

  // Warn on anomalies
  for (const anomaly of telemetry.anomalies) {
    console.error(`[TELEMETRY] ${anomaly.description}`);
  }

  return telemetry;
}

/** Read and parse a worker result JSON file. */
function readResultFile(resultPath: string): WorkerResultFile {
  const raw = fs.readFileSync(resultPath, 'utf8');
  return JSON.parse(raw) as WorkerResultFile;
}

/** Transform a worker result into a telemetry record. */
function buildTelemetryRecord(
  result: WorkerResultFile,
  meta: TelemetryMeta,
): TaskTelemetry {
  return {
    task_id: result.task_id,
    cost_usd: result.cost_usd ?? 0,
    duration_ms: result.duration_ms ?? 0,
    num_turns: result.num_turns ?? 0,
    model: meta.model || result.model || 'unknown',
    tokens: {
      input: null,
      output: null,
      cache_read: null,
      cache_creation: null,
    },
    pipeline_run_id: meta.pipeline_run_id,
    stage: meta.stage,
    session_id: result.session_id ?? '',
    status: result.status ?? 'unknown',
    round: result.round ?? 1,
    anomalies: [],
    timestamp: result.timestamp ?? new Date().toISOString(),
  };
}
