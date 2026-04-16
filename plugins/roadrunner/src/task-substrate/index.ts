/**
 * Layer 3 — Task Substrate
 *
 * Public API for the task substrate domain. Handles decomposition,
 * querying, status tracking, sizing enforcement, and artifact bridging
 * for the Skylark composed pipeline.
 */

// Command handler (primary integration point with the orchestrator)
export { createTaskSubstrateHandler } from './handler.js';

// MCP client
export { createTaskmasterClient } from './mcp-client.js';
export type { TaskmasterClient, McpConnection } from './mcp-client.js';

// Decomposition
export { decompose } from './decompose.js';

// Queries
export { queryNextTask, queryBlockers, queryStatusRollup } from './query.js';
export type { BlockerReport } from './query.js';

// Status updates
export { updateTaskStatus } from './status-bridge.js';
export type { StatusUpdateResult } from './status-bridge.js';

// Sizing enforcement
export {
  checkTaskSize,
  checkArtifactSize,
  handleCompaction,
  promoteSubtask,
  logCalibrationWarning,
} from './sizing.js';

// Artifact bridging
export {
  linkTaskToArtifact,
  resolveArtifactForTask,
  resolveTasksForArtifact,
  syncArtifactStatus,
} from './artifact-bridge.js';

// Types
export type {
  TaskPayload,
  SubtaskPayload,
  RelevantFile,
  TaskmasterStatus,
  TaskSizingResult,
  ArtifactSizingResult,
  ArtifactSizingThresholds,
  ArtifactRef,
  ComplexityReport,
  ComplexityItem,
  ValidationResult,
  ParsePrdResult,
  ExpandOpts,
  TaskFilter,
  CreateTaskFields,
} from './types.js';

export { SIZING_CONSTANTS, VERTICAL_SLICE_PROMPT, DEFAULT_DOMAIN_KEYWORDS } from './types.js';
