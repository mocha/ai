/**
 * Layer 3 — Task Substrate types
 *
 * Types specific to the task substrate domain. These are the internal
 * representation used by the task substrate modules. The orchestrator
 * has its own leaner types (TaskSpec, QueryResult, etc.) — conversion
 * between the two happens at the handler boundary.
 */

// ---------------------------------------------------------------------------
// Taskmaster task payload (mirrors Taskmaster's schema)
// ---------------------------------------------------------------------------

export interface TaskPayload {
  id: number;
  title: string;
  description: string;
  details: string;
  status: TaskmasterStatus;
  priority: 'high' | 'medium' | 'low';
  dependencies: number[];
  subtasks: SubtaskPayload[];
  parentId: number | null;
  testStrategy: string;
  acceptanceCriteria: string;
  relevantFiles: RelevantFile[];
  complexity: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface SubtaskPayload {
  id: number;
  title: string;
  description: string;
  details: string;
  status: TaskmasterStatus;
  dependencies: number[];
  acceptanceCriteria: string;
  testStrategy: string;
}

export interface RelevantFile {
  path: string;
  description: string;
  action: 'create' | 'modify' | 'reference';
}

export type TaskmasterStatus =
  | 'pending'
  | 'in-progress'
  | 'done'
  | 'blocked'
  | 'deferred'
  | 'cancelled';

// ---------------------------------------------------------------------------
// MCP tool response wrappers
// ---------------------------------------------------------------------------

export interface ParsePrdResult {
  tasks: TaskPayload[];
}

export interface ComplexityReport {
  tasks: ComplexityItem[];
}

export interface ComplexityItem {
  taskId: number;
  taskTitle: string;
  complexityScore: number;
  recommendedSubtasks: number;
  expansionPrompt: string;
  reasoning: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface ValidationIssue {
  type: 'circular' | 'missing_target' | 'self_reference';
  taskId: number;
  details: string;
}

export interface ExpandOpts {
  numSubtasks?: number;
  prompt?: string;
  force?: boolean;
}

export interface TaskFilter {
  status?: TaskmasterStatus;
  tag?: string;
}

export interface CreateTaskFields {
  title: string;
  description: string;
  details?: string;
  priority?: 'high' | 'medium' | 'low';
  dependencies?: number[];
  testStrategy?: string;
  acceptanceCriteria?: string;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Sizing constants
// ---------------------------------------------------------------------------

export const SIZING_CONSTANTS = {
  /** Approximate tokens per line of code */
  TOKENS_PER_LOC: 18,

  /** Maximum lines of code per task for single-session fit */
  MAX_LOC_PER_TASK: 500,

  /** Maximum code tokens (LOC * TOKENS_PER_LOC) */
  MAX_CODE_TOKENS: 9000,

  /** JetBrains research: accuracy drops past this context threshold */
  CONTEXT_CEILING_TOKENS: 32_000,

  /** Complexity score above which tasks should be decomposed */
  COMPLEXITY_DECOMPOSE_THRESHOLD: 7,

  /** Complexity score at or below which decomposition is blocked */
  COMPLEXITY_FLOOR: 3,

  /** File blast radius at or above which decomposition is recommended */
  FILE_BLAST_RADIUS_THRESHOLD: 4,

  /** Approximate context window for a Claude session */
  SESSION_CONTEXT_WINDOW: 200_000,
} as const;

// ---------------------------------------------------------------------------
// Sizing result (task-level, distinct from orchestrator's artifact-level)
// ---------------------------------------------------------------------------

export interface TaskSizingResult {
  fits_single_session: boolean;
  complexity: number;
  estimated_loc: number;
  estimated_code_tokens: number;
  file_blast_radius: number;
  recommendation: 'dispatch' | 'decompose' | 'scope_down';
  reason: string;
}

// ---------------------------------------------------------------------------
// Artifact sizing (consumed by orchestrator's size_check gates)
// ---------------------------------------------------------------------------

export interface ArtifactSizingThresholds {
  max_prose_tokens: number;
  max_prose_lines: number;
  max_file_blast_radius: number;
}

export interface ArtifactSizingResult {
  token_count: number;
  prose_line_count: number;
  file_blast_radius: number;
  verdict: 'under' | 'over' | 'ambiguous';
}

// ---------------------------------------------------------------------------
// Artifact bridging
// ---------------------------------------------------------------------------

export interface ArtifactRef {
  type: 'spec' | 'plan' | 'task' | 'report' | 'notes';
  id: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Domain cluster extraction
// ---------------------------------------------------------------------------

export const DEFAULT_DOMAIN_KEYWORDS = [
  'database', 'api', 'auth', 'events', 'ui',
  'infra', 'billing', 'integrations', 'search',
  'storage', 'cache', 'queue', 'worker', 'config',
] as const;

// ---------------------------------------------------------------------------
// Vertical slice decomposition prompt
// ---------------------------------------------------------------------------

export const VERTICAL_SLICE_PROMPT = `Decompose into vertical slices. Each subtask should deliver \
end-to-end value through all affected layers (e.g., database + service \
+ API + test for one feature slice), not horizontal slices across one \
layer (e.g., all database changes, then all service changes). If the \
task only touches one layer, this guidance does not apply.`;
