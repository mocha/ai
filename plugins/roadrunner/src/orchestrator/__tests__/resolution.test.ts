import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveArtifactPath,
  reconcileTaskId,
  resolveReviewFindingFile,
} from '../resolution.js';
import type { TaskSummary } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadrunner-resolution-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

// ---------------------------------------------------------------------------
// resolveArtifactPath
// ---------------------------------------------------------------------------

describe('resolveArtifactPath', () => {
  it('returns exact match when file exists at reference path', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'SPEC-001.md');
    fs.writeFileSync(filePath, '# Spec');

    const record = resolveArtifactPath(filePath, dir);

    expect(record.resolved_to).toBe(filePath);
    expect(record.method).toBe('exact');
    expect(record.seam).toBe('artifact_path');
    expect(record.reference).toBe(filePath);
    expect(record.candidates).toContain(filePath);
    expect(record.timestamp).toBeTruthy();
  });

  it('returns glob match when artifact ID finds a longer-named file', () => {
    const dir = makeTempDir();
    // Reference points at SPEC-001.md but actual file has a suffix
    const actualFile = path.join(dir, 'SPEC-001-fts5-search.md');
    fs.writeFileSync(actualFile, '# Spec');

    const referencePath = path.join(dir, 'SPEC-001.md');
    const record = resolveArtifactPath(referencePath, dir);

    expect(record.resolved_to).toBe(actualFile);
    expect(record.method).toBe('glob');
    expect(record.candidates).toHaveLength(1);
    expect(record.candidates[0]).toBe(actualFile);
  });

  it('returns null resolved_to when no file matches', () => {
    const dir = makeTempDir();
    const referencePath = path.join(dir, 'SPEC-999.md');

    const record = resolveArtifactPath(referencePath, dir);

    expect(record.resolved_to).toBeNull();
    expect(record.candidates).toHaveLength(0);
  });

  it('returns null resolved_to when multiple glob matches (ambiguous)', () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'SPEC-001-alpha.md'), '# A');
    fs.writeFileSync(path.join(dir, 'SPEC-001-beta.md'), '# B');

    const referencePath = path.join(dir, 'SPEC-001.md');
    const record = resolveArtifactPath(referencePath, dir);

    expect(record.resolved_to).toBeNull();
    expect(record.candidates).toHaveLength(2);
    expect(record.method).toBe('glob');
  });

  it('handles paths with spaces in filenames', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'SPEC-002 with spaces.md');
    fs.writeFileSync(filePath, '# Spec');

    const record = resolveArtifactPath(filePath, dir);

    expect(record.resolved_to).toBe(filePath);
    expect(record.method).toBe('exact');
  });
});

// ---------------------------------------------------------------------------
// reconcileTaskId
// ---------------------------------------------------------------------------

describe('reconcileTaskId', () => {
  const baseTask: TaskSummary = {
    id: 42,
    title: 'Implement FTS5 search',
    status: 'in_progress',
    review_round: 1,
    worker_result_path: null,
    expert_prompt_path: null,
    cost_usd: 0,
    duration_ms: 0,
  };

  it('returns external status as canonical when statuses match', () => {
    const record = reconcileTaskId(baseTask, 'in_progress');

    expect(record.resolved_to).toBe('in_progress');
    expect(record.method).toBe('exact');
    expect(record.seam).toBe('task_id');
    expect(record.reference).toBe('42');
  });

  it('returns external status as canonical and logs warning when statuses disagree', () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '));
    };

    try {
      const record = reconcileTaskId({ ...baseTask, status: 'in_progress' }, 'done');

      expect(record.resolved_to).toBe('done');
      expect(record.method).toBe('exact');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('42');
    } finally {
      console.warn = origWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// resolveReviewFindingFile
// ---------------------------------------------------------------------------

describe('resolveReviewFindingFile', () => {
  it('returns exact match when file exists', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'finding-001.md');
    fs.writeFileSync(filePath, '# Finding');

    const record = resolveReviewFindingFile(filePath, dir);

    expect(record.resolved_to).toBe(filePath);
    expect(record.method).toBe('exact');
    expect(record.seam).toBe('finding_file');
    expect(record.reference).toBe(filePath);
  });

  it('returns null without throwing when file does not exist and no git rename', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'nonexistent-finding.md');

    // Must not throw
    let record: ReturnType<typeof resolveReviewFindingFile> | undefined;
    expect(() => {
      record = resolveReviewFindingFile(filePath, dir);
    }).not.toThrow();

    expect(record!.resolved_to).toBeNull();
    expect(record!.seam).toBe('finding_file');
  });
});
