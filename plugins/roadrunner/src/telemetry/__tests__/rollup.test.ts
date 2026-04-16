import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPipelineSummary, formatCostSummary } from '../rollup.js';
import type { TaskTelemetry, TelemetryConfig } from '../types.js';
import { DEFAULT_THRESHOLDS } from '../types.js';

function makeConfig(tmpDir: string): TelemetryConfig {
  return {
    artifact_root: path.join(tmpDir, '.roadrunner'),
    thresholds: { ...DEFAULT_THRESHOLDS },
  };
}

function writeTelemetryFile(
  tmpDir: string,
  telemetry: Partial<TaskTelemetry> & { task_id: number; pipeline_run_id: string },
): void {
  const full: TaskTelemetry = {
    cost_usd: 0.05,
    duration_ms: 10_000,
    num_turns: 5,
    model: 'sonnet',
    tokens: { input: null, output: null, cache_read: null, cache_creation: null },
    stage: 'develop',
    session_id: 'sess',
    status: 'DONE',
    round: 1,
    anomalies: [],
    timestamp: '2026-04-15T10:00:00Z',
    ...telemetry,
  };

  const dir = path.join(tmpDir, '.roadrunner', 'telemetry');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `TASK-${full.task_id}.json`),
    JSON.stringify(full),
    'utf8',
  );
}

describe('buildPipelineSummary', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rollup-test-'));
  });

  it('aggregates multiple tasks into correct totals', () => {
    writeTelemetryFile(tmpDir, { task_id: 1, pipeline_run_id: 'run-1', cost_usd: 1.00, duration_ms: 30_000, stage: 'develop' });
    writeTelemetryFile(tmpDir, { task_id: 2, pipeline_run_id: 'run-1', cost_usd: 0.50, duration_ms: 20_000, stage: 'develop' });
    writeTelemetryFile(tmpDir, { task_id: 3, pipeline_run_id: 'run-1', cost_usd: 0.80, duration_ms: 15_000, stage: 'spec_review' });

    const config = makeConfig(tmpDir);
    const summary = buildPipelineSummary('run-1', config);

    expect(summary.task_count).toBe(3);
    expect(summary.total_cost_usd).toBeCloseTo(2.30);
    expect(summary.total_duration_ms).toBe(65_000);
    expect(summary.per_stage_cost['develop']).toBeCloseTo(1.50);
    expect(summary.per_stage_cost['spec_review']).toBeCloseTo(0.80);
    expect(summary.per_task).toHaveLength(3);
  });

  it('filters by pipeline_run_id', () => {
    writeTelemetryFile(tmpDir, { task_id: 1, pipeline_run_id: 'run-1', cost_usd: 1.00 });
    writeTelemetryFile(tmpDir, { task_id: 2, pipeline_run_id: 'run-2', cost_usd: 5.00 });

    const config = makeConfig(tmpDir);
    const summary = buildPipelineSummary('run-1', config);

    expect(summary.task_count).toBe(1);
    expect(summary.total_cost_usd).toBe(1.00);
  });

  it('writes summary file', () => {
    writeTelemetryFile(tmpDir, { task_id: 1, pipeline_run_id: 'run-1' });

    const config = makeConfig(tmpDir);
    buildPipelineSummary('run-1', config);

    const summaryPath = path.join(config.artifact_root, 'telemetry', 'summary-run-1.json');
    expect(fs.existsSync(summaryPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    expect(data.pipeline_run_id).toBe('run-1');
  });

  it('returns valid summary for zero tasks', () => {
    const config = makeConfig(tmpDir);
    // No telemetry files written
    fs.mkdirSync(path.join(config.artifact_root, 'telemetry'), { recursive: true });

    const summary = buildPipelineSummary('run-empty', config);

    expect(summary.task_count).toBe(0);
    expect(summary.total_cost_usd).toBe(0);
    expect(summary.total_duration_ms).toBe(0);
    expect(summary.anomalies).toHaveLength(0);
  });

  it('detects pipeline-level anomalies', () => {
    // Write enough tasks to exceed $15 total
    for (let i = 1; i <= 5; i++) {
      writeTelemetryFile(tmpDir, { task_id: i, pipeline_run_id: 'run-expensive', cost_usd: 4.00 });
    }

    const config = makeConfig(tmpDir);
    const summary = buildPipelineSummary('run-expensive', config);

    expect(summary.total_cost_usd).toBe(20.00);
    expect(summary.anomalies.some(a => a.type === 'pipeline_cost_spike')).toBe(true);
  });

  it('handles single-task pipeline', () => {
    writeTelemetryFile(tmpDir, { task_id: 1, pipeline_run_id: 'run-single', cost_usd: 0.10, stage: 'develop' });

    const config = makeConfig(tmpDir);
    const summary = buildPipelineSummary('run-single', config);

    expect(summary.task_count).toBe(1);
    expect(summary.per_stage_cost).toEqual({ develop: 0.10 });
  });
});

describe('formatCostSummary', () => {
  it('formats a readable cost table', () => {
    const formatTmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'format-test-'));
    const config = makeConfig(formatTmpDir);
    fs.mkdirSync(path.join(config.artifact_root, 'telemetry'), { recursive: true });

    const summary = buildPipelineSummary('run-format', config);
    const output = formatCostSummary(summary);
    expect(output).toContain('Pipeline cost summary');
    expect(output).toContain('$0.00');
    expect(output).toContain('0 tasks');
    expect(output).toContain('Anomalies: none');
  });
});
