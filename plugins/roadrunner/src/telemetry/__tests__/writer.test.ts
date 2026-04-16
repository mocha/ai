import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeTaskTelemetry } from '../writer.js';
import type { TelemetryConfig, TelemetryMeta, WorkerResultFile } from '../types.js';
import { DEFAULT_THRESHOLDS } from '../types.js';

function makeResult(overrides: Partial<WorkerResultFile> = {}): WorkerResultFile {
  return {
    task_id: 42,
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
    ...overrides,
  };
}

function makeMeta(): TelemetryMeta {
  return {
    pipeline_run_id: 'run-001',
    stage: 'develop',
    model: 'sonnet',
  };
}

function makeConfig(tmpDir: string): TelemetryConfig {
  return {
    artifact_root: path.join(tmpDir, '.roadrunner'),
    thresholds: { ...DEFAULT_THRESHOLDS },
  };
}

describe('writeTaskTelemetry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'writer-test-'));
  });

  function writeResult(result: WorkerResultFile): string {
    const resultsDir = path.join(tmpDir, '.roadrunner', 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const filePath = path.join(resultsDir, `TASK-${result.task_id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(result), 'utf8');
    return filePath;
  }

  it('writes telemetry JSON with all fields populated', () => {
    const resultPath = writeResult(makeResult());
    const config = makeConfig(tmpDir);
    const telemetry = writeTaskTelemetry(resultPath, makeMeta(), config);

    expect(telemetry.task_id).toBe(42);
    expect(telemetry.cost_usd).toBe(0.05);
    expect(telemetry.duration_ms).toBe(10_000);
    expect(telemetry.num_turns).toBe(5);
    expect(telemetry.model).toBe('sonnet');
    expect(telemetry.pipeline_run_id).toBe('run-001');
    expect(telemetry.stage).toBe('develop');
    expect(telemetry.session_id).toBe('sess-abc');
    expect(telemetry.status).toBe('DONE');
    expect(telemetry.round).toBe(1);
    expect(telemetry.timestamp).toBe('2026-04-15T10:00:00Z');

    // CLI Path A: token fields are null
    expect(telemetry.tokens.input).toBeNull();
    expect(telemetry.tokens.output).toBeNull();
  });

  it('writes telemetry file to .roadrunner/telemetry/', () => {
    const resultPath = writeResult(makeResult());
    const config = makeConfig(tmpDir);
    writeTaskTelemetry(resultPath, makeMeta(), config);

    const telemetryPath = path.join(config.artifact_root, 'telemetry', 'TASK-42.json');
    expect(fs.existsSync(telemetryPath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(telemetryPath, 'utf8'));
    expect(data.task_id).toBe(42);
  });

  it('creates telemetry directory if it does not exist', () => {
    const resultPath = writeResult(makeResult());
    const config = makeConfig(tmpDir);
    const telemetryDir = path.join(config.artifact_root, 'telemetry');
    expect(fs.existsSync(telemetryDir)).toBe(false);

    writeTaskTelemetry(resultPath, makeMeta(), config);

    expect(fs.existsSync(telemetryDir)).toBe(true);
  });

  it('is idempotent — calling twice overwrites cleanly', () => {
    const resultPath = writeResult(makeResult());
    const config = makeConfig(tmpDir);

    writeTaskTelemetry(resultPath, makeMeta(), config);
    writeTaskTelemetry(resultPath, makeMeta(), config);

    const telemetryPath = path.join(config.artifact_root, 'telemetry', 'TASK-42.json');
    const data = JSON.parse(fs.readFileSync(telemetryPath, 'utf8'));
    expect(data.task_id).toBe(42);
  });

  it('handles missing optional fields with sensible defaults', () => {
    const result = makeResult();
    delete result.num_turns;
    delete result.session_id;

    const resultPath = writeResult(result);
    const config = makeConfig(tmpDir);
    const telemetry = writeTaskTelemetry(resultPath, makeMeta(), config);

    expect(telemetry.num_turns).toBe(0);
    expect(telemetry.session_id).toBe('');
  });

  it('handles error result (is_error: true)', () => {
    const resultPath = writeResult(makeResult({
      status: 'BLOCKED',
      is_error: true,
      cost_usd: 0.01,
    }));
    const config = makeConfig(tmpDir);
    const telemetry = writeTaskTelemetry(resultPath, makeMeta(), config);

    expect(telemetry.status).toBe('BLOCKED');
    expect(telemetry.cost_usd).toBe(0.01);
  });

  it('anomalies array is empty when below thresholds', () => {
    const resultPath = writeResult(makeResult());
    const config = makeConfig(tmpDir);
    const telemetry = writeTaskTelemetry(resultPath, makeMeta(), config);

    expect(telemetry.anomalies).toHaveLength(0);
  });

  it('detects cost spike anomaly', () => {
    const resultPath = writeResult(makeResult({ cost_usd: 3.50 }));
    const config = makeConfig(tmpDir);
    const telemetry = writeTaskTelemetry(resultPath, makeMeta(), config);

    expect(telemetry.anomalies).toHaveLength(1);
    expect(telemetry.anomalies[0].type).toBe('cost_spike');
  });
});
