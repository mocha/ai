import { describe, it, expect } from 'vitest';
import { detectTaskAnomalies, detectPipelineAnomalies } from '../anomalies.js';
import type { TaskTelemetry, PipelineSummary, AnomalyThresholds } from '../types.js';
import { DEFAULT_THRESHOLDS } from '../types.js';

function makeTelemetry(overrides: Partial<TaskTelemetry> = {}): TaskTelemetry {
  return {
    task_id: 1,
    cost_usd: 0.05,
    duration_ms: 10_000,
    num_turns: 5,
    model: 'sonnet',
    tokens: { input: null, output: null, cache_read: null, cache_creation: null },
    pipeline_run_id: 'run-001',
    stage: 'develop',
    session_id: 'sess-abc',
    status: 'DONE',
    round: 1,
    anomalies: [],
    timestamp: '2026-04-15T10:00:00Z',
    ...overrides,
  };
}

function makeSummary(overrides: Partial<PipelineSummary> = {}): PipelineSummary {
  return {
    pipeline_run_id: 'run-001',
    total_cost_usd: 3.00,
    total_duration_ms: 60_000,
    task_count: 5,
    per_stage_cost: { develop: 1.50, spec_review: 1.50 },
    per_stage_duration: { develop: 30_000, spec_review: 30_000 },
    per_task: [],
    anomalies: [],
    timestamp: '2026-04-15T10:00:00Z',
    ...overrides,
  };
}

describe('detectTaskAnomalies', () => {
  it('returns empty array when all metrics are below thresholds', () => {
    const result = detectTaskAnomalies(makeTelemetry(), DEFAULT_THRESHOLDS);
    expect(result).toHaveLength(0);
  });

  it('detects cost spike', () => {
    const result = detectTaskAnomalies(
      makeTelemetry({ cost_usd: 2.50 }),
      DEFAULT_THRESHOLDS,
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('cost_spike');
    expect(result[0].actual).toBe(2.50);
    expect(result[0].threshold).toBe(2.00);
  });

  it('detects slow task', () => {
    const result = detectTaskAnomalies(
      makeTelemetry({ duration_ms: 1_000_000 }),
      DEFAULT_THRESHOLDS,
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('slow_task');
  });

  it('detects excessive turns', () => {
    const result = detectTaskAnomalies(
      makeTelemetry({ num_turns: 30 }),
      DEFAULT_THRESHOLDS,
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('excessive_turns');
  });

  it('detects multiple anomalies simultaneously', () => {
    const result = detectTaskAnomalies(
      makeTelemetry({ cost_usd: 5.00, duration_ms: 1_200_000, num_turns: 40 }),
      DEFAULT_THRESHOLDS,
    );
    expect(result).toHaveLength(3);
    expect(result.map(a => a.type)).toEqual(['cost_spike', 'slow_task', 'excessive_turns']);
  });

  it('exactly at threshold = no anomaly (strict >)', () => {
    const result = detectTaskAnomalies(
      makeTelemetry({ cost_usd: 2.00, duration_ms: 900_000, num_turns: 25 }),
      DEFAULT_THRESHOLDS,
    );
    expect(result).toHaveLength(0);
  });

  it('respects custom thresholds', () => {
    const custom: AnomalyThresholds = {
      ...DEFAULT_THRESHOLDS,
      cost_spike_usd: 0.01,
    };
    const result = detectTaskAnomalies(makeTelemetry({ cost_usd: 0.05 }), custom);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('cost_spike');
  });
});

describe('detectPipelineAnomalies', () => {
  it('returns empty array when pipeline cost is below threshold', () => {
    const result = detectPipelineAnomalies(makeSummary(), DEFAULT_THRESHOLDS);
    expect(result).toHaveLength(0);
  });

  it('detects pipeline cost spike', () => {
    const result = detectPipelineAnomalies(
      makeSummary({ total_cost_usd: 20.00 }),
      DEFAULT_THRESHOLDS,
    );
    expect(result.some(a => a.type === 'pipeline_cost_spike')).toBe(true);
  });

  it('detects stage imbalance', () => {
    const result = detectPipelineAnomalies(
      makeSummary({
        total_cost_usd: 10.00,
        per_stage_cost: { develop: 8.00, spec_review: 2.00 },
      }),
      DEFAULT_THRESHOLDS,
    );
    expect(result.some(a => a.type === 'stage_imbalance')).toBe(true);
    expect(result.find(a => a.type === 'stage_imbalance')!.description).toContain('develop');
  });

  it('no stage imbalance when costs are balanced', () => {
    const result = detectPipelineAnomalies(
      makeSummary({
        total_cost_usd: 10.00,
        per_stage_cost: { develop: 5.00, spec_review: 5.00 },
      }),
      DEFAULT_THRESHOLDS,
    );
    expect(result.some(a => a.type === 'stage_imbalance')).toBe(false);
  });

  it('handles zero total cost gracefully', () => {
    const result = detectPipelineAnomalies(
      makeSummary({ total_cost_usd: 0, per_stage_cost: {} }),
      DEFAULT_THRESHOLDS,
    );
    expect(result).toHaveLength(0);
  });
});
