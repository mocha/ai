import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createReviewHandler } from '../handler.js';
import type { GenerateExpert } from '../../orchestrator/commands.js';
import type { OrchestratorEvent } from '../../orchestrator/events.js';
import type { ReviewConfig } from '../types.js';

/**
 * Integration test: Pre-dispatch flow
 *
 * Tests the full GENERATE_EXPERT → expert prompt → drift validation → EXPERT_READY pipeline.
 */

const MOCK_EXPERT_OUTPUT = `# Senior TypeScript Engineer — Event Pipeline Specialist

## Domain Vocabulary

### 1. State Management
- XState v5 — deterministic finite state machine with hierarchical states
- Assign actions — pure context mutations

### 2. Event Architecture
- Event bus — typed pub/sub command dispatch
- Discriminated unions — TypeScript pattern for exhaustive event handling

### 3. Testing
- Vitest — modern test runner with native ESM support
- Snapshot-based actor testing — XState pattern for state transition testing

## Anti-Patterns
1. **Context Bloat** — storing large payloads in XState context
2. **Event Storm** — dispatching without awaiting

## Operational Guidance
Focus on correctness over performance.

## Deliverables
- Implement the feature as specified
- Write tests for all state transitions`;

function makeConfig(tmpDir: string): ReviewConfig {
  return {
    artifact_root: path.join(tmpDir, '.roadrunner'),
    claude_bin: 'claude',
    methodology_path: '/path/to/_shared',
    project_root: tmpDir,
  };
}

function makeGenerateExpert(overrides: Partial<GenerateExpert> = {}): GenerateExpert {
  return {
    type: 'GENERATE_EXPERT',
    task_id: 42,
    task: {
      id: 42,
      title: 'Add event bus retry logic',
      dependencies: [1, 2],
      status: 'pending',
      details: 'Implement retry with exponential backoff for failed command dispatches',
      acceptanceCriteria: [
        'Retries up to 3 times on failure',
        'Uses exponential backoff (500ms, 2000ms)',
        'Logs each retry attempt',
      ],
      relevantFiles: ['src/orchestrator/bus.ts', 'src/orchestrator/types.ts'],
    },
    risk: 'standard',
    codebase_context: {
      entry_points: ['src/orchestrator/index.ts'],
      recent_changes: ['Added gate field to ReviewComplete'],
      related_tests: ['src/orchestrator/__tests__/bus.test.ts'],
    },
    ...overrides,
  };
}

describe('Pre-dispatch integration: GENERATE_EXPERT → EXPERT_READY', () => {
  let tmpDir: string;
  let events: OrchestratorEvent[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'pre-dispatch-'));
    // Create files that the task references
    fs.mkdirSync(path.join(tmpDir, 'src', 'orchestrator', '__tests__'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'orchestrator', 'bus.ts'), 'export function createEventBus() {}');
    fs.writeFileSync(path.join(tmpDir, 'src', 'orchestrator', 'types.ts'), 'export type RiskLevel = "trivial"');
    fs.writeFileSync(path.join(tmpDir, 'src', 'orchestrator', 'index.ts'), 'export {}');
    fs.writeFileSync(path.join(tmpDir, 'src', 'orchestrator', '__tests__', 'bus.test.ts'), 'test("bus", () => {})');
    events = [];
  });

  it('standard risk: generates expert prompt and passes drift check', async () => {
    const config = makeConfig(tmpDir);
    const mockDispatcher = vi.fn().mockResolvedValue({
      stdout: MOCK_EXPERT_OUTPUT,
      stderr: '',
      exit_code: 0,
    });

    const handler = createReviewHandler(config, (e) => events.push(e), mockDispatcher);

    handler(makeGenerateExpert());
    await vi.waitFor(() => expect(events.length).toBe(1), { timeout: 5000 });

    const event = events[0];
    expect(event.type).toBe('EXPERT_READY');
    if (event.type !== 'EXPERT_READY') return;

    // Expert prompt was written
    expect(event.expert_prompt_path).toContain('TASK-42.md');
    expect(fs.existsSync(event.expert_prompt_path)).toBe(true);

    // Expert prompt content is the mock output
    const content = fs.readFileSync(event.expert_prompt_path, 'utf8');
    expect(content).toContain('Senior TypeScript Engineer');
    expect(content).toContain('Event Architecture');

    // Drift passes because all referenced files exist
    expect(event.drift_check).toBe('pass');
    expect(event.drift_details).toBeNull();
  });

  it('standard risk with missing file: expert prompt written but drift fails', async () => {
    const config = makeConfig(tmpDir);
    const mockDispatcher = vi.fn().mockResolvedValue({
      stdout: MOCK_EXPERT_OUTPUT,
      stderr: '',
      exit_code: 0,
    });

    const handler = createReviewHandler(config, (e) => events.push(e), mockDispatcher);

    handler(makeGenerateExpert({
      task: {
        id: 42,
        title: 'Add retry logic',
        dependencies: [],
        status: 'pending',
        details: '',
        acceptanceCriteria: [],
        relevantFiles: ['src/orchestrator/bus.ts', 'src/missing-module.ts'],
      },
    }));

    await vi.waitFor(() => expect(events.length).toBe(1), { timeout: 5000 });

    const event = events[0];
    expect(event.type).toBe('EXPERT_READY');
    if (event.type !== 'EXPERT_READY') return;

    // Expert prompt was still written (per spec section 11)
    expect(fs.existsSync(event.expert_prompt_path)).toBe(true);

    // But drift check failed
    expect(event.drift_check).toBe('fail');
    expect(event.drift_details).toContain('missing-module.ts');
  });

  it('trivial risk: fast-path with empty expert prompt and pass', async () => {
    const config = makeConfig(tmpDir);
    const mockDispatcher = vi.fn();

    const handler = createReviewHandler(config, (e) => events.push(e), mockDispatcher);

    handler(makeGenerateExpert({ risk: 'trivial' }));
    await vi.waitFor(() => expect(events.length).toBe(1));

    const event = events[0];
    expect(event.type).toBe('EXPERT_READY');
    if (event.type !== 'EXPERT_READY') return;

    expect(event.expert_prompt_path).toBe('');
    expect(event.drift_check).toBe('pass');

    // CLI was never called
    expect(mockDispatcher).not.toHaveBeenCalled();
  });

  it('metaprompt includes task details and codebase context', async () => {
    const config = makeConfig(tmpDir);
    let capturedPrompt = '';
    const mockDispatcher = vi.fn().mockImplementation(async (prompt: string) => {
      capturedPrompt = prompt;
      return { stdout: MOCK_EXPERT_OUTPUT, stderr: '', exit_code: 0 };
    });

    const handler = createReviewHandler(config, (e) => events.push(e), mockDispatcher);

    handler(makeGenerateExpert());
    await vi.waitFor(() => expect(events.length).toBe(1), { timeout: 5000 });

    // The metaprompt should contain task details
    expect(capturedPrompt).toContain('Add event bus retry logic');
    expect(capturedPrompt).toContain('exponential backoff');
    expect(capturedPrompt).toContain('src/orchestrator/index.ts');
  });
});
