import { describe, it, expect, vi } from 'vitest';
import { createTaskSubstrateHandler } from '../handler.js';
import type { TaskmasterClient } from '../mcp-client.js';
import type { OrchestratorEvent } from '../../orchestrator/events.js';
import type { TaskPayload } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<TaskPayload> = {}): TaskPayload {
  return {
    id: 1,
    title: 'Test task',
    description: '',
    details: '',
    status: 'pending',
    priority: 'medium',
    dependencies: [],
    subtasks: [],
    parentId: null,
    testStrategy: '',
    acceptanceCriteria: '',
    relevantFiles: [],
    complexity: 5,
    ...overrides,
  };
}

function makeMockClient(overrides: Partial<TaskmasterClient> = {}): TaskmasterClient {
  return {
    getTask: vi.fn().mockResolvedValue(makeTask()),
    getTasks: vi.fn().mockResolvedValue([]),
    nextTask: vi.fn().mockResolvedValue(null),
    createTask: vi.fn(),
    setTaskStatus: vi.fn().mockResolvedValue(makeTask()),
    updateTask: vi.fn().mockResolvedValue(makeTask()),
    parsePrd: vi.fn().mockResolvedValue({ tasks: [] }),
    analyzeComplexity: vi.fn().mockResolvedValue({ tasks: [] }),
    expandTask: vi.fn().mockResolvedValue(makeTask()),
    expandAll: vi.fn().mockResolvedValue([]),
    validateDependencies: vi.fn().mockResolvedValue({ valid: true, issues: [] }),
    ...overrides,
  };
}

function collectEvents(): { events: OrchestratorEvent[]; sendEvent: (e: OrchestratorEvent) => void } {
  const events: OrchestratorEvent[] = [];
  return {
    events,
    sendEvent: (e: OrchestratorEvent) => events.push(e),
  };
}

// ---------------------------------------------------------------------------
// Handler routing
// ---------------------------------------------------------------------------

describe('createTaskSubstrateHandler', () => {
  it('ignores non-Layer-3 commands', () => {
    const client = makeMockClient();
    const { events, sendEvent } = collectEvents();
    const handler = createTaskSubstrateHandler(client, sendEvent);

    // RUN_TRIAGE is a Layer 1 command — should be ignored
    handler({ type: 'RUN_TRIAGE', input: { type: '', content: '', user_risk_override: null } });

    // No events should be emitted
    expect(events).toHaveLength(0);
  });

  it('handles QUERY_NEXT_TASK and emits QUERY_RESULT', async () => {
    const readyTask = makeTask({ id: 42, title: 'Ready' });
    const client = makeMockClient({
      nextTask: vi.fn().mockResolvedValue(readyTask),
    });
    const { events, sendEvent } = collectEvents();
    const handler = createTaskSubstrateHandler(client, sendEvent);

    handler({
      type: 'QUERY_NEXT_TASK',
      filter: { status: 'pending', dependencies_met: true },
    });

    // Wait for async handler to complete
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));

    expect(events[0].type).toBe('QUERY_RESULT');
    const qr = events[0] as Extract<OrchestratorEvent, { type: 'QUERY_RESULT' }>;
    expect(qr.outcome).toBe('task_ready');
    expect(qr.task!.id).toBe(42);
  });

  it('handles QUERY_NEXT_TASK with all_complete', async () => {
    const client = makeMockClient({
      nextTask: vi.fn().mockResolvedValue(null),
      getTasks: vi.fn().mockResolvedValue([
        makeTask({ id: 1, status: 'done' }),
      ]),
    });
    const { events, sendEvent } = collectEvents();
    const handler = createTaskSubstrateHandler(client, sendEvent);

    handler({
      type: 'QUERY_NEXT_TASK',
      filter: { status: 'pending', dependencies_met: true },
    });

    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));

    const qr = events[0] as Extract<OrchestratorEvent, { type: 'QUERY_RESULT' }>;
    expect(qr.outcome).toBe('all_complete');
  });

  it('handles UPDATE_TASK_STATUS', async () => {
    const task = makeTask({ id: 7, parentId: null });
    const client = makeMockClient({
      getTask: vi.fn().mockResolvedValue(task),
      setTaskStatus: vi.fn().mockResolvedValue({ ...task, status: 'done' }),
    });
    const { events, sendEvent } = collectEvents();
    const handler = createTaskSubstrateHandler(client, sendEvent);

    handler({
      type: 'UPDATE_TASK_STATUS',
      task_id: 7,
      status: 'done',
    });

    // No rollup for top-level task with no parent
    await new Promise((r) => setTimeout(r, 50));
    // No STATUS_ROLLUP emitted for parentless tasks
    expect(events.filter((e) => e.type === 'STATUS_ROLLUP')).toHaveLength(0);
  });

  it('emits DISPATCH_ERROR when QUERY_NEXT_TASK fails', async () => {
    const client = makeMockClient({
      nextTask: vi.fn().mockRejectedValue(new Error('MCP timeout')),
    });
    const { events, sendEvent } = collectEvents();
    const handler = createTaskSubstrateHandler(client, sendEvent);

    handler({
      type: 'QUERY_NEXT_TASK',
      filter: { status: 'pending', dependencies_met: true },
    });

    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));

    expect(events[0].type).toBe('DISPATCH_ERROR');
    const err = events[0] as Extract<OrchestratorEvent, { type: 'DISPATCH_ERROR' }>;
    expect(err.failed_command).toBe('QUERY_NEXT_TASK');
    expect(err.error_message).toContain('MCP timeout');
  });
});
