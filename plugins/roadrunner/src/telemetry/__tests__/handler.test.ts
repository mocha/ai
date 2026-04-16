import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTelemetryObserver } from '../handler.js';
import type { OrchestratorEvent } from '../../orchestrator/events.js';
import type { TelemetryConfig, WorkerResultFile } from '../types.js';
import { DEFAULT_THRESHOLDS } from '../types.js';

function makeConfig(tmpDir: string): TelemetryConfig {
  return {
    artifact_root: path.join(tmpDir, '.roadrunner'),
    thresholds: { ...DEFAULT_THRESHOLDS },
  };
}

function writeResultFile(tmpDir: string, taskId: number): string {
  const result: WorkerResultFile = {
    task_id: taskId,
    status: 'DONE',
    round: 1,
    model: 'sonnet',
    timestamp: '2026-04-15T10:00:00Z',
    cost_usd: 0.05,
    duration_ms: 10_000,
    files_changed: ['src/handler.ts'],
    concerns: null,
    hook_events: [],
    num_turns: 5,
    session_id: 'sess-abc',
  };

  const resultsDir = path.join(tmpDir, '.roadrunner', 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const filePath = path.join(resultsDir, `TASK-${taskId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(result), 'utf8');
  return filePath;
}

describe('createTelemetryObserver', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'telemetry-handler-'));
  });

  it('writes telemetry file on WORKER_COMPLETE', () => {
    const config = makeConfig(tmpDir);
    const resultPath = writeResultFile(tmpDir, 1);

    const observer = createTelemetryObserver(config, () => ({
      pipeline_run_id: 'run-001',
      stage: 'develop',
      model: 'sonnet',
    }));

    observer({
      type: 'WORKER_COMPLETE',
      task_id: 1,
      status: 'DONE',
      result_path: resultPath,
      cost_usd: 0.05,
      duration_ms: 10_000,
      files_changed: ['src/handler.ts'],
      concerns: null,
    } as OrchestratorEvent);

    const telemetryPath = path.join(config.artifact_root, 'telemetry', 'TASK-1.json');
    expect(fs.existsSync(telemetryPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(telemetryPath, 'utf8'));
    expect(data.task_id).toBe(1);
    expect(data.pipeline_run_id).toBe('run-001');
  });

  it('builds pipeline summary on FINISH_COMPLETE', () => {
    const config = makeConfig(tmpDir);

    // Write a telemetry file first (simulating prior WORKER_COMPLETE)
    const telemetryDir = path.join(config.artifact_root, 'telemetry');
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.writeFileSync(
      path.join(telemetryDir, 'TASK-1.json'),
      JSON.stringify({
        task_id: 1,
        cost_usd: 0.50,
        duration_ms: 30_000,
        num_turns: 10,
        model: 'sonnet',
        tokens: { input: null, output: null, cache_read: null, cache_creation: null },
        pipeline_run_id: 'run-001',
        stage: 'develop',
        session_id: 'sess',
        status: 'DONE',
        round: 1,
        anomalies: [],
        timestamp: '2026-04-15T10:00:00Z',
      }),
      'utf8',
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const observer = createTelemetryObserver(config, () => ({
      pipeline_run_id: 'run-001',
      stage: 'finish',
      model: 'sonnet',
    }));

    observer({
      type: 'FINISH_COMPLETE',
      summary: 'All done',
    } as OrchestratorEvent);

    // Summary file written
    const summaryPath = path.join(telemetryDir, 'summary-run-001.json');
    expect(fs.existsSync(summaryPath)).toBe(true);

    // Cost table printed
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Pipeline cost summary'));
    logSpy.mockRestore();
  });

  it('ignores events not related to telemetry', () => {
    const config = makeConfig(tmpDir);
    const observer = createTelemetryObserver(config, () => ({
      pipeline_run_id: 'run-001',
      stage: 'develop',
      model: 'sonnet',
    }));

    // Should not throw or write anything
    observer({
      type: 'TRIAGE_COMPLETE',
      input_type: 'raw-idea',
      risk: 'standard',
      path: [],
      existing_artifact: null,
      external_ref: null,
      decompose: false,
      domain_clusters: [],
    } as OrchestratorEvent);

    const telemetryDir = path.join(config.artifact_root, 'telemetry');
    expect(fs.existsSync(telemetryDir)).toBe(false);
  });

  it('does not throw on telemetry failure — logs error instead', () => {
    const config = makeConfig(tmpDir);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const observer = createTelemetryObserver(config, () => ({
      pipeline_run_id: 'run-001',
      stage: 'develop',
      model: 'sonnet',
    }));

    // result_path points to nonexistent file — should catch and log, not throw
    observer({
      type: 'WORKER_COMPLETE',
      task_id: 1,
      status: 'DONE',
      result_path: '/nonexistent/result.json',
      cost_usd: 0.05,
      duration_ms: 10_000,
      files_changed: [],
      concerns: null,
    } as OrchestratorEvent);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[TELEMETRY]'),
      expect.anything(),
    );
    errorSpy.mockRestore();
  });

  it('skips WORKER_COMPLETE with empty result_path', () => {
    const config = makeConfig(tmpDir);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const observer = createTelemetryObserver(config, () => ({
      pipeline_run_id: 'run-001',
      stage: 'develop',
      model: 'sonnet',
    }));

    observer({
      type: 'WORKER_COMPLETE',
      task_id: 1,
      status: 'DONE',
      result_path: '',
      cost_usd: 0.05,
      duration_ms: 10_000,
      files_changed: [],
      concerns: null,
    } as OrchestratorEvent);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no result_path'));
    warnSpy.mockRestore();
  });
});
