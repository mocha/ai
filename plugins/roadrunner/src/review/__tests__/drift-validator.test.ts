import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateDrift, extractIdentifiers } from '../drift-validator.js';
import type { TaskSpec } from '../../orchestrator/types.js';

function makeTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 1,
    title: 'Test task',
    dependencies: [],
    status: 'pending',
    details: '',
    acceptanceCriteria: [],
    relevantFiles: [],
    ...overrides,
  };
}

describe('validateDrift', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'drift-test-'));
    // Create some files in the temp dir
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'handler.ts'), 'export function createHandler() {}');
    fs.writeFileSync(path.join(tmpDir, 'src', 'types.ts'), 'export interface TaskSpec {}');
  });

  it('passes when all referenced files exist', async () => {
    const task = makeTask({
      relevantFiles: ['src/handler.ts', 'src/types.ts'],
    });

    const result = await validateDrift(task, tmpDir);
    expect(result.pass).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it('fails when a referenced file does not exist', async () => {
    const task = makeTask({
      relevantFiles: ['src/handler.ts', 'src/missing.ts'],
    });

    const result = await validateDrift(task, tmpDir);
    expect(result.pass).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].type).toBe('file_missing');
    expect(result.mismatches[0].reference).toBe('src/missing.ts');
  });

  it('passes with empty relevantFiles and no identifiers', async () => {
    const task = makeTask({ relevantFiles: [], details: '' });
    const result = await validateDrift(task, tmpDir);
    expect(result.pass).toBe(true);
  });

  it('detects missing identifiers referenced in details', async () => {
    const task = makeTask({
      details: 'Modify the `NonExistentClass` in the codebase',
    });

    const result = await validateDrift(task, tmpDir);
    expect(result.pass).toBe(false);
    expect(result.mismatches.some(m => m.type === 'identifier_not_found')).toBe(true);
    expect(result.mismatches.some(m => m.reference === 'NonExistentClass')).toBe(true);
  });

  it('passes when identifiers exist in the codebase', async () => {
    const task = makeTask({
      details: 'Update the `createHandler` function',
    });

    const result = await validateDrift(task, tmpDir);
    expect(result.pass).toBe(true);
  });

  it('reports multiple mismatches', async () => {
    const task = makeTask({
      relevantFiles: ['src/missing1.ts', 'src/missing2.ts'],
      details: 'Use `MissingType` from missing module',
    });

    const result = await validateDrift(task, tmpDir);
    expect(result.pass).toBe(false);
    expect(result.mismatches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('extractIdentifiers', () => {
  it('extracts backtick-quoted identifiers', () => {
    const ids = extractIdentifiers('Use `createHandler` and `TaskSpec` here');
    expect(ids).toContain('createHandler');
    expect(ids).toContain('TaskSpec');
  });

  it('strips trailing () from function references', () => {
    const ids = extractIdentifiers('Call `processEvent()` to handle it');
    expect(ids).toContain('processEvent');
    expect(ids).not.toContain('processEvent()');
  });

  it('extracts PascalCase identifiers', () => {
    const ids = extractIdentifiers('The ReviewComplete event triggers routing');
    expect(ids).toContain('ReviewComplete');
  });

  it('skips short identifiers', () => {
    const ids = extractIdentifiers('Use `id` and `OK` values');
    expect(ids).not.toContain('id');
    expect(ids).not.toContain('OK');
  });

  it('skips common programming words', () => {
    const ids = extractIdentifiers('`string` and `number` types');
    expect(ids).not.toContain('string');
    expect(ids).not.toContain('number');
  });

  it('returns empty array for text with no identifiers', () => {
    const ids = extractIdentifiers('Just plain text here');
    expect(ids).toHaveLength(0);
  });
});
