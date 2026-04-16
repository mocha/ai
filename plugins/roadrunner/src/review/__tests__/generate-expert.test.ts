import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateExpert, countVocabularyClusters } from '../generate-expert.js';
import type { GenerateExpert } from '../../orchestrator/commands.js';
import type { ReviewConfig } from '../types.js';

const MOCK_EXPERT_PROMPT = `# Senior Backend Engineer — Event-Driven Pipeline Specialist

## Domain Vocabulary

### 1. Event Architecture
- XState v5 state machine — deterministic FSM with hierarchical/parallel states
- Event bus — pub/sub command dispatch with typed discriminated unions
- Assign actions — pure context mutations via XState's assign() helper

### 2. Task Orchestration
- Task substrate — Taskmaster MCP integration for task CRUD and DAG queries
- Dependency resolution — topological ordering with blocked-task detection
- Sizing gate — mechanical token/LOC/blast-radius check before LLM dispatch

### 3. Review Pipeline
- Vocabulary routing — domain-term front-loading for knowledge cluster activation
- Panel review — parallel multi-expert dispatch with finding synthesis
- Verdict consolidation — SHIP/REVISE/RETHINK with "one Rethink vetoes" rule

## Anti-Patterns

1. **Event Storm** — dispatching multiple commands without awaiting responses
   Detection: bus.dispatch() calls without corresponding event handlers
   Resolution: ensure every dispatch has a matching state transition

2. **Context Bloat** — storing large payloads in XState context
   Detection: context fields growing beyond simple scalars and small arrays
   Resolution: store file paths, not file contents

## Operational Guidance

Focus on correctness over performance. Use typed discriminated unions for all events.

## Testing Expectations

Test state transitions with snapshot-based actors. Mock CLI calls.

## Deliverables

- Implement the handler following createTaskSubstrateHandler pattern
- Register on the event bus
- Write unit tests with vitest
`;

function makeCommand(overrides: Partial<GenerateExpert> = {}): GenerateExpert {
  return {
    type: 'GENERATE_EXPERT',
    task_id: 1,
    task: {
      id: 1,
      title: 'Implement review handler',
      dependencies: [],
      status: 'pending',
      details: 'Build the Layer 4 review handler',
      acceptanceCriteria: ['Handles GENERATE_EXPERT', 'Handles RUN_REVIEW'],
      relevantFiles: ['src/review/handler.ts'],
    },
    risk: 'standard',
    codebase_context: {
      entry_points: ['src/orchestrator/index.ts'],
      recent_changes: ['Added gate field to ReviewComplete'],
      related_tests: ['src/orchestrator/__tests__/machine.test.ts'],
    },
    ...overrides,
  };
}

function makeConfig(tmpDir: string): ReviewConfig {
  return {
    artifact_root: path.join(tmpDir, '.roadrunner'),
    claude_bin: 'claude',
    methodology_path: '/path/to/_shared',
    project_root: tmpDir,
  };
}

describe('generateExpert', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'expert-test-'));
  });

  it('writes expert prompt to .roadrunner/experts/ and returns path', async () => {
    const config = makeConfig(tmpDir);
    const mockDispatcher = vi.fn()
      .mockResolvedValue({ stdout: MOCK_EXPERT_PROMPT, stderr: '', exit_code: 0 });

    const result = await generateExpert(makeCommand(), 'build', config, mockDispatcher);

    expect(result.expert_prompt_path).toContain('TASK-1.md');
    expect(fs.existsSync(result.expert_prompt_path)).toBe(true);

    const content = fs.readFileSync(result.expert_prompt_path, 'utf8');
    expect(content).toContain('Senior Backend Engineer');
  });

  it('critique mode uses -reviewer suffix in filename', async () => {
    const config = makeConfig(tmpDir);
    const mockDispatcher = vi.fn()
      .mockResolvedValue({ stdout: MOCK_EXPERT_PROMPT, stderr: '', exit_code: 0 });

    const result = await generateExpert(makeCommand(), 'critique', config, mockDispatcher);

    expect(result.expert_prompt_path).toContain('TASK-1-reviewer.md');
  });

  it('passes task details and codebase context to the metaprompt', async () => {
    const config = makeConfig(tmpDir);
    let capturedPrompt = '';
    const mockDispatcher = vi.fn()
      .mockImplementation(async (prompt) => {
        capturedPrompt = prompt;
        return { stdout: MOCK_EXPERT_PROMPT, stderr: '', exit_code: 0 };
      });

    await generateExpert(makeCommand(), 'build', config, mockDispatcher);

    expect(capturedPrompt).toContain('Implement review handler');
    expect(capturedPrompt).toContain('src/orchestrator/index.ts');
    expect(capturedPrompt).toContain('Handles GENERATE_EXPERT');
    expect(capturedPrompt).toContain('Mode: Build');
  });

  it('critique mode metaprompt includes mandatory review directive', async () => {
    const config = makeConfig(tmpDir);
    let capturedPrompt = '';
    const mockDispatcher = vi.fn()
      .mockImplementation(async (prompt) => {
        capturedPrompt = prompt;
        return { stdout: MOCK_EXPERT_PROMPT, stderr: '', exit_code: 0 };
      });

    await generateExpert(makeCommand(), 'critique', config, mockDispatcher);

    expect(capturedPrompt).toContain('Mode: Critique');
    expect(capturedPrompt).toContain('must identify at least one substantive issue');
    expect(capturedPrompt).toContain('Do not trust the implementer');
  });

  it('throws on CLI failure with no stdout', async () => {
    const config = makeConfig(tmpDir);
    const mockDispatcher = vi.fn()
      .mockResolvedValue({ stdout: '', stderr: 'connection refused', exit_code: 1 });

    await expect(generateExpert(makeCommand(), 'build', config, mockDispatcher))
      .rejects.toThrow('Expert generation failed');
  });

  it('warns but does not fail on low vocabulary cluster count', async () => {
    const config = makeConfig(tmpDir);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockDispatcher = vi.fn()
      .mockResolvedValue({
        stdout: '# Expert\n\nJust some text without clusters.',
        stderr: '',
        exit_code: 0,
      });

    const result = await generateExpert(makeCommand(), 'build', config, mockDispatcher);

    expect(result.vocabulary_cluster_count).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('0 vocabulary clusters'),
    );
    warnSpy.mockRestore();
  });

  it('creates experts directory if it does not exist', async () => {
    const config = makeConfig(tmpDir);
    const mockDispatcher = vi.fn()
      .mockResolvedValue({ stdout: MOCK_EXPERT_PROMPT, stderr: '', exit_code: 0 });

    expect(fs.existsSync(path.join(config.artifact_root, 'experts'))).toBe(false);

    await generateExpert(makeCommand(), 'build', config, mockDispatcher);

    expect(fs.existsSync(path.join(config.artifact_root, 'experts'))).toBe(true);
  });
});

describe('countVocabularyClusters', () => {
  it('counts numbered sub-headings in vocabulary section', () => {
    const content = `## Domain Vocabulary

### 1. Event Architecture
- term1

### 2. Task Orchestration
- term2

### 3. Review Pipeline
- term3`;
    expect(countVocabularyClusters(content)).toBe(3);
  });

  it('counts cluster headings', () => {
    const content = `## Vocabulary Cluster: Architecture
stuff
## Vocabulary Cluster: Testing
stuff
## Vocabulary Cluster: Data
stuff`;
    expect(countVocabularyClusters(content)).toBe(3);
  });

  it('returns 0 for content with no vocabulary section', () => {
    expect(countVocabularyClusters('# Just a heading\n\nSome text.')).toBe(0);
  });
});
