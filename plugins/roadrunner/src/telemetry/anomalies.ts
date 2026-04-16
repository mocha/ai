import type { TaskTelemetry, AnomalyRecord, AnomalyThresholds, PipelineSummary } from './types.js';

/**
 * Detect per-task anomalies based on configurable thresholds.
 * Returns an empty array when all metrics are within bounds.
 */
export function detectTaskAnomalies(
  telemetry: TaskTelemetry,
  thresholds: AnomalyThresholds,
): AnomalyRecord[] {
  const anomalies: AnomalyRecord[] = [];

  if (telemetry.cost_usd > thresholds.cost_spike_usd) {
    anomalies.push({
      type: 'cost_spike',
      description: `Task ${telemetry.task_id} cost $${telemetry.cost_usd.toFixed(2)} (threshold: $${thresholds.cost_spike_usd.toFixed(2)})`,
      threshold: thresholds.cost_spike_usd,
      actual: telemetry.cost_usd,
    });
  }

  if (telemetry.duration_ms > thresholds.slow_task_ms) {
    const mins = (telemetry.duration_ms / 60_000).toFixed(1);
    const threshMins = (thresholds.slow_task_ms / 60_000).toFixed(1);
    anomalies.push({
      type: 'slow_task',
      description: `Task ${telemetry.task_id} took ${mins}min (threshold: ${threshMins}min)`,
      threshold: thresholds.slow_task_ms,
      actual: telemetry.duration_ms,
    });
  }

  if (telemetry.num_turns > thresholds.excessive_turns) {
    anomalies.push({
      type: 'excessive_turns',
      description: `Task ${telemetry.task_id} used ${telemetry.num_turns} turns (threshold: ${thresholds.excessive_turns})`,
      threshold: thresholds.excessive_turns,
      actual: telemetry.num_turns,
    });
  }

  return anomalies;
}

/**
 * Detect pipeline-level anomalies from the aggregated summary.
 */
export function detectPipelineAnomalies(
  summary: PipelineSummary,
  thresholds: AnomalyThresholds,
): AnomalyRecord[] {
  const anomalies: AnomalyRecord[] = [];

  if (summary.total_cost_usd > thresholds.pipeline_cost_spike_usd) {
    anomalies.push({
      type: 'pipeline_cost_spike',
      description: `Pipeline total $${summary.total_cost_usd.toFixed(2)} (threshold: $${thresholds.pipeline_cost_spike_usd.toFixed(2)})`,
      threshold: thresholds.pipeline_cost_spike_usd,
      actual: summary.total_cost_usd,
    });
  }

  // Stage imbalance: any single stage > threshold fraction of total cost
  if (summary.total_cost_usd > 0) {
    for (const [stage, cost] of Object.entries(summary.per_stage_cost)) {
      const fraction = cost / summary.total_cost_usd;
      if (fraction > thresholds.stage_imbalance_ratio) {
        anomalies.push({
          type: 'stage_imbalance',
          description: `Stage "${stage}" is ${(fraction * 100).toFixed(0)}% of total cost (threshold: ${(thresholds.stage_imbalance_ratio * 100).toFixed(0)}%)`,
          threshold: thresholds.stage_imbalance_ratio,
          actual: fraction,
        });
      }
    }
  }

  return anomalies;
}
