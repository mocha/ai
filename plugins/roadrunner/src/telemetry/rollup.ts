import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskTelemetry, PipelineSummary, TelemetryConfig } from './types.js';
import { detectPipelineAnomalies } from './anomalies.js';

/**
 * Aggregate per-task telemetry into a pipeline summary.
 *
 * Reads all .roadrunner/telemetry/TASK-*.json files for the given
 * pipeline_run_id, computes totals and per-stage breakdowns, runs
 * pipeline-level anomaly detection, and writes the summary.
 *
 * @returns The pipeline summary (also printed to stdout by the handler).
 */
export function buildPipelineSummary(
  pipelineRunId: string,
  config: TelemetryConfig,
): PipelineSummary {
  const telemetryDir = path.join(config.artifact_root, 'telemetry');
  const tasks = readTaskTelemetry(telemetryDir, pipelineRunId);

  const perStageCost: Record<string, number> = {};
  const perStageDuration: Record<string, number> = {};
  let totalCost = 0;
  let totalDuration = 0;

  const perTask: PipelineSummary['per_task'] = [];

  for (const task of tasks) {
    totalCost += task.cost_usd;
    totalDuration += task.duration_ms;

    perStageCost[task.stage] = (perStageCost[task.stage] ?? 0) + task.cost_usd;
    perStageDuration[task.stage] = (perStageDuration[task.stage] ?? 0) + task.duration_ms;

    perTask.push({
      task_id: task.task_id,
      cost_usd: task.cost_usd,
      duration_ms: task.duration_ms,
      stage: task.stage,
      model: task.model,
    });
  }

  const summary: PipelineSummary = {
    pipeline_run_id: pipelineRunId,
    total_cost_usd: totalCost,
    total_duration_ms: totalDuration,
    task_count: tasks.length,
    per_stage_cost: perStageCost,
    per_stage_duration: perStageDuration,
    per_task: perTask,
    anomalies: [],
    timestamp: new Date().toISOString(),
  };

  // Pipeline-level anomaly detection
  summary.anomalies = detectPipelineAnomalies(summary, config.thresholds);

  // Write summary file
  fs.mkdirSync(telemetryDir, { recursive: true });
  const summaryPath = path.join(telemetryDir, `summary-${pipelineRunId}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  return summary;
}

/**
 * Format a pipeline summary as a human-readable cost table for stdout.
 */
export function formatCostSummary(summary: PipelineSummary): string {
  const lines: string[] = [];
  lines.push(`Pipeline cost summary (run ${summary.pipeline_run_id}):`);
  lines.push(`  Total: $${summary.total_cost_usd.toFixed(2)} across ${summary.task_count} tasks`);

  for (const [stage, cost] of Object.entries(summary.per_stage_cost)) {
    const taskCount = summary.per_task.filter(t => t.stage === stage).length;
    lines.push(`  ${stage}: $${cost.toFixed(2)} (${taskCount} task${taskCount !== 1 ? 's' : ''})`);
  }

  if (summary.anomalies.length > 0) {
    lines.push(`  Anomalies:`);
    for (const a of summary.anomalies) {
      lines.push(`    - ${a.description}`);
    }
  } else {
    lines.push('  Anomalies: none');
  }

  return lines.join('\n');
}

/** Read all TASK-*.json telemetry files and filter by pipeline_run_id. */
function readTaskTelemetry(
  telemetryDir: string,
  pipelineRunId: string,
): TaskTelemetry[] {
  if (!fs.existsSync(telemetryDir)) return [];

  const files = fs.readdirSync(telemetryDir)
    .filter(f => f.startsWith('TASK-') && f.endsWith('.json'));

  const tasks: TaskTelemetry[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(telemetryDir, file), 'utf8');
      const telemetry = JSON.parse(raw) as TaskTelemetry;
      if (telemetry.pipeline_run_id === pipelineRunId) {
        tasks.push(telemetry);
      }
    } catch {
      // Skip malformed files
    }
  }

  return tasks;
}
