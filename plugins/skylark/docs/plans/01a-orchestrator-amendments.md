# Domain 1a: Orchestrator Amendments -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the six amendments to the orchestrator spec: bookend sizing gates, compound review states, timeouts, dispatch error handling, unified task query response, and resolution seams.

**Architecture:** These amendments extend the orchestrator built by the `01-orchestrator-core.md` plan. New pure-function modules (sizing, resolution) are built and tested independently, then wired into updated type definitions, guards, actions, and machine states. The machine definition from original Task 7 is restructured with compound review states, sizing gate states, timeout transitions, and a global error handler.

**Tech Stack:** TypeScript, XState v5, Vitest, Node.js fs/path/child_process

**Target:** `plugins/roadrunner/` — a new plugin alongside Skylark for side-by-side comparison.

**Prerequisite:** Original Task 1 (project scaffolding) is complete — `plugins/roadrunner/` exists with `package.json`, `tsconfig.json`, XState and Vitest installed. This plan builds the full orchestrator from scratch in roadrunner, incorporating both the original spec and all amendments.

---

## Build Order Summary

| # | Task | Depends On | Scope |
|---|------|-----------|-------|
| A1 | Sizing heuristics module | -- | medium |
| A2 | Resolution seams module | -- | medium |
| A3 | Updated event type definitions | -- | small |
| A4 | Updated command type definitions | -- | small |
| A5 | Updated context and shared types | -- | small |
| A6 | New guard functions | A5 | medium |
| A7 | New action functions | A3, A4, A5, A1 | medium |
| A8 | Bus retry logic | A3 | small |
| A9 | Machine: compound review states | A6, A7 | large |
| A10 | Machine: sizing gates, timeouts, error handling, blocked state | A1, A6, A7, A9 | large |
| A11 | Unit tests: sizing and resolution | A1, A2 | medium |
| A12 | Unit tests: new guards | A6 | medium |
| A13 | Unit tests: amended machine transitions | A9, A10 | large |
| A14 | Updated integration test | A9, A10, A8 | medium |

Tasks A1 and A2 have no dependencies and can be built in parallel.
Tasks A3, A4, A5 have no cross-dependencies and can be built in parallel.

---

## Task A1: Sizing heuristics module

### Description

Pure-function module that evaluates artifact size against configurable
thresholds. Used by the `size_check_pre_spec` and `size_check_pre_plan`
orchestrator states to decide whether an artifact should be reviewed
as-is or decomposed first.

### Files

- Create: `plugins/roadrunner/src/orchestrator/sizing.ts`
- Create: `plugins/roadrunner/src/orchestrator/__tests__/sizing.test.ts`

### Steps

- [ ] **Step 1: Write failing tests for token counting**

```typescript
// plugins/roadrunner/src/orchestrator/__tests__/sizing.test.ts
import { describe, it, expect } from 'vitest';
import { countProseTokens, countProseLines, countFileBlastRadius, evaluateSizing } from '../sizing.js';

describe('countProseTokens', () => {
  it('counts tokens in plain prose', () => {
    const prose = 'This is a simple sentence with eight words in it.';
    const count = countProseTokens(prose);
    // Approximate: ~1 token per 4 chars for English prose
    expect(count).toBeGreaterThan(8);
    expect(count).toBeLessThan(20);
  });

  it('excludes fenced code blocks', () => {
    const content = [
      'Some prose here.',
      '```typescript',
      'const x = 1;',
      'const y = 2;',
      'const z = 3;',
      '```',
      'More prose here.',
    ].join('\n');
    const withCode = countProseTokens(content);

    const proseOnly = 'Some prose here.\nMore prose here.';
    const withoutCode = countProseTokens(proseOnly);

    // Token count with code stripped should be close to prose-only count
    expect(withCode).toBeCloseTo(withoutCode, -1);
  });

  it('excludes JSON blocks', () => {
    const content = [
      'Description of the API:',
      '```json',
      '{"key": "value", "nested": {"deep": true}}',
      '```',
      'End of description.',
    ].join('\n');
    const count = countProseTokens(content);
    const proseOnly = countProseTokens('Description of the API:\nEnd of description.');
    expect(count).toBeCloseTo(proseOnly, -1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/orchestrator/__tests__/sizing.test.ts`
Expected: FAIL with "countProseTokens is not a function" or similar import error.

- [ ] **Step 3: Implement token counting**

```typescript
// plugins/roadrunner/src/orchestrator/sizing.ts

/**
 * Strip fenced code blocks from markdown content.
 * Matches ```lang ... ``` blocks including the fence lines.
 */
function stripCodeBlocks(content: string): string {
  return content.replace(/^```[\s\S]*?^```/gm, '');
}

/**
 * Approximate token count for prose content.
 * Uses the ~4 chars per token heuristic for English text.
 * Strips fenced code blocks before counting.
 */
export function countProseTokens(content: string): number {
  const prose = stripCodeBlocks(content);
  // Remove blank lines and trim
  const cleaned = prose.replace(/\n{2,}/g, '\n').trim();
  if (cleaned.length === 0) return 0;
  // ~4 characters per token for English prose (conservative estimate)
  return Math.ceil(cleaned.length / 4);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/orchestrator/__tests__/sizing.test.ts`
Expected: PASS for countProseTokens tests.

- [ ] **Step 5: Write failing tests for prose line counting**

Add to the test file:

```typescript
describe('countProseLines', () => {
  it('counts hard-wrapped lines excluding code blocks', () => {
    const content = [
      'Line one.',
      'Line two.',
      '```',
      'code line 1',
      'code line 2',
      '```',
      'Line three.',
    ].join('\n');
    expect(countProseLines(content)).toBe(3);
  });

  it('excludes blank lines', () => {
    const content = 'Line one.\n\n\nLine two.\n\nLine three.';
    expect(countProseLines(content)).toBe(3);
  });

  it('returns 0 for empty content', () => {
    expect(countProseLines('')).toBe(0);
  });

  it('returns 0 for code-only content', () => {
    const content = '```\ncode only\n```';
    expect(countProseLines(content)).toBe(0);
  });
});
```

- [ ] **Step 6: Implement prose line counting**

Add to `sizing.ts`:

```typescript
/**
 * Count non-blank prose lines, excluding fenced code blocks.
 */
export function countProseLines(content: string): number {
  const prose = stripCodeBlocks(content);
  const lines = prose.split('\n').filter(line => line.trim().length > 0);
  return lines.length;
}
```

- [ ] **Step 7: Run tests to verify prose line counting passes**

Run: `npx vitest run src/orchestrator/__tests__/sizing.test.ts`
Expected: PASS for all tests so far.

- [ ] **Step 8: Write failing tests for file blast radius**

Add to the test file:

```typescript
describe('countFileBlastRadius', () => {
  it('counts distinct file paths referenced in content', () => {
    const content = [
      'Modify `src/db/search.ts` to add the index.',
      'Update `src/db/schema.ts` with the new column.',
      'Add tests in `tests/db/search.test.ts`.',
      'Also touch `src/db/search.ts` again for the query.',
    ].join('\n');
    // 3 distinct files (search.ts mentioned twice)
    expect(countFileBlastRadius(content)).toBe(3);
  });

  it('detects paths in backtick-quoted references', () => {
    const content = 'The file `src/components/Header.tsx` needs updating.';
    expect(countFileBlastRadius(content)).toBe(1);
  });

  it('detects paths without backticks', () => {
    const content = 'Modify src/index.ts and src/app.ts for the change.';
    expect(countFileBlastRadius(content)).toBe(2);
  });

  it('returns 0 when no file paths found', () => {
    const content = 'This is a general description with no file references.';
    expect(countFileBlastRadius(content)).toBe(0);
  });
});
```

- [ ] **Step 9: Implement file blast radius counting**

Add to `sizing.ts`:

```typescript
/**
 * Count distinct file paths referenced in content.
 * Looks for patterns like `path/to/file.ext` and bare path/to/file.ext
 * where the extension is a known code/config file type.
 */
export function countFileBlastRadius(content: string): number {
  const extensions = 'ts|tsx|js|jsx|py|go|rs|java|rb|sql|json|yaml|yml|toml|md|css|scss|html|vue|svelte';
  // Match backtick-quoted paths and bare paths with known extensions
  const pattern = new RegExp(
    `(?:\`([\\w./-]+\\.(?:${extensions}))\`)|(?:(?:^|\\s)((?:[\\w.-]+/)+[\\w.-]+\\.(?:${extensions})))`,
    'gm'
  );
  const files = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const filePath = match[1] || match[2];
    if (filePath) files.add(filePath);
  }
  return files.size;
}
```

- [ ] **Step 10: Run tests to verify file blast radius passes**

Run: `npx vitest run src/orchestrator/__tests__/sizing.test.ts`
Expected: PASS for all tests.

- [ ] **Step 11: Write failing tests for evaluateSizing**

Add to the test file:

```typescript
import type { SizingConfig, SizingResult } from '../types.js';

const defaultConfig: SizingConfig = {
  max_prose_tokens: 2500,
  max_prose_lines: 200,
  max_file_blast_radius: 4,
};

describe('evaluateSizing', () => {
  it('returns "under" when all metrics are below thresholds', () => {
    const content = 'A short spec.\nTwo lines of prose.';
    const result = evaluateSizing(content, defaultConfig);
    expect(result.verdict).toBe('under');
    expect(result.token_count).toBeGreaterThan(0);
    expect(result.prose_line_count).toBe(2);
    expect(result.file_blast_radius).toBe(0);
  });

  it('returns "over" when token count exceeds ceiling', () => {
    // Generate content over 2500 tokens (~10,000 chars)
    const content = 'word '.repeat(2600);
    const result = evaluateSizing(content, defaultConfig);
    expect(result.verdict).toBe('over');
  });

  it('returns "over" when prose lines exceed ceiling', () => {
    const lines = Array.from({ length: 250 }, (_, i) => `Line ${i + 1}: some content here.`);
    const content = lines.join('\n');
    const result = evaluateSizing(content, defaultConfig);
    expect(result.verdict).toBe('over');
  });

  it('returns "over" when file blast radius exceeds ceiling', () => {
    const content = [
      'Modify `src/a.ts`.',
      'Modify `src/b.ts`.',
      'Modify `src/c.ts`.',
      'Modify `src/d.ts`.',
      'Modify `src/e.ts`.',
    ].join('\n');
    const result = evaluateSizing(content, defaultConfig);
    expect(result.verdict).toBe('over');
    expect(result.file_blast_radius).toBe(5);
  });

  it('returns "ambiguous" when metrics are between 70%-100% of ceiling', () => {
    // ~175 prose lines (87.5% of 200 ceiling) — in the ambiguous zone
    const lines = Array.from({ length: 175 }, (_, i) => `Line ${i}: content.`);
    const content = lines.join('\n');
    const result = evaluateSizing(content, defaultConfig);
    expect(result.verdict).toBe('ambiguous');
  });
});
```

- [ ] **Step 12: Implement evaluateSizing**

Add to `sizing.ts`:

```typescript
import type { SizingConfig, SizingResult } from './types.js';

/** Threshold ratio above which a metric is "ambiguous" (70% of ceiling). */
const AMBIGUOUS_THRESHOLD = 0.7;

/**
 * Evaluate an artifact's size against configurable thresholds.
 * Returns a SizingResult with verdict: 'under' | 'over' | 'ambiguous'.
 *
 * - 'over': any metric exceeds its ceiling.
 * - 'ambiguous': no metric exceeds ceiling, but at least one is above 70%.
 * - 'under': all metrics are below 70% of their ceilings.
 */
export function evaluateSizing(content: string, config: SizingConfig): SizingResult {
  const token_count = countProseTokens(content);
  const prose_line_count = countProseLines(content);
  const file_blast_radius = countFileBlastRadius(content);

  // Check hard ceilings
  if (
    token_count > config.max_prose_tokens ||
    prose_line_count > config.max_prose_lines ||
    file_blast_radius > config.max_file_blast_radius
  ) {
    return { token_count, prose_line_count, file_blast_radius, verdict: 'over' };
  }

  // Check ambiguous zone (70%-100% of any ceiling)
  if (
    token_count > config.max_prose_tokens * AMBIGUOUS_THRESHOLD ||
    prose_line_count > config.max_prose_lines * AMBIGUOUS_THRESHOLD ||
    file_blast_radius > config.max_file_blast_radius * AMBIGUOUS_THRESHOLD
  ) {
    return { token_count, prose_line_count, file_blast_radius, verdict: 'ambiguous' };
  }

  return { token_count, prose_line_count, file_blast_radius, verdict: 'under' };
}
```

- [ ] **Step 13: Run all sizing tests**

Run: `npx vitest run src/orchestrator/__tests__/sizing.test.ts`
Expected: ALL PASS.

- [ ] **Step 14: Commit**

```bash
git add plugins/roadrunner/src/orchestrator/sizing.ts plugins/roadrunner/src/orchestrator/__tests__/sizing.test.ts
git commit -m "feat(orchestrator): add sizing heuristics module for pre-review gates"
```

### Dependencies

None. This is a pure-function module.

### Estimated scope

Medium (150-250 LOC including tests).

---

## Task A2: Resolution seams module

### Description

Module with three resolver functions for handling naming drift at
specific seams in the orchestrator. Deterministic resolution first
(exact match, glob, git), with structured logging for auditability.
The Haiku LLM fallback is NOT implemented here -- it is dispatched
by an action function when the resolver returns no result. This module
is pure resolution logic.

### Files

- Create: `plugins/roadrunner/src/orchestrator/resolution.ts`
- Create: `plugins/roadrunner/src/orchestrator/__tests__/resolution.test.ts`

### Steps

- [ ] **Step 1: Write failing tests for artifact path resolution**

```typescript
// plugins/roadrunner/src/orchestrator/__tests__/resolution.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolveArtifactPath } from '../resolution.js';

describe('resolveArtifactPath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolution-test-'));
    // Create test files
    const specsDir = path.join(tmpDir, 'docs', 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'SPEC-001-fts5-search.md'), 'spec content');
    fs.writeFileSync(path.join(specsDir, 'SPEC-002-auth-flow.md'), 'spec content');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves exact path match', () => {
    const exactPath = path.join(tmpDir, 'docs', 'specs', 'SPEC-001-fts5-search.md');
    const result = resolveArtifactPath(exactPath, tmpDir);
    expect(result.resolved_to).toBe(exactPath);
    expect(result.method).toBe('exact');
  });

  it('resolves via glob when exact path has no slug', () => {
    const refPath = path.join(tmpDir, 'docs', 'specs', 'SPEC-001.md');
    const result = resolveArtifactPath(refPath, tmpDir);
    expect(result.resolved_to).toContain('SPEC-001-fts5-search.md');
    expect(result.method).toBe('glob');
  });

  it('returns null when no match found', () => {
    const refPath = path.join(tmpDir, 'docs', 'specs', 'SPEC-999.md');
    const result = resolveArtifactPath(refPath, tmpDir);
    expect(result.resolved_to).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  it('returns null with multiple candidates (ambiguous)', () => {
    // Create a second SPEC-001 file to make it ambiguous
    const specsDir = path.join(tmpDir, 'docs', 'specs');
    fs.writeFileSync(path.join(specsDir, 'SPEC-001-alternate.md'), 'alt content');
    const refPath = path.join(tmpDir, 'docs', 'specs', 'SPEC-001.md');
    const result = resolveArtifactPath(refPath, tmpDir);
    expect(result.resolved_to).toBeNull();
    expect(result.candidates.length).toBe(2);
    expect(result.method).toBe('glob');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/orchestrator/__tests__/resolution.test.ts`
Expected: FAIL with import error.

- [ ] **Step 3: Implement artifact path resolution**

```typescript
// plugins/roadrunner/src/orchestrator/resolution.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { globSync } from 'node:fs';
import type { ResolutionRecord } from './types.js';

/**
 * Resolve an artifact file path reference.
 * 1. Exact match (fs.existsSync)
 * 2. Glob match (derive pattern from the artifact ID prefix)
 * Returns a ResolutionRecord with resolved_to (or null if ambiguous/missing).
 */
export function resolveArtifactPath(
  referencePath: string,
  baseDir: string,
): ResolutionRecord {
  const timestamp = new Date().toISOString();

  // 1. Exact match
  if (fs.existsSync(referencePath)) {
    return {
      timestamp,
      seam: 'artifact_path',
      reference: referencePath,
      candidates: [referencePath],
      resolved_to: referencePath,
      method: 'exact',
    };
  }

  // 2. Glob match — extract the artifact ID prefix (e.g., SPEC-001 from SPEC-001.md)
  const basename = path.basename(referencePath, path.extname(referencePath));
  const dir = path.dirname(referencePath);
  const ext = path.extname(referencePath) || '.md';
  const pattern = path.join(dir, `${basename}*${ext}`);

  let candidates: string[] = [];
  try {
    candidates = globSync(pattern);
  } catch {
    // globSync may throw on invalid patterns; treat as no match
  }

  if (candidates.length === 1) {
    return {
      timestamp,
      seam: 'artifact_path',
      reference: referencePath,
      candidates,
      resolved_to: candidates[0],
      method: 'glob',
    };
  }

  // 0 or 2+ matches — cannot resolve deterministically
  return {
    timestamp,
    seam: 'artifact_path',
    reference: referencePath,
    candidates,
    resolved_to: null,
    method: 'glob',
  };
}
```

- [ ] **Step 4: Run tests to verify artifact path resolution passes**

Run: `npx vitest run src/orchestrator/__tests__/resolution.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing tests for task ID reconciliation**

Add to the test file:

```typescript
import { reconcileTaskId } from '../resolution.js';
import type { TaskSummary } from '../types.js';

describe('reconcileTaskId', () => {
  it('returns updated record when orchestrator and external disagree', () => {
    const orchestratorTask: TaskSummary = {
      id: 5,
      title: 'Add search',
      status: 'in_progress',
      review_round: 0,
      worker_result_path: null,
      expert_prompt_path: null,
      cost_usd: 0,
      duration_ms: 0,
    };
    const externalStatus = 'pending';

    const result = reconcileTaskId(orchestratorTask, externalStatus);
    expect(result.resolved_to).toBe('pending');
    expect(result.method).toBe('exact');
    expect(result.seam).toBe('task_id');
  });

  it('returns matching record when statuses agree', () => {
    const orchestratorTask: TaskSummary = {
      id: 5,
      title: 'Add search',
      status: 'in_progress',
      review_round: 0,
      worker_result_path: null,
      expert_prompt_path: null,
      cost_usd: 0,
      duration_ms: 0,
    };
    const externalStatus = 'in_progress';

    const result = reconcileTaskId(orchestratorTask, externalStatus);
    expect(result.resolved_to).toBe('in_progress');
  });
});
```

- [ ] **Step 6: Implement task ID reconciliation**

Add to `resolution.ts`:

```typescript
import type { TaskSummary } from './types.js';

/**
 * Reconcile orchestrator's task status with Taskmaster's canonical status.
 * Taskmaster is always canonical. Returns the canonical status and logs
 * discrepancies.
 */
export function reconcileTaskId(
  orchestratorTask: TaskSummary,
  externalStatus: string,
): ResolutionRecord {
  const timestamp = new Date().toISOString();
  const reference = `task:${orchestratorTask.id}:${orchestratorTask.status}`;

  if (orchestratorTask.status !== externalStatus) {
    console.warn(
      `[resolution] Task ${orchestratorTask.id} status mismatch: ` +
      `orchestrator=${orchestratorTask.status}, taskmaster=${externalStatus}. ` +
      `Using Taskmaster as canonical.`
    );
  }

  return {
    timestamp,
    seam: 'task_id',
    reference,
    candidates: [orchestratorTask.status, externalStatus],
    resolved_to: externalStatus,
    method: 'exact',
  };
}
```

- [ ] **Step 7: Run tests to verify task ID reconciliation passes**

Run: `npx vitest run src/orchestrator/__tests__/resolution.test.ts`
Expected: PASS.

- [ ] **Step 8: Write failing tests for review finding file resolution**

Add to the test file:

```typescript
import { resolveReviewFindingFile } from '../resolution.js';

describe('resolveReviewFindingFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finding-test-'));
    const srcDir = path.join(tmpDir, 'src', 'db');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'search.ts'), 'export function search() {}');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves existing file path', () => {
    const filePath = path.join(tmpDir, 'src', 'db', 'search.ts');
    const result = resolveReviewFindingFile(filePath, tmpDir);
    expect(result.resolved_to).toBe(filePath);
    expect(result.method).toBe('exact');
  });

  it('returns null for missing file without blocking', () => {
    const filePath = path.join(tmpDir, 'src', 'db', 'missing.ts');
    const result = resolveReviewFindingFile(filePath, tmpDir);
    expect(result.resolved_to).toBeNull();
    // The key property: no error thrown, just null resolution
  });
});
```

- [ ] **Step 9: Implement review finding file resolution**

Add to `resolution.ts`:

```typescript
/**
 * Resolve a file path from a review finding.
 * 1. Exact match
 * 2. Git rename detection (git log --follow --diff-filter=R)
 * Returns resolved path or null. Does NOT block verdict routing.
 */
export function resolveReviewFindingFile(
  filePath: string,
  baseDir: string,
): ResolutionRecord {
  const timestamp = new Date().toISOString();

  // 1. Exact match
  if (fs.existsSync(filePath)) {
    return {
      timestamp,
      seam: 'finding_file',
      reference: filePath,
      candidates: [filePath],
      resolved_to: filePath,
      method: 'exact',
    };
  }

  // 2. Git rename detection
  try {
    const result = execSync(
      `git log --follow --diff-filter=R --name-only --pretty=format: -1 -- "${filePath}"`,
      { cwd: baseDir, encoding: 'utf-8', timeout: 5000 }
    ).trim();

    if (result) {
      const newPath = path.join(baseDir, result.split('\n')[0]);
      if (fs.existsSync(newPath)) {
        return {
          timestamp,
          seam: 'finding_file',
          reference: filePath,
          candidates: [newPath],
          resolved_to: newPath,
          method: 'git_follow',
        };
      }
    }
  } catch {
    // Git command failed — not in a repo, or path never existed in git
  }

  // Not found — return null, do not block
  return {
    timestamp,
    seam: 'finding_file',
    reference: filePath,
    candidates: [],
    resolved_to: null,
    method: 'exact',
  };
}
```

- [ ] **Step 10: Run all resolution tests**

Run: `npx vitest run src/orchestrator/__tests__/resolution.test.ts`
Expected: ALL PASS.

- [ ] **Step 11: Commit**

```bash
git add plugins/roadrunner/src/orchestrator/resolution.ts plugins/roadrunner/src/orchestrator/__tests__/resolution.test.ts
git commit -m "feat(orchestrator): add resolution seams module for naming drift handling"
```

### Dependencies

None. This is a standalone module.

### Estimated scope

Medium (200-300 LOC including tests).

---

## Task A3: Updated event type definitions

### Description

Add new events and update existing events in `events.ts` to support
the amendments: `QueryResult`, `SizingAmbiguous`, `HaikuSizingResult`,
updated completion events with decomposition fields, updated
`DispatchError` with attempts field.

### Files

- Modify: `plugins/roadrunner/src/orchestrator/events.ts`

### Steps

- [ ] **Step 1: Add QueryResult event (replaces TASK_READY in next_task routing)**

Add to `events.ts`:

```typescript
interface QueryResult {
  type: 'QUERY_RESULT';
  outcome: 'task_ready' | 'all_complete' | 'all_blocked';
  task?: TaskSpec;
  blocked_task_ids?: number[];
  blocked_reasons?: string[];
}
```

Add `QueryResult` to the `OrchestratorEvent` union.

- [ ] **Step 2: Add sizing gate events**

Add to `events.ts`:

```typescript
interface SizingAmbiguous {
  type: 'SIZING_AMBIGUOUS';
  sizing_result: SizingResult;
}

interface HaikuSizingResult {
  type: 'HAIKU_SIZING_RESULT';
  answer: 'single' | 'multiple';
  rationale: string;
}
```

Add both to the `OrchestratorEvent` union.

- [ ] **Step 3: Update completion events with decomposition signal**

Update the existing `PrepareComplete`, `BrainstormComplete`, and
`PlanComplete` interfaces:

```typescript
interface PrepareComplete {
  type: 'PREPARE_COMPLETE';
  spec_path: string;
  decomposition_recommended: boolean;
  decomposition_rationale: string | null;
}

interface BrainstormComplete {
  type: 'BRAINSTORM_COMPLETE';
  spec_path: string;
  decomposition_recommended: boolean;
  decomposition_rationale: string | null;
}

interface PlanComplete {
  type: 'PLAN_COMPLETE';
  plan_path: string;
  decomposition_recommended: boolean;
  decomposition_rationale: string | null;
}
```

- [ ] **Step 4: Update DispatchError with attempts field**

Update the existing `DispatchError` interface:

```typescript
interface DispatchError {
  type: 'DISPATCH_ERROR';
  failed_command: string;
  error_message: string;
  attempts: number;
}
```

- [ ] **Step 5: Remove TASK_READY from the union (absorbed into QueryResult)**

Remove the `TaskReady` interface. Update the `OrchestratorEvent` union
to replace `TaskReady` with `QueryResult`. Keep `StatusRollup` as it
is still used as a global notification event.

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS with zero errors.

- [ ] **Step 7: Commit**

```bash
git add plugins/roadrunner/src/orchestrator/events.ts
git commit -m "feat(orchestrator): update event types for amendments (QueryResult, sizing, decomposition)"
```

### Dependencies

None (types only).

### Estimated scope

Small (< 50 LOC of changes).

---

## Task A4: Updated command type definitions

### Description

Add the `DecomposeArtifact` and `DispatchHaikuSizing` commands to
`commands.ts`.

### Files

- Modify: `plugins/roadrunner/src/orchestrator/commands.ts`

### Steps

- [ ] **Step 1: Add DecomposeArtifact command**

Add to `commands.ts`:

```typescript
interface DecomposeArtifact {
  type: 'DECOMPOSE_ARTIFACT';
  artifact_path: string;
  artifact_type: 'spec' | 'plan';
  reason: 'size_gate_mechanical' | 'size_gate_haiku' | 'agent_recommended';
  sizing_result?: SizingResult;
}
```

Add to the `OrchestratorCommand` union.

- [ ] **Step 2: Add DispatchHaikuSizing command**

Add to `commands.ts`:

```typescript
interface DispatchHaikuSizing {
  type: 'DISPATCH_HAIKU_SIZING';
  artifact_path: string;
  artifact_type: 'spec' | 'plan';
  sizing_result: SizingResult;
}
```

Add to the `OrchestratorCommand` union.

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS with zero errors.

- [ ] **Step 4: Commit**

```bash
git add plugins/roadrunner/src/orchestrator/commands.ts
git commit -m "feat(orchestrator): add DecomposeArtifact and DispatchHaikuSizing commands"
```

### Dependencies

None (types only).

### Estimated scope

Small (< 30 LOC of changes).

---

## Task A5: Updated context and shared types

### Description

Add `SizingResult`, `SizingConfig`, `ResolutionRecord` types and
update `OrchestratorContext` with new fields.

### Files

- Modify: `plugins/roadrunner/src/orchestrator/types.ts`
- Modify: `plugins/roadrunner/src/orchestrator/context.ts`

### Steps

- [ ] **Step 1: Add new types to types.ts**

Add to `types.ts`:

```typescript
export interface SizingResult {
  token_count: number;
  prose_line_count: number;
  file_blast_radius: number;
  verdict: 'under' | 'over' | 'ambiguous';
}

export interface SizingConfig {
  max_prose_tokens: number;
  max_prose_lines: number;
  max_file_blast_radius: number;
}

export interface ResolutionRecord {
  timestamp: string;
  seam: 'artifact_path' | 'task_id' | 'finding_file';
  reference: string;
  candidates: string[];
  resolved_to: string | null;
  method: 'exact' | 'glob' | 'git_follow' | 'llm' | 'user';
}

export type QueryOutcome = 'task_ready' | 'all_complete' | 'all_blocked';
```

- [ ] **Step 2: Update OrchestratorContext in context.ts**

Add these fields to the `OrchestratorContext` interface:

```typescript
// Sizing gate
last_sizing_result: SizingResult | null;

// Resolution audit trail (bounded, last 20 entries)
resolutions: ResolutionRecord[];

// Sizing configuration (loaded from .skylark/config.json or defaults)
sizing_config: SizingConfig;
```

- [ ] **Step 3: Update createDefaultContext() with new field defaults**

Add to the factory function:

```typescript
last_sizing_result: null,
resolutions: [],
sizing_config: {
  max_prose_tokens: 2500,
  max_prose_lines: 200,
  max_file_blast_radius: 4,
},
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS with zero errors.

- [ ] **Step 5: Commit**

```bash
git add plugins/roadrunner/src/orchestrator/types.ts plugins/roadrunner/src/orchestrator/context.ts
git commit -m "feat(orchestrator): add SizingResult, SizingConfig, ResolutionRecord types and context fields"
```

### Dependencies

None (types only).

### Estimated scope

Small (< 50 LOC of changes).

---

## Task A6: New guard functions

### Description

Add guards for sizing gate routing, query result routing, and
decomposition recommendation. Update the guards test file.

### Files

- Modify: `plugins/roadrunner/src/orchestrator/guards.ts`
- Modify: `plugins/roadrunner/src/orchestrator/__tests__/guards.test.ts`

### Steps

- [ ] **Step 1: Write failing tests for new guards**

Add to `guards.test.ts`:

```typescript
describe('sizing guards', () => {
  it('sizingClearlyUnder returns true when verdict is under', () => {
    const ctx = makeContext({
      last_sizing_result: { token_count: 100, prose_line_count: 10, file_blast_radius: 1, verdict: 'under' },
    });
    expect(sizingClearlyUnder({ context: ctx })).toBe(true);
  });

  it('sizingClearlyUnder returns false when verdict is over', () => {
    const ctx = makeContext({
      last_sizing_result: { token_count: 3000, prose_line_count: 250, file_blast_radius: 5, verdict: 'over' },
    });
    expect(sizingClearlyUnder({ context: ctx })).toBe(false);
  });

  it('sizingClearlyOver returns true when verdict is over', () => {
    const ctx = makeContext({
      last_sizing_result: { token_count: 3000, prose_line_count: 250, file_blast_radius: 5, verdict: 'over' },
    });
    expect(sizingClearlyOver({ context: ctx })).toBe(true);
  });

  it('sizingClearlyUnder returns false when no sizing result', () => {
    const ctx = makeContext({ last_sizing_result: null });
    expect(sizingClearlyUnder({ context: ctx })).toBe(false);
  });
});

describe('query result guards', () => {
  it('isTaskReady returns true for task_ready outcome', () => {
    const event = { type: 'QUERY_RESULT' as const, outcome: 'task_ready' as const, task: { id: 1, title: 'test', dependencies: [], status: 'pending', details: '', acceptanceCriteria: [], relevantFiles: [] } };
    expect(isTaskReady({ context: makeContext(), event })).toBe(true);
  });

  it('isAllComplete returns true for all_complete outcome', () => {
    const event = { type: 'QUERY_RESULT' as const, outcome: 'all_complete' as const };
    expect(isAllComplete({ context: makeContext(), event })).toBe(true);
  });

  it('isAllBlocked returns true for all_blocked outcome', () => {
    const event = { type: 'QUERY_RESULT' as const, outcome: 'all_blocked' as const, blocked_task_ids: [3, 4], blocked_reasons: ['dep failed'] };
    expect(isAllBlocked({ context: makeContext(), event })).toBe(true);
  });
});

describe('decomposition recommended guard', () => {
  it('returns true when event has decomposition_recommended: true', () => {
    const event = { type: 'PREPARE_COMPLETE' as const, spec_path: 'docs/specs/SPEC-001.md', decomposition_recommended: true, decomposition_rationale: 'spans 3 subsystems' };
    expect(decompositionRecommended({ context: makeContext(), event })).toBe(true);
  });

  it('returns false when event has decomposition_recommended: false', () => {
    const event = { type: 'PREPARE_COMPLETE' as const, spec_path: 'docs/specs/SPEC-001.md', decomposition_recommended: false, decomposition_rationale: null };
    expect(decompositionRecommended({ context: makeContext(), event })).toBe(false);
  });
});

describe('haiku sizing guards', () => {
  it('isSingle returns true for single answer', () => {
    const event = { type: 'HAIKU_SIZING_RESULT' as const, answer: 'single' as const, rationale: 'one concern' };
    expect(isSingle({ context: makeContext(), event })).toBe(true);
  });

  it('isMultiple returns true for multiple answer', () => {
    const event = { type: 'HAIKU_SIZING_RESULT' as const, answer: 'multiple' as const, rationale: 'three subsystems' };
    expect(isMultiple({ context: makeContext(), event })).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/orchestrator/__tests__/guards.test.ts`
Expected: FAIL — new guards not yet exported.

- [ ] **Step 3: Implement new guards**

Add to `guards.ts`:

```typescript
// Sizing guards
export const sizingClearlyUnder = ({ context }: { context: OrchestratorContext }) =>
  context.last_sizing_result?.verdict === 'under';

export const sizingClearlyOver = ({ context }: { context: OrchestratorContext }) =>
  context.last_sizing_result?.verdict === 'over';

// Query result guards
export const isTaskReady = ({ event }: { context: OrchestratorContext; event: OrchestratorEvent }) =>
  event.type === 'QUERY_RESULT' && event.outcome === 'task_ready';

export const isAllComplete = ({ event }: { context: OrchestratorContext; event: OrchestratorEvent }) =>
  event.type === 'QUERY_RESULT' && event.outcome === 'all_complete';

export const isAllBlocked = ({ event }: { context: OrchestratorContext; event: OrchestratorEvent }) =>
  event.type === 'QUERY_RESULT' && event.outcome === 'all_blocked';

// Decomposition recommendation guard
export const decompositionRecommended = ({ event }: { context: OrchestratorContext; event: OrchestratorEvent }) =>
  'decomposition_recommended' in event && event.decomposition_recommended === true;

// Haiku sizing result guards
export const isSingle = ({ event }: { context: OrchestratorContext; event: OrchestratorEvent }) =>
  event.type === 'HAIKU_SIZING_RESULT' && event.answer === 'single';

export const isMultiple = ({ event }: { context: OrchestratorContext; event: OrchestratorEvent }) =>
  event.type === 'HAIKU_SIZING_RESULT' && event.answer === 'multiple';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/orchestrator/__tests__/guards.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/roadrunner/src/orchestrator/guards.ts plugins/roadrunner/src/orchestrator/__tests__/guards.test.ts
git commit -m "feat(orchestrator): add sizing, query result, decomposition, and haiku guards"
```

### Dependencies

Task A5 (types).

### Estimated scope

Medium (100-200 LOC including tests).

---

## Task A7: New action functions

### Description

Add action functions for sizing gates, timeouts, dispatch error
handling, blocked task escalation, and decomposition routing.

### Files

- Modify: `plugins/roadrunner/src/orchestrator/actions.ts`

### Steps

- [ ] **Step 1: Add runMechanicalSizing action**

This action reads the artifact at `context.spec_path` or
`context.plan_path`, runs `evaluateSizing()`, and stores the result
in context. If the verdict is `'ambiguous'`, it sends a
`SIZING_AMBIGUOUS` event internally.

```typescript
import { evaluateSizing } from './sizing.js';

// XState assign action
export const runMechanicalSizing = assign(({ context }) => {
  const artifactPath = context.spec_path || context.plan_path;
  if (!artifactPath) {
    return { last_sizing_result: { token_count: 0, prose_line_count: 0, file_blast_radius: 0, verdict: 'under' as const } };
  }
  let content: string;
  try {
    content = fs.readFileSync(artifactPath, 'utf-8');
  } catch {
    // If file can't be read, treat as under (proceed to review)
    return { last_sizing_result: { token_count: 0, prose_line_count: 0, file_blast_radius: 0, verdict: 'under' as const } };
  }
  const result = evaluateSizing(content, context.sizing_config);
  return { last_sizing_result: result };
});
```

- [ ] **Step 2: Add storeSizingResult action**

```typescript
export const storeSizingResult = assign(({ event }) => {
  if (event.type !== 'HAIKU_SIZING_RESULT') return {};
  // The Haiku result doesn't change the sizing numbers, just the verdict
  return {};
});
```

- [ ] **Step 3: Add dispatchHaikuSizing action**

```typescript
export const dispatchHaikuSizing = ({ context }: { context: OrchestratorContext }) => {
  const artifactPath = context.spec_path || context.plan_path;
  dispatch({
    type: 'DISPATCH_HAIKU_SIZING',
    artifact_path: artifactPath || '',
    artifact_type: context.spec_path ? 'spec' : 'plan',
    sizing_result: context.last_sizing_result!,
  });
};
```

- [ ] **Step 4: Add dispatchDecomposeArtifact action**

```typescript
export const dispatchDecomposeArtifact = ({ context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
  const artifactPath = context.spec_path || context.plan_path;
  let reason: 'size_gate_mechanical' | 'size_gate_haiku' | 'agent_recommended' = 'size_gate_mechanical';
  if (event.type === 'HAIKU_SIZING_RESULT') reason = 'size_gate_haiku';
  if ('decomposition_recommended' in event && event.decomposition_recommended) reason = 'agent_recommended';

  dispatch({
    type: 'DECOMPOSE_ARTIFACT',
    artifact_path: artifactPath || '',
    artifact_type: context.spec_path ? 'spec' : 'plan',
    reason,
    sizing_result: context.last_sizing_result ?? undefined,
  });
};
```

- [ ] **Step 5: Add escalateTimeout action**

```typescript
export const escalateTimeout = ({ context }: { context: OrchestratorContext }) => {
  const taskId = context.current_task_id;
  const taskTitle = taskId !== null ? context.tasks[taskId]?.title : null;
  const label = taskTitle ? `${taskTitle} (TASK-${String(taskId).padStart(3, '0')})` : 'unknown';

  dispatch({
    type: 'ESCALATE',
    task_id: taskId ?? 0,
    reason: `Timeout: ${label} has not responded within the configured time limit.`,
    options: ['retry', 'skip', 'abort'],
  });
};
```

- [ ] **Step 6: Add escalateBlocked action**

```typescript
export const escalateBlocked = ({ context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
  if (event.type !== 'QUERY_RESULT' || event.outcome !== 'all_blocked') return;

  const blockedIds = event.blocked_task_ids ?? [];
  const reasons = event.blocked_reasons ?? [];
  const details = blockedIds.map((id, i) =>
    `TASK-${String(id).padStart(3, '0')}${reasons[i] ? `: ${reasons[i]}` : ''}`
  ).join('; ');

  dispatch({
    type: 'ESCALATE',
    task_id: 0,
    reason: `${blockedIds.length} tasks remain but all are blocked. ${details}`,
    options: ['retry', 'skip', 'abort'],
  });
};
```

- [ ] **Step 7: Add markBlockedTasksSkipped action**

```typescript
export const markBlockedTasksSkipped = assign(({ context }) => {
  const updatedTasks = { ...context.tasks };
  let skippedCount = 0;
  for (const [id, task] of Object.entries(updatedTasks)) {
    if (task.status === 'pending' || task.status === 'blocked') {
      updatedTasks[Number(id)] = { ...task, status: 'skipped' as const };
      skippedCount++;
    }
  }
  return {
    tasks: updatedTasks,
    tasks_complete: context.tasks_complete + skippedCount,
  };
});
```

- [ ] **Step 8: Add recordDispatchError and escalateDispatchError actions**

```typescript
export const recordDispatchError = assign(({ event }) => {
  if (event.type !== 'DISPATCH_ERROR') return {};
  return {
    error: `Dispatch failed: ${event.failed_command} — ${event.error_message} (${event.attempts} attempts)`,
  };
});

export const escalateDispatchError = ({ context, event }: { context: OrchestratorContext; event: OrchestratorEvent }) => {
  if (event.type !== 'DISPATCH_ERROR') return;
  dispatch({
    type: 'ESCALATE',
    task_id: context.current_task_id ?? 0,
    reason: `Failed to dispatch ${event.failed_command} after ${event.attempts} attempts: ${event.error_message}`,
    options: ['retry', 'abort'],
  });
};
```

- [ ] **Step 9: Add addResolution helper for logging resolutions to context**

```typescript
export const addResolution = assign(({ context }, resolution: ResolutionRecord) => {
  const resolutions = [...context.resolutions, resolution];
  // Bounded: keep last 20
  if (resolutions.length > 20) resolutions.splice(0, resolutions.length - 20);
  return { resolutions };
});
```

- [ ] **Step 10: Verify all actions compile**

Run: `npx tsc --noEmit`
Expected: PASS with zero errors.

- [ ] **Step 11: Commit**

```bash
git add plugins/roadrunner/src/orchestrator/actions.ts
git commit -m "feat(orchestrator): add actions for sizing gates, timeouts, blocked escalation, dispatch errors"
```

### Dependencies

Tasks A3, A4, A5, A1 (sizing module).

### Estimated scope

Medium (200-300 LOC).

---

## Task A8: Bus retry logic

### Description

Add retry-with-backoff to the event bus's dispatch function. Failed
dispatches are retried up to 2 times with exponential backoff before
sending `DISPATCH_ERROR` to the actor.

### Files

- Modify: `plugins/roadrunner/src/orchestrator/bus.ts`
- Create: `plugins/roadrunner/src/orchestrator/__tests__/bus.test.ts`

### Steps

- [ ] **Step 1: Write failing tests for bus retry**

```typescript
// plugins/roadrunner/src/orchestrator/__tests__/bus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../bus.js';

describe('bus dispatch retry', () => {
  it('succeeds on first attempt without retry', () => {
    const handler = vi.fn();
    const mockActor = { send: vi.fn() } as any;
    const bus = createEventBus(mockActor);
    bus.onCommand(handler);

    bus.dispatch({ type: 'RUN_TRIAGE', input: { type: 'raw-idea', content: 'test', user_risk_override: null } } as any);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(mockActor.send).not.toHaveBeenCalled();
  });

  it('retries on failure and succeeds on second attempt', () => {
    let callCount = 0;
    const handler = vi.fn(() => {
      callCount++;
      if (callCount === 1) throw new Error('transient failure');
    });
    const mockActor = { send: vi.fn() } as any;
    const bus = createEventBus(mockActor);
    bus.onCommand(handler);

    bus.dispatch({ type: 'RUN_TRIAGE', input: { type: 'raw-idea', content: 'test', user_risk_override: null } } as any);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(mockActor.send).not.toHaveBeenCalled(); // No error sent — recovered
  });

  it('sends DISPATCH_ERROR after exhausting retries', () => {
    const handler = vi.fn(() => { throw new Error('persistent failure'); });
    const mockActor = { send: vi.fn() } as any;
    const bus = createEventBus(mockActor);
    bus.onCommand(handler);

    bus.dispatch({ type: 'RUN_TRIAGE', input: { type: 'raw-idea', content: 'test', user_risk_override: null } } as any);

    expect(handler).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(mockActor.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DISPATCH_ERROR',
        failed_command: 'RUN_TRIAGE',
        attempts: 3,
      })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/orchestrator/__tests__/bus.test.ts`
Expected: FAIL — retry behavior not implemented.

- [ ] **Step 3: Implement retry logic in bus**

Update the `dispatch` method in `createEventBus`:

```typescript
function createEventBus(actor: AnyActorRef): EventBus {
  const handlers: CommandHandler[] = [];
  const MAX_RETRIES = 2;
  const BACKOFF_MS = [500, 2000];

  function sleepSync(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // Busy-wait. Acceptable for short retry delays in a single-threaded
      // orchestrator. Replace with async if the bus becomes async.
    }
  }

  return {
    sendEvent(event) {
      actor.send(event);
    },

    onCommand(handler) {
      handlers.push(handler);
    },

    dispatch(command) {
      if (handlers.length === 0) {
        console.log(`[orchestrator] command: ${command.type}`, JSON.stringify(command, null, 2));
        return;
      }
      for (const handler of handlers) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            handler(command);
            break; // Success — exit retry loop
          } catch (err) {
            if (attempt < MAX_RETRIES) {
              sleepSync(BACKOFF_MS[attempt]);
              continue;
            }
            // Exhausted retries — escalate to machine
            console.error(`[orchestrator] dispatch failed for ${command.type} after ${attempt + 1} attempts:`, err);
            actor.send({
              type: 'DISPATCH_ERROR',
              failed_command: command.type,
              error_message: err instanceof Error ? err.message : String(err),
              attempts: attempt + 1,
            });
          }
        }
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/orchestrator/__tests__/bus.test.ts`
Expected: ALL PASS.

Note: The sleepSync busy-wait will make the "exhausted retries" test
slow (~2.5s). This is acceptable for tests. If it becomes a problem,
extract `sleepSync` as an injectable dependency and mock it in tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/roadrunner/src/orchestrator/bus.ts plugins/roadrunner/src/orchestrator/__tests__/bus.test.ts
git commit -m "feat(orchestrator): add retry-with-backoff to event bus dispatch"
```

### Dependencies

Task A3 (updated DispatchError event type).

### Estimated scope

Small (100-150 LOC including tests).

---

## Task A9: Machine definition — compound review states

### Description

Restructure `spec_review`, `plan_review`, and `develop.review_task`
from flat states into compound states with inner sub-states:
`dispatching_review`, `awaiting_review`, `route_verdict`,
`awaiting_approval`, `escalate`, `exit`.

This is the largest change to the machine definition. It replaces the
review-related sections of original Task 7.

### Files

- Modify: `plugins/roadrunner/src/orchestrator/machine.ts`

### Steps

- [ ] **Step 1: Replace spec_review with compound state**

Replace the `spec_review` state in `machine.ts` with:

```typescript
spec_review: {
  always: [
    { guard: 'shouldSkipSpecReview', target: 'write_plan' },
  ],
  initial: 'dispatching_review',
  states: {
    dispatching_review: {
      entry: ['dispatchSpecReview'],
      always: { target: 'awaiting_review' },
    },
    awaiting_review: {
      after: [
        {
          delay: ({ context }) => context.review_timeout_ms,
          target: 'escalate',
          actions: ['escalateTimeout'],
        },
      ],
      on: {
        REVIEW_COMPLETE: {
          target: 'route_verdict',
          actions: ['storeReviewResult'],
        },
      },
    },
    route_verdict: {
      always: [
        {
          guard: { type: 'and', guards: ['isShip', 'requiresUserApproval'] },
          target: 'awaiting_approval',
        },
        {
          guard: 'isShip',
          target: 'exit',
        },
        {
          guard: { type: 'and', guards: ['isRevise', 'belowMaxRounds'] },
          target: 'dispatching_review',
        },
        {
          // isRethink OR atMaxRounds — fallthrough
          target: 'escalate',
          actions: ['escalateReview'],
        },
      ],
    },
    awaiting_approval: {
      on: {
        USER_APPROVE: [
          { guard: 'isProceed', target: 'exit' },
          { guard: 'isAbort', target: '#skylark-orchestrator.done', actions: ['recordAbort'] },
        ],
      },
    },
    escalate: {
      on: {
        USER_ESCALATION_RESPONSE: [
          { guard: 'isRetry', target: 'dispatching_review', actions: ['resetReviewRound'] },
          { guard: 'isSkip', target: 'exit' },
          { guard: 'isAbortEscalation', target: '#skylark-orchestrator.done', actions: ['recordAbort'] },
        ],
      },
    },
    exit: {
      type: 'final' as const,
    },
  },
  onDone: { target: 'write_plan' },
},
```

Note: The `#skylark-orchestrator.done` syntax is XState v5's way to
target a state in an ancestor machine by ID.

- [ ] **Step 2: Replace plan_review with compound state**

Same structure as `spec_review` but with `dispatchPlanReview` and
`onDone: { target: 'develop' }`:

```typescript
plan_review: {
  always: [
    { guard: 'shouldSkipPlanReview', target: 'develop' },
  ],
  initial: 'dispatching_review',
  states: {
    dispatching_review: {
      entry: ['dispatchPlanReview'],
      always: { target: 'awaiting_review' },
    },
    awaiting_review: {
      after: [
        {
          delay: ({ context }) => context.review_timeout_ms,
          target: 'escalate',
          actions: ['escalateTimeout'],
        },
      ],
      on: {
        REVIEW_COMPLETE: {
          target: 'route_verdict',
          actions: ['storeReviewResult'],
        },
      },
    },
    route_verdict: {
      always: [
        {
          guard: { type: 'and', guards: ['isShip', 'requiresUserApproval'] },
          target: 'awaiting_approval',
        },
        {
          guard: 'isShip',
          target: 'exit',
        },
        {
          guard: { type: 'and', guards: ['isRevise', 'belowMaxRounds'] },
          target: 'dispatching_review',
        },
        {
          target: 'escalate',
          actions: ['escalateReview'],
        },
      ],
    },
    awaiting_approval: {
      on: {
        USER_APPROVE: [
          { guard: 'isProceed', target: 'exit' },
          { guard: 'isAbort', target: '#skylark-orchestrator.done', actions: ['recordAbort'] },
        ],
      },
    },
    escalate: {
      on: {
        USER_ESCALATION_RESPONSE: [
          { guard: 'isRetry', target: 'dispatching_review', actions: ['resetReviewRound'] },
          { guard: 'isSkip', target: 'exit' },
          { guard: 'isAbortEscalation', target: '#skylark-orchestrator.done', actions: ['recordAbort'] },
        ],
      },
    },
    exit: {
      type: 'final' as const,
    },
  },
  onDone: { target: 'develop' },
},
```

- [ ] **Step 3: Replace develop.review_task with compound state**

Replace the flat `review_task` in the `develop` compound state:

```typescript
review_task: {
  initial: 'dispatching_review',
  states: {
    dispatching_review: {
      entry: ['dispatchReview'],
      always: { target: 'awaiting_review' },
    },
    awaiting_review: {
      after: [
        {
          delay: ({ context }) => context.review_timeout_ms,
          target: 'escalate',
          actions: ['escalateTimeout'],
        },
      ],
      on: {
        REVIEW_COMPLETE: {
          target: 'route_verdict',
          actions: ['storeReviewResult'],
        },
      },
    },
    route_verdict: {
      always: [
        { guard: 'isShip', target: 'exit_ship', actions: ['markTaskDone', 'dispatchQueryNextTask'] },
        {
          guard: { type: 'and', guards: ['isRevise', 'belowMaxRounds'] },
          target: 'exit_revise',
        },
        {
          target: 'escalate',
          actions: ['escalateReview'],
        },
      ],
    },
    escalate: {
      on: {
        USER_ESCALATION_RESPONSE: [
          { guard: 'isRetry', target: 'dispatching_review', actions: ['resetReviewRound'] },
          { guard: 'isSkip', target: 'exit_skip', actions: ['markTaskSkipped', 'dispatchQueryNextTask'] },
          { guard: 'isAbortEscalation', target: 'exit_abort', actions: ['recordAbort'] },
        ],
      },
    },
    exit_ship: { type: 'final' as const },
    exit_revise: { type: 'final' as const },
    exit_skip: { type: 'final' as const },
    exit_abort: { type: 'final' as const },
  },
  onDone: [
    { guard: ({ context }) => context.abort_reason !== null, target: 'abort' },
    { guard: ({ context }) => context.last_review_verdict === 'REVISE', target: 'dispatch_worker', actions: ['dispatchWorker'] },
    { guard: ({ context }) => context.last_review_verdict === 'SHIP' || context.tasks[context.current_task_id!]?.status === 'skipped', target: 'next_task' },
    { target: 'next_task' },
  ],
},
```

- [ ] **Step 4: Register new delays in setup()**

Add to the `setup()` call:

```typescript
setup({
  // ... existing config
  delays: {
    WORKER_TIMEOUT: ({ context }) => context.worker_timeout_ms,
    REVIEW_TIMEOUT: ({ context }) => context.review_timeout_ms,
    SIZING_TIMEOUT: () => 60_000,
    QUERY_TIMEOUT: () => 60_000,
  },
  // ...
})
```

- [ ] **Step 5: Register new guards and actions in setup()**

Add all new guards from Task A6 and actions from Task A7 to the
`setup()` guards and actions objects. Ensure all names used as strings
in the machine definition have matching registrations.

- [ ] **Step 6: Verify machine compiles**

Run: `npx tsc --noEmit`
Expected: PASS with zero errors.

- [ ] **Step 7: Commit**

```bash
git add plugins/roadrunner/src/orchestrator/machine.ts
git commit -m "feat(orchestrator): restructure review states as compound states with inner loops"
```

### Dependencies

Tasks A6, A7.

### Estimated scope

Large (300+ LOC of changes to machine.ts).

---

## Task A10: Machine definition — sizing gates, timeouts, error handling, blocked state

### Description

Add `size_check_pre_spec` and `size_check_pre_plan` states, `after`
timeouts on `develop.await_worker` and `develop.generate_expert`,
global `DISPATCH_ERROR` handler, `develop.escalate_blocked` state,
and update `develop.next_task` to use `QUERY_RESULT`.

### Files

- Modify: `plugins/roadrunner/src/orchestrator/machine.ts`

### Steps

- [ ] **Step 1: Add size_check_pre_spec state**

Insert between `brainstorm` (or the stage that feeds into spec_review)
and `spec_review`:

```typescript
size_check_pre_spec: {
  always: [
    { guard: 'shouldSkipSpecReview', target: 'write_plan' },
  ],
  entry: ['runMechanicalSizing'],
  initial: 'evaluating',
  states: {
    evaluating: {
      always: [
        { guard: 'sizingClearlyUnder', target: 'proceed' },
        { guard: 'sizingClearlyOver', target: 'decompose' },
        // Ambiguous — need Haiku evaluation
      ],
      entry: ['dispatchHaikuSizing'],
      on: {
        HAIKU_SIZING_RESULT: [
          { guard: 'isSingle', target: 'proceed' },
          { guard: 'isMultiple', target: 'decompose' },
        ],
      },
      after: [
        {
          delay: () => 60_000,
          target: 'proceed', // On Haiku timeout, proceed to review rather than block
        },
      ],
    },
    proceed: { type: 'final' as const },
    decompose: { type: 'final' as const },
  },
  onDone: [
    {
      guard: ({ context }) => context.last_sizing_result?.verdict === 'over',
      target: 'develop',
      actions: ['dispatchDecomposeArtifact'],
    },
    { target: 'spec_review' },
  ],
},
```

- [ ] **Step 2: Add size_check_pre_plan state**

Same structure, inserted between `write_plan` and `plan_review`:

```typescript
size_check_pre_plan: {
  always: [
    { guard: 'shouldSkipPlanReview', target: 'develop' },
  ],
  entry: ['runMechanicalSizing'],
  initial: 'evaluating',
  states: {
    evaluating: {
      always: [
        { guard: 'sizingClearlyUnder', target: 'proceed' },
        { guard: 'sizingClearlyOver', target: 'decompose' },
      ],
      entry: ['dispatchHaikuSizing'],
      on: {
        HAIKU_SIZING_RESULT: [
          { guard: 'isSingle', target: 'proceed' },
          { guard: 'isMultiple', target: 'decompose' },
        ],
      },
      after: [
        {
          delay: () => 60_000,
          target: 'proceed',
        },
      ],
    },
    proceed: { type: 'final' as const },
    decompose: { type: 'final' as const },
  },
  onDone: [
    {
      guard: ({ context }) => context.last_sizing_result?.verdict === 'over',
      target: 'develop',
      actions: ['dispatchDecomposeArtifact'],
    },
    { target: 'plan_review' },
  ],
},
```

- [ ] **Step 3: Update prepare and write_plan transitions for decomposition signal**

Update `prepare` to route based on `decomposition_recommended`:

```typescript
prepare: {
  always: [
    { guard: 'shouldSkipPrepare', target: 'brainstorm' },
  ],
  entry: ['dispatchPrepare'],
  on: {
    PREPARE_COMPLETE: [
      {
        guard: 'decompositionRecommended',
        target: 'develop',
        actions: ['storePrepareResult', 'dispatchDecomposeArtifact'],
      },
      {
        target: 'brainstorm',
        actions: ['storePrepareResult'],
      },
    ],
  },
},
```

Update `write_plan` similarly:

```typescript
write_plan: {
  always: [
    { guard: 'shouldSkipWritePlan', target: 'size_check_pre_plan' },
  ],
  entry: ['dispatchWritePlan'],
  on: {
    PLAN_COMPLETE: [
      {
        guard: 'decompositionRecommended',
        target: 'develop',
        actions: ['storePlanResult', 'dispatchDecomposeArtifact'],
      },
      {
        target: 'size_check_pre_plan',
        actions: ['storePlanResult'],
      },
    ],
  },
},
```

- [ ] **Step 4: Add timeout to develop.await_worker**

Update `develop.await_worker`:

```typescript
await_worker: {
  after: [
    {
      delay: ({ context }) => context.worker_timeout_ms,
      target: 'escalate_worker',
      actions: ['escalateTimeout'],
    },
  ],
  on: {
    WORKER_COMPLETE: [
      {
        guard: 'workerSucceeded',
        target: 'review_task',
        actions: ['storeWorkerResult', 'dispatchReview'],
      },
      {
        guard: 'workerBlocked',
        target: 'escalate_worker',
        actions: ['storeWorkerResult', 'escalateWorker'],
      },
    ],
    COMPACTION_DETECTED: {
      target: 'escalate_worker',
      actions: ['handleCompactionDetected', 'dispatchRedecompose'],
    },
  },
},
```

- [ ] **Step 5: Add timeout to develop.generate_expert**

```typescript
generate_expert: {
  after: [
    {
      delay: ({ context }) => context.review_timeout_ms,
      target: 'escalate_drift',
      actions: ['escalateTimeout'],
    },
  ],
  on: {
    EXPERT_READY: [
      {
        guard: 'driftPass',
        target: 'dispatch_worker',
        actions: ['storeExpertResult', 'dispatchWorker'],
      },
      {
        guard: 'driftFail',
        target: 'escalate_drift',
        actions: ['escalateDrift'],
      },
    ],
  },
},
```

- [ ] **Step 6: Add develop.escalate_blocked state**

Add to the `develop` compound state's `states`:

```typescript
escalate_blocked: {
  entry: ['escalateBlocked'],
  on: {
    USER_ESCALATION_RESPONSE: [
      { guard: 'isRetry', target: 'next_task', actions: ['dispatchQueryNextTask'] },
      { guard: 'isSkip', target: 'finish_develop', actions: ['markBlockedTasksSkipped'] },
      { guard: 'isAbortEscalation', target: 'abort', actions: ['recordAbort'] },
    ],
  },
},
```

- [ ] **Step 7: Update develop.next_task to use QUERY_RESULT**

Replace the `TASK_READY` and `STATUS_ROLLUP` handlers:

```typescript
next_task: {
  after: [
    {
      delay: () => 60_000,
      target: 'escalate_blocked',
      actions: ['escalateTimeout'],
    },
  ],
  on: {
    QUERY_RESULT: [
      {
        guard: 'isTaskReady',
        target: 'generate_expert',
        actions: ['storeCurrentTask', 'dispatchGenerateExpert'],
      },
      {
        guard: 'isAllComplete',
        target: 'finish_develop',
      },
      {
        guard: 'isAllBlocked',
        target: 'escalate_blocked',
      },
    ],
  },
},
```

- [ ] **Step 8: Add global DISPATCH_ERROR handler**

Add to the root machine config:

```typescript
{
  id: 'skylark-orchestrator',
  on: {
    DISPATCH_ERROR: {
      actions: ['recordDispatchError', 'escalateDispatchError'],
    },
    // STATUS_ROLLUP as a global context-update event
    STATUS_ROLLUP: {
      actions: ['updateTaskCounters'],
    },
  },
  states: { /* ... */ },
}
```

- [ ] **Step 9: Update the shouldSkip chain for new states**

Update the skip chain so the forward scan includes
`size_check_pre_spec` and `size_check_pre_plan`:

```
prepare → brainstorm → size_check_pre_spec → spec_review →
write_plan → size_check_pre_plan → plan_review → develop → finish
```

Each `always` transition with `shouldSkip*` targets the next state in
this chain.

- [ ] **Step 10: Verify machine compiles**

Run: `npx tsc --noEmit`
Expected: PASS with zero errors.

- [ ] **Step 11: Commit**

```bash
git add plugins/roadrunner/src/orchestrator/machine.ts
git commit -m "feat(orchestrator): add sizing gates, timeouts, global error handler, escalate_blocked"
```

### Dependencies

Tasks A1, A6, A7, A9.

### Estimated scope

Large (300+ LOC of changes to machine.ts).

---

## Task A11: Unit tests — sizing and resolution modules

### Description

These tests were written inline with Tasks A1 and A2. This task
verifies they all pass together and adds any edge cases discovered
during integration.

### Files

- Verify: `plugins/roadrunner/src/orchestrator/__tests__/sizing.test.ts`
- Verify: `plugins/roadrunner/src/orchestrator/__tests__/resolution.test.ts`

### Steps

- [ ] **Step 1: Run all module tests**

Run: `npx vitest run src/orchestrator/__tests__/sizing.test.ts src/orchestrator/__tests__/resolution.test.ts`
Expected: ALL PASS.

- [ ] **Step 2: Add edge case — sizing with only code blocks**

Add to `sizing.test.ts`:

```typescript
it('returns under for content that is entirely code blocks', () => {
  const content = '```typescript\nconst x = 1;\nconst y = 2;\n```';
  const result = evaluateSizing(content, defaultConfig);
  expect(result.verdict).toBe('under');
  expect(result.token_count).toBe(0);
  expect(result.prose_line_count).toBe(0);
});
```

- [ ] **Step 3: Add edge case — resolution with special characters in path**

Add to `resolution.test.ts`:

```typescript
it('handles paths with spaces and special characters', () => {
  const dir = path.join(tmpDir, 'docs', 'specs with spaces');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SPEC-001-test.md'), 'content');
  const refPath = path.join(dir, 'SPEC-001.md');
  const result = resolveArtifactPath(refPath, tmpDir);
  expect(result.resolved_to).toContain('SPEC-001-test.md');
});
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run src/orchestrator/__tests__/sizing.test.ts src/orchestrator/__tests__/resolution.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit if new tests were added**

```bash
git add plugins/roadrunner/src/orchestrator/__tests__/
git commit -m "test(orchestrator): add edge case tests for sizing and resolution modules"
```

### Dependencies

Tasks A1, A2.

### Estimated scope

Small (< 50 LOC of new tests).

---

## Task A12: Unit tests — new guards

### Description

Tests for all new guard functions added in Task A6. These were
written inline with that task. This task verifies they pass and
adds integration-level guard tests.

### Files

- Verify: `plugins/roadrunner/src/orchestrator/__tests__/guards.test.ts`

### Steps

- [ ] **Step 1: Run guard tests**

Run: `npx vitest run src/orchestrator/__tests__/guards.test.ts`
Expected: ALL PASS.

- [ ] **Step 2: Add guard combination tests**

Add tests that verify guard combinations work as expected in compound
conditions (since the machine uses `and`, `or`, `not` combinators):

```typescript
describe('guard combinations for route_verdict', () => {
  it('isShip AND requiresUserApproval both true at critical risk', () => {
    const ctx = makeContext({ risk: 'critical', last_review_verdict: 'SHIP' });
    expect(isShip({ context: ctx })).toBe(true);
    expect(requiresUserApproval({ context: ctx })).toBe(true);
  });

  it('isShip true but requiresUserApproval false at standard risk', () => {
    const ctx = makeContext({ risk: 'standard', last_review_verdict: 'SHIP' });
    expect(isShip({ context: ctx })).toBe(true);
    expect(requiresUserApproval({ context: ctx })).toBe(false);
  });

  it('isRevise AND belowMaxRounds for round 1 of max 2', () => {
    const ctx = makeContext({ last_review_verdict: 'REVISE', review_round: 1, max_review_rounds: 2 });
    expect(isRevise({ context: ctx })).toBe(true);
    expect(belowMaxRounds({ context: ctx })).toBe(true);
  });

  it('isRevise AND atMaxRounds for round 2 of max 2', () => {
    const ctx = makeContext({ last_review_verdict: 'REVISE', review_round: 2, max_review_rounds: 2 });
    expect(isRevise({ context: ctx })).toBe(true);
    expect(atMaxRounds({ context: ctx })).toBe(true);
  });
});
```

- [ ] **Step 3: Run all guard tests**

Run: `npx vitest run src/orchestrator/__tests__/guards.test.ts`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/roadrunner/src/orchestrator/__tests__/guards.test.ts
git commit -m "test(orchestrator): add guard combination tests for compound review states"
```

### Dependencies

Task A6.

### Estimated scope

Medium (50-100 LOC of new tests).

---

## Task A13: Unit tests — amended machine transitions

### Description

Test the restructured machine: compound review states, sizing gates,
timeouts, dispatch error handling, and blocked task escalation.

### Files

- Modify: `plugins/roadrunner/src/orchestrator/__tests__/machine.test.ts`

### Steps

- [ ] **Step 1: Test compound spec_review happy path**

```typescript
describe('compound spec_review', () => {
  it('SHIP at standard risk advances without approval gate', () => {
    // Set up machine at spec_review with risk: standard
    const actor = createTestActor({ risk: 'standard', path: ['triage', 'prepare', 'spec_review', 'write_plan', 'develop', 'finish'] });
    advanceTo(actor, 'spec_review');

    // Should be in spec_review.dispatching_review, then immediately spec_review.awaiting_review
    expect(actor.getSnapshot().matches('spec_review.awaiting_review')).toBe(true);

    actor.send({ type: 'REVIEW_COMPLETE', task_id: 0, verdict: 'SHIP', round: 1, report_path: 'report.md', findings: [] });

    // Should skip awaiting_approval (not critical) and reach write_plan
    expect(actor.getSnapshot().matches('write_plan')).toBe(true);
  });

  it('SHIP at critical risk pauses for approval', () => {
    const actor = createTestActor({ risk: 'critical', path: ['triage', 'prepare', 'brainstorm', 'spec_review', 'write_plan', 'plan_review', 'develop', 'finish'] });
    advanceTo(actor, 'spec_review');

    actor.send({ type: 'REVIEW_COMPLETE', task_id: 0, verdict: 'SHIP', round: 1, report_path: 'report.md', findings: [] });

    expect(actor.getSnapshot().matches('spec_review.awaiting_approval')).toBe(true);

    actor.send({ type: 'USER_APPROVE', stage: 'spec_review', decision: 'proceed' });
    expect(actor.getSnapshot().matches('write_plan')).toBe(true);
  });

  it('REVISE loops back to dispatching_review', () => {
    const actor = createTestActor({ risk: 'elevated', path: ['triage', 'prepare', 'spec_review', 'write_plan', 'plan_review', 'develop', 'finish'] });
    advanceTo(actor, 'spec_review');

    actor.send({ type: 'REVIEW_COMPLETE', task_id: 0, verdict: 'REVISE', round: 1, report_path: 'report.md', findings: [] });

    expect(actor.getSnapshot().matches('spec_review.dispatching_review')).toBe(true);
    // review_round should be 1
    expect(actor.getSnapshot().context.review_round).toBe(1);
  });

  it('RETHINK escalates to user', () => {
    const actor = createTestActor({ risk: 'standard', path: ['triage', 'prepare', 'spec_review', 'write_plan', 'develop', 'finish'] });
    advanceTo(actor, 'spec_review');

    actor.send({ type: 'REVIEW_COMPLETE', task_id: 0, verdict: 'RETHINK', round: 1, report_path: 'report.md', findings: [] });

    expect(actor.getSnapshot().matches('spec_review.escalate')).toBe(true);
  });
});
```

- [ ] **Step 2: Test QUERY_RESULT routing in develop.next_task**

```typescript
describe('develop.next_task with QUERY_RESULT', () => {
  it('task_ready transitions to generate_expert', () => {
    const actor = createTestActor({ decompose: false });
    advanceTo(actor, 'develop.next_task');

    actor.send({
      type: 'QUERY_RESULT',
      outcome: 'task_ready',
      task: { id: 1, title: 'test', dependencies: [], status: 'pending', details: '', acceptanceCriteria: [], relevantFiles: [] },
    });

    expect(actor.getSnapshot().matches('develop.generate_expert')).toBe(true);
  });

  it('all_complete transitions to finish_develop', () => {
    const actor = createTestActor({ decompose: false });
    advanceTo(actor, 'develop.next_task');

    actor.send({ type: 'QUERY_RESULT', outcome: 'all_complete' });

    expect(actor.getSnapshot().matches('finish')).toBe(true);
  });

  it('all_blocked transitions to escalate_blocked', () => {
    const actor = createTestActor({ decompose: false });
    advanceTo(actor, 'develop.next_task');

    actor.send({
      type: 'QUERY_RESULT',
      outcome: 'all_blocked',
      blocked_task_ids: [3, 4],
      blocked_reasons: ['TASK-002 failed'],
    });

    expect(actor.getSnapshot().matches('develop.escalate_blocked')).toBe(true);
  });
});
```

- [ ] **Step 3: Test DISPATCH_ERROR global handler**

```typescript
describe('global DISPATCH_ERROR handler', () => {
  it('records error in context without changing state', () => {
    const actor = createTestActor();
    advanceTo(actor, 'develop.await_worker');
    const stateBefore = actor.getSnapshot().value;

    actor.send({
      type: 'DISPATCH_ERROR',
      failed_command: 'RUN_REVIEW',
      error_message: 'ENOENT: file not found',
      attempts: 3,
    });

    // State should not change
    expect(actor.getSnapshot().value).toEqual(stateBefore);
    // Error should be recorded in context
    expect(actor.getSnapshot().context.error).toContain('RUN_REVIEW');
  });
});
```

- [ ] **Step 4: Test decomposition_recommended routing**

```typescript
describe('decomposition_recommended routing', () => {
  it('routes to develop when prepare recommends decomposition', () => {
    const actor = createTestActor({ path: ['triage', 'prepare', 'spec_review', 'write_plan', 'plan_review', 'develop', 'finish'] });
    advanceTo(actor, 'prepare');

    actor.send({
      type: 'PREPARE_COMPLETE',
      spec_path: 'docs/specs/SPEC-001.md',
      decomposition_recommended: true,
      decomposition_rationale: 'spans 3 subsystems',
    });

    // Should route to develop (for decomposition) rather than spec_review
    expect(actor.getSnapshot().matches({ develop: 'decompose' })).toBe(true);
  });

  it('proceeds normally when decomposition not recommended', () => {
    const actor = createTestActor({ path: ['triage', 'prepare', 'spec_review', 'write_plan', 'plan_review', 'develop', 'finish'] });
    advanceTo(actor, 'prepare');

    actor.send({
      type: 'PREPARE_COMPLETE',
      spec_path: 'docs/specs/SPEC-001.md',
      decomposition_recommended: false,
      decomposition_rationale: null,
    });

    // Should proceed to brainstorm or next state in skip chain
    expect(actor.getSnapshot().matches('spec_review') || actor.getSnapshot().matches('size_check_pre_spec')).toBe(true);
  });
});
```

- [ ] **Step 5: Test escalate_blocked user responses**

```typescript
describe('develop.escalate_blocked', () => {
  it('retry re-queries for next task', () => {
    const actor = createTestActor({ decompose: false });
    advanceTo(actor, 'develop.escalate_blocked');

    actor.send({ type: 'USER_ESCALATION_RESPONSE', task_id: 0, action: 'retry' });

    expect(actor.getSnapshot().matches('develop.next_task')).toBe(true);
  });

  it('skip marks blocked tasks skipped and finishes', () => {
    const actor = createTestActor({ decompose: false, task_count: 2, tasks: { 3: { id: 3, title: 'blocked', status: 'pending', review_round: 0, worker_result_path: null, expert_prompt_path: null, cost_usd: 0, duration_ms: 0 } } });
    advanceTo(actor, 'develop.escalate_blocked');

    actor.send({ type: 'USER_ESCALATION_RESPONSE', task_id: 0, action: 'skip' });

    expect(actor.getSnapshot().matches('finish')).toBe(true);
  });
});
```

- [ ] **Step 6: Run all machine tests**

Run: `npx vitest run src/orchestrator/__tests__/machine.test.ts`
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/roadrunner/src/orchestrator/__tests__/machine.test.ts
git commit -m "test(orchestrator): add tests for compound review states, QUERY_RESULT, dispatch errors, sizing, blocked tasks"
```

### Dependencies

Tasks A9, A10.

### Estimated scope

Large (300+ LOC of tests).

---

## Task A14: Updated integration test

### Description

Update the integration test from original Task 14 to exercise the
amended pipeline: sizing gates, compound review loops, QUERY_RESULT,
and dispatch error recovery.

### Files

- Modify: `plugins/roadrunner/src/orchestrator/__tests__/integration.test.ts`

### Steps

- [ ] **Step 1: Update the standard-risk scenario to use QUERY_RESULT**

Replace all `TASK_READY` events with `QUERY_RESULT` events with
`outcome: 'task_ready'`. Replace the final `STATUS_ROLLUP` with
`QUERY_RESULT` with `outcome: 'all_complete'`.

- [ ] **Step 2: Update completion events with decomposition fields**

Add `decomposition_recommended: false, decomposition_rationale: null`
to all `PREPARE_COMPLETE`, `BRAINSTORM_COMPLETE`, and `PLAN_COMPLETE`
events in the scenario.

- [ ] **Step 3: Add integration scenario — sizing gate triggers decomposition**

```typescript
it('sizing gate routes oversized spec to decomposition', async () => {
  // Create an oversized spec file (> 2500 tokens)
  const specPath = path.join(tmpDir, 'docs', 'specs', 'SPEC-001-big.md');
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, 'word '.repeat(3000)); // > 2500 tokens

  const actor = createIntegrationActor(tmpDir);
  // Advance to prepare complete with the oversized spec
  sendEvents(actor, [
    { type: 'START', input: { type: 'raw-idea', content: 'big feature', user_risk_override: null } },
    { type: 'TRIAGE_COMPLETE', input_type: 'spec', risk: 'elevated', path: ['triage', 'prepare', 'spec_review', 'write_plan', 'plan_review', 'develop', 'finish'], existing_artifact: null, external_ref: null, decompose: true, domain_clusters: [] },
    { type: 'PREPARE_COMPLETE', spec_path: specPath, decomposition_recommended: false, decomposition_rationale: null },
  ]);

  // Should be in size_check_pre_spec, and the sizing should detect "over"
  // The machine should route to develop (for decomposition)
  const snapshot = actor.getSnapshot();
  const dispatched = getDispatchedCommands();
  expect(dispatched.some(c => c.type === 'DECOMPOSE_ARTIFACT')).toBe(true);
});
```

- [ ] **Step 4: Add integration scenario — blocked tasks escalation**

```typescript
it('escalates when all remaining tasks are blocked', () => {
  const actor = createIntegrationActor(tmpDir);
  advanceToNextTask(actor);

  actor.send({
    type: 'QUERY_RESULT',
    outcome: 'all_blocked',
    blocked_task_ids: [3, 4],
    blocked_reasons: ['dependency TASK-002 failed'],
  });

  expect(actor.getSnapshot().matches('develop.escalate_blocked')).toBe(true);
  const dispatched = getDispatchedCommands();
  expect(dispatched.some(c => c.type === 'ESCALATE')).toBe(true);
});
```

- [ ] **Step 5: Verify compound review loop in integration context**

Verify that the REVISE loop works end-to-end through the compound
state: worker completes → review returns REVISE → worker re-dispatched
→ review returns SHIP → task marked done.

- [ ] **Step 6: Run integration tests**

Run: `npx vitest run src/orchestrator/__tests__/integration.test.ts`
Expected: ALL PASS.

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS across all test files.

- [ ] **Step 8: Commit**

```bash
git add plugins/roadrunner/src/orchestrator/__tests__/integration.test.ts
git commit -m "test(orchestrator): update integration tests for amendments (sizing, QUERY_RESULT, compound reviews, blocked)"
```

### Dependencies

Tasks A9, A10, A8.

### Estimated scope

Medium (200-300 LOC of test changes).

---

## Relationship to Original Plan

This plan amends the following original tasks:

| Original Task | Amendment |
|---|---|
| Task 2 (Events) | Task A3 adds/replaces event types |
| Task 3 (Commands) | Task A4 adds command types |
| Task 4 (Context/Types) | Task A5 adds types and context fields |
| Task 5 (Guards) | Task A6 adds guard functions |
| Task 6 (Actions) | Task A7 adds action functions |
| Task 7 (Machine) | Tasks A9 + A10 restructure the machine |
| Task 9 (Bus) | Task A8 adds retry logic |
| Task 11 (Guard tests) | Task A12 adds tests |
| Task 12 (Machine tests) | Task A13 adds tests |
| Task 14 (Integration) | Task A14 updates the scenario |

Original tasks NOT affected: 1 (scaffolding), 8 (persistence),
10 (CLI entry point), 13 (persistence tests).

The recommended execution order is: complete original Tasks 1-10 first,
then execute this amendment plan (A1-A14). Tasks A1 and A2 can be
built in parallel. Tasks A3, A4, A5 can be built in parallel.
