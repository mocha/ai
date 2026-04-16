import { describe, it, expect, vi } from 'vitest';
import { queryNextTask, queryBlockers, queryStatusRollup } from '../query.js';
import type { TaskmasterClient } from '../mcp-client.js';
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
    getTask: vi.fn(),
    getTasks: vi.fn().mockResolvedValue([]),
    nextTask: vi.fn().mockResolvedValue(null),
    createTask: vi.fn(),
    setTaskStatus: vi.fn(),
    updateTask: vi.fn(),
    parsePrd: vi.fn(),
    analyzeComplexity: vi.fn(),
    expandTask: vi.fn(),
    expandAll: vi.fn(),
    validateDependencies: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// queryNextTask
// ---------------------------------------------------------------------------

describe('queryNextTask', () => {
  it('returns task_ready when a task is available', async () => {
    const task = makeTask({ id: 42, title: 'Ready task' });
    const client = makeMockClient({
      nextTask: vi.fn().mockResolvedValue(task),
    });

    const result = await queryNextTask(client);

    expect(result.outcome).toBe('task_ready');
    expect(result.task).toBeDefined();
    expect(result.task!.id).toBe(42);
    expect(result.task!.title).toBe('Ready task');
  });

  it('returns all_complete when no non-terminal tasks remain', async () => {
    const client = makeMockClient({
      nextTask: vi.fn().mockResolvedValue(null),
      getTasks: vi.fn().mockResolvedValue([
        makeTask({ id: 1, status: 'done' }),
        makeTask({ id: 2, status: 'cancelled' }),
      ]),
    });

    const result = await queryNextTask(client);

    expect(result.outcome).toBe('all_complete');
    expect(result.task).toBeUndefined();
  });

  it('returns all_blocked when tasks exist but none are ready', async () => {
    const client = makeMockClient({
      nextTask: vi.fn().mockResolvedValue(null),
      getTasks: vi.fn().mockResolvedValue([
        makeTask({ id: 1, status: 'done' }),
        makeTask({ id: 2, status: 'pending', dependencies: [3] }),
        makeTask({ id: 3, status: 'blocked' }),
      ]),
    });

    const result = await queryNextTask(client);

    expect(result.outcome).toBe('all_blocked');
    expect(result.blocked_task_ids).toContain(2);
    expect(result.blocked_task_ids).toContain(3);
    expect(result.blocked_reasons).toBeDefined();
    expect(result.blocked_reasons!.length).toBeGreaterThan(0);
  });

  it('includes blocked reason details', async () => {
    const client = makeMockClient({
      nextTask: vi.fn().mockResolvedValue(null),
      getTasks: vi.fn().mockResolvedValue([
        makeTask({ id: 1, status: 'pending', dependencies: [2] }),
        makeTask({ id: 2, status: 'blocked' }),
      ]),
    });

    const result = await queryNextTask(client);

    expect(result.outcome).toBe('all_blocked');
    // Task 1 is blocked by task 2
    const reason1 = result.blocked_reasons!.find((r) => r.includes('TASK-1'));
    expect(reason1).toContain('TASK-2');
  });
});

// ---------------------------------------------------------------------------
// queryBlockers
// ---------------------------------------------------------------------------

describe('queryBlockers', () => {
  it('returns empty blockers when all dependencies are done', async () => {
    const client = makeMockClient({
      getTask: vi.fn()
        .mockResolvedValueOnce(makeTask({ id: 5, dependencies: [1, 2] }))
        .mockResolvedValueOnce(makeTask({ id: 1, status: 'done' }))
        .mockResolvedValueOnce(makeTask({ id: 2, status: 'done' })),
    });

    const report = await queryBlockers(client, 5);

    expect(report.task_id).toBe(5);
    expect(report.blockers).toHaveLength(0);
  });

  it('returns blockers for unsatisfied dependencies', async () => {
    const client = makeMockClient({
      getTask: vi.fn()
        .mockResolvedValueOnce(makeTask({ id: 5, dependencies: [1, 2] }))
        .mockResolvedValueOnce(makeTask({ id: 1, status: 'done' }))
        .mockResolvedValueOnce(makeTask({ id: 2, status: 'pending' })),
    });

    const report = await queryBlockers(client, 5);

    expect(report.blockers).toHaveLength(1);
    expect(report.blockers[0].id).toBe(2);
    expect(report.blockers[0].status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// queryStatusRollup
// ---------------------------------------------------------------------------

describe('queryStatusRollup', () => {
  it('returns all_complete when all subtasks are done', async () => {
    const client = makeMockClient({
      getTask: vi.fn().mockResolvedValue(
        makeTask({
          id: 3,
          subtasks: [
            { id: 1, title: '', description: '', details: '', status: 'done', dependencies: [], acceptanceCriteria: '', testStrategy: '' },
            { id: 2, title: '', description: '', details: '', status: 'done', dependencies: [], acceptanceCriteria: '', testStrategy: '' },
          ],
        }),
      ),
    });

    const rollup = await queryStatusRollup(client, 3);

    expect(rollup.parent_id).toBe(3);
    expect(rollup.children_complete).toBe(2);
    expect(rollup.children_total).toBe(2);
    expect(rollup.all_complete).toBe(true);
  });

  it('returns partial completion', async () => {
    const client = makeMockClient({
      getTask: vi.fn().mockResolvedValue(
        makeTask({
          id: 3,
          subtasks: [
            { id: 1, title: '', description: '', details: '', status: 'done', dependencies: [], acceptanceCriteria: '', testStrategy: '' },
            { id: 2, title: '', description: '', details: '', status: 'pending', dependencies: [], acceptanceCriteria: '', testStrategy: '' },
            { id: 3, title: '', description: '', details: '', status: 'pending', dependencies: [], acceptanceCriteria: '', testStrategy: '' },
          ],
        }),
      ),
    });

    const rollup = await queryStatusRollup(client, 3);

    expect(rollup.children_complete).toBe(1);
    expect(rollup.children_total).toBe(3);
    expect(rollup.all_complete).toBe(false);
  });
});
