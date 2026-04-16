/**
 * Worker layer public API.
 *
 * Barrel exports for all public symbols in src/worker/.
 */

export { createWorkerHandler } from './handler.js';
export type { WorkerDeps } from './handler.js';

export { createDefaultWorkerConfig } from './types.js';
export type {
  WorkerConfig,
  ExecResult,
  WorktreeInfo,
  SessionTracker,
  HookEvent,
  HandoffArtifact,
  MergeResult,
} from './types.js';

export {
  createWorktree,
  removeWorktree,
  listWorktrees,
  hasUncommittedChanges,
  commitWip,
  getFilesChanged,
} from './worktree.js';

export { buildTaskPrompt, buildFixPrompt, buildReviewPrompt } from './prompt.js';

export { generateWorkerSettings, installWorkerSettings } from './settings.js';

export { invokeClaude } from './execute.js';
export type { ExecuteOptions, ExecuteResult } from './execute.js';

export { parseCliOutput, extractStatus, writeResultArtifact } from './result.js';

export { assemblePredecessorContext, writeSessionContext } from './context.js';
export type { PredecessorContext, PredecessorSummary } from './context.js';

export { mergeTaskBranch, discardTaskBranch } from './merge.js';
