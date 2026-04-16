import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeVerdict } from '../verdict-writer.js';
import type { ReviewComplete } from '../../orchestrator/events.js';
import type { ReviewConfig } from '../types.js';

function makeReviewComplete(overrides: Partial<ReviewComplete> = {}): ReviewComplete {
  return {
    type: 'REVIEW_COMPLETE',
    task_id: 1,
    verdict: 'SHIP',
    round: 1,
    report_path: 'docs/reports/R-001.md',
    findings: [],
    gate: 'code_quality',
    ...overrides,
  };
}

function makeConfig(tmpDir: string): ReviewConfig {
  return {
    artifact_root: path.join(tmpDir, '.roadrunner'),
    claude_bin: 'claude',
    methodology_path: '',
    project_root: tmpDir,
  };
}

describe('writeVerdict', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'verdict-test-'));
  });

  it('writes valid JSON to .roadrunner/verdicts/TASK-{id}.json', () => {
    const config = makeConfig(tmpDir);
    const event = makeReviewComplete();

    const filePath = writeVerdict(event, 'code_quality', 3, 'sonnet', config);

    expect(filePath).toContain('TASK-1.json');
    expect(fs.existsSync(filePath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(data.task_id).toBe(1);
    expect(data.verdict).toBe('SHIP');
    expect(data.gate).toBe('code_quality');
    expect(data.round).toBe(1);
    expect(data.panel_size).toBe(3);
    expect(data.model).toBe('sonnet');
    expect(data.timestamp).toBeDefined();
    expect(data.report_path).toBe('docs/reports/R-001.md');
  });

  it('computes findings_summary from findings array', () => {
    const config = makeConfig(tmpDir);
    const event = makeReviewComplete({
      findings: [
        { severity: 'blocking', description: 'Critical bug', file: 'src/a.ts', line: 1 },
        { severity: 'major', description: 'Missing test', file: 'src/b.ts', line: 2 },
        { severity: 'major', description: 'No error handling', file: 'src/c.ts', line: 3 },
        { severity: 'minor', description: 'Style issue', file: 'src/d.ts', line: 4 },
        { severity: 'suggestion', description: 'Consider refactoring', file: 'src/e.ts', line: 5 },
      ],
    });

    const filePath = writeVerdict(event, 'code_quality', 3, 'sonnet', config);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    expect(data.findings_summary).toEqual({
      blocking: 1,
      major: 2,
      minor: 1,
      suggestion: 1,
    });
  });

  it('creates verdicts directory if it does not exist', () => {
    const config = makeConfig(tmpDir);
    const verdictsDir = path.join(config.artifact_root, 'verdicts');
    expect(fs.existsSync(verdictsDir)).toBe(false);

    writeVerdict(makeReviewComplete(), 'code_quality', 3, 'sonnet', config);

    expect(fs.existsSync(verdictsDir)).toBe(true);
  });

  it('overwrites existing verdict for same task', () => {
    const config = makeConfig(tmpDir);

    const path1 = writeVerdict(
      makeReviewComplete({ verdict: 'REVISE', round: 1 }),
      'code_quality', 3, 'sonnet', config,
    );

    const path2 = writeVerdict(
      makeReviewComplete({ verdict: 'SHIP', round: 2 }),
      'code_quality', 3, 'sonnet', config,
    );

    expect(path1).toBe(path2);
    const data = JSON.parse(fs.readFileSync(path2, 'utf8'));
    expect(data.verdict).toBe('SHIP');
    expect(data.round).toBe(2);
  });

  it('records spec_compliance gate correctly', () => {
    const config = makeConfig(tmpDir);
    const filePath = writeVerdict(
      makeReviewComplete({ verdict: 'REVISE' }),
      'spec_compliance', 1, 'sonnet', config,
    );

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(data.gate).toBe('spec_compliance');
    expect(data.panel_size).toBe(1);
  });
});
