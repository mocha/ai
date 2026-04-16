import type { RiskLevel } from '../orchestrator/types.js';

/** Raw output from claude CLI subprocess */
export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  retried: boolean;
  duration_ms: number;
}

/** Tracked worktree metadata */
export interface WorktreeInfo {
  task_id: number;
  branch: string;
  path: string;
  base_branch: string;
  created_at: string; // ISO-8601
}

/** Per-task session tracking for compaction counting */
export interface SessionTracker {
  task_id: number;
  dispatch_count: number;
  handoff_count: number;
  total_cost_usd: number;
  total_duration_ms: number;
}

/** Worker layer configuration */
export interface WorkerConfig {
  base_branch: string;
  worktree_root: string;
  artifact_root: string;
  claude_bin: string;
  methodology_path: string | null;
  timeout_overrides: Partial<Record<RiskLevel, number>> | null;
}

export function createDefaultWorkerConfig(): WorkerConfig {
  return {
    base_branch: 'main',
    worktree_root: '.worktrees',
    artifact_root: '.roadrunner',
    claude_bin: 'claude',
    methodology_path: null,
    timeout_overrides: null,
  };
}

/** Hook event written to .roadrunner/events/ by shell hooks */
export interface HookEvent {
  event: 'CONTEXT_WARNING' | 'COMPACTION_DETECTED' | 'HANDOFF_READY';
  task_id: number;
  session_id: string;
  utilization_pct?: number;
  threshold?: 40 | 60 | 70;
  action?: 'warn' | 'save_state' | 'handoff';
  handoff_path?: string;
  error?: string;
}

/** Handoff artifact schema */
export interface HandoffArtifact {
  task_id: number;
  session_number: number;
  completed_work: string[];
  pending_work: string[];
  decisions: Array<{ decision: string; rationale: string }>;
  modified_files: string[];
  blockers: string[];
  next_steps: string[];
  git_state: {
    branch: string;
    head_sha: string;
    uncommitted_changes: boolean;
  };
}

/** Merge result */
export interface MergeResult {
  success: boolean;
  merged_branch: string;
  base_branch: string;
  conflict_files?: string[];
  error?: string;
}
