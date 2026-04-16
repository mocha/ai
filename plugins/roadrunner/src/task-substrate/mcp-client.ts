/**
 * Thin wrapper around Taskmaster MCP tool calls.
 *
 * Each function maps 1:1 to a Taskmaster MCP tool. This isolates MCP
 * protocol details from business logic. All modules in the task substrate
 * import from here rather than calling MCP directly.
 *
 * The client accepts an McpConnection interface so it can be backed by
 * a real MCP Client (from @modelcontextprotocol/sdk) or a stub for testing.
 */

import type {
  TaskPayload,
  ParsePrdResult,
  ComplexityReport,
  ValidationResult,
  ExpandOpts,
  TaskFilter,
  CreateTaskFields,
  TaskmasterStatus,
} from './types.js';

// ---------------------------------------------------------------------------
// Connection interface (injectable — real MCP or test stub)
// ---------------------------------------------------------------------------

export interface McpConnection {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// MCP Client
// ---------------------------------------------------------------------------

export interface TaskmasterClient {
  // Core CRUD
  getTask(id: number): Promise<TaskPayload>;
  getTasks(filter?: TaskFilter): Promise<TaskPayload[]>;
  nextTask(): Promise<TaskPayload | null>;
  createTask(fields: CreateTaskFields): Promise<TaskPayload>;
  setTaskStatus(id: number | string, status: TaskmasterStatus): Promise<TaskPayload>;
  updateTask(id: number, fields: Partial<TaskPayload>): Promise<TaskPayload>;

  // Decomposition
  parsePrd(specPath: string): Promise<ParsePrdResult>;
  analyzeComplexity(): Promise<ComplexityReport>;
  expandTask(taskId: number, opts?: ExpandOpts): Promise<TaskPayload>;
  expandAll(opts?: ExpandOpts): Promise<TaskPayload[]>;
  validateDependencies(): Promise<ValidationResult>;
}

/**
 * Create a TaskmasterClient backed by an MCP connection.
 *
 * Usage:
 *   const transport = new StdioClientTransport({ command: 'npx', args: ['-y', 'task-master-ai'] });
 *   const mcp = new Client({ name: 'roadrunner', version: '0.1.0' });
 *   await mcp.connect(transport);
 *   const client = createTaskmasterClient({ callTool: (name, args) => mcp.callTool({ name, arguments: args }) });
 */
export function createTaskmasterClient(conn: McpConnection): TaskmasterClient {
  async function call<T>(toolName: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await conn.callTool(toolName, args);
    // MCP tool results come back as { content: [{ type: 'text', text: '...' }] }
    // or as direct objects depending on the server. Handle both.
    if (result && typeof result === 'object' && 'content' in result) {
      const content = (result as { content: Array<{ type: string; text?: string }> }).content;
      if (content.length > 0 && content[0].text) {
        return JSON.parse(content[0].text) as T;
      }
    }
    return result as T;
  }

  return {
    async getTask(id: number): Promise<TaskPayload> {
      return call<TaskPayload>('get_task', { id: String(id) });
    },

    async getTasks(filter?: TaskFilter): Promise<TaskPayload[]> {
      const args: Record<string, unknown> = {};
      if (filter?.status) args.status = filter.status;
      if (filter?.tag) args.tag = filter.tag;
      const result = await call<{ tasks: TaskPayload[] } | TaskPayload[]>('get_tasks', args);
      return Array.isArray(result) ? result : result.tasks ?? [];
    },

    async nextTask(): Promise<TaskPayload | null> {
      const result = await call<TaskPayload | null>('next_task', {});
      return result ?? null;
    },

    async createTask(fields: CreateTaskFields): Promise<TaskPayload> {
      return call<TaskPayload>('create_task', fields as unknown as Record<string, unknown>);
    },

    async setTaskStatus(id: number | string, status: TaskmasterStatus): Promise<TaskPayload> {
      return call<TaskPayload>('set_task_status', { id: String(id), status });
    },

    async updateTask(id: number, fields: Partial<TaskPayload>): Promise<TaskPayload> {
      const { id: _id, ...rest } = fields;
      return call<TaskPayload>('update_task', { id: String(id), ...rest });
    },

    async parsePrd(specPath: string): Promise<ParsePrdResult> {
      return call<ParsePrdResult>('parse_prd', { input: specPath });
    },

    async analyzeComplexity(): Promise<ComplexityReport> {
      return call<ComplexityReport>('analyze_project_complexity', {});
    },

    async expandTask(taskId: number, opts?: ExpandOpts): Promise<TaskPayload> {
      const args: Record<string, unknown> = { id: String(taskId) };
      if (opts?.numSubtasks) args.num_subtasks = opts.numSubtasks;
      if (opts?.prompt) args.prompt = opts.prompt;
      if (opts?.force) args.force = true;
      return call<TaskPayload>('expand_task', args);
    },

    async expandAll(opts?: ExpandOpts): Promise<TaskPayload[]> {
      const args: Record<string, unknown> = {};
      if (opts?.numSubtasks) args.num_subtasks = opts.numSubtasks;
      if (opts?.prompt) args.prompt = opts.prompt;
      if (opts?.force) args.force = true;
      const result = await call<{ tasks: TaskPayload[] } | TaskPayload[]>('expand_all', args);
      return Array.isArray(result) ? result : result.tasks ?? [];
    },

    async validateDependencies(): Promise<ValidationResult> {
      return call<ValidationResult>('validate_dependencies', {});
    },
  };
}
