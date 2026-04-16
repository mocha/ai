import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { ResolutionRecord, TaskSummary } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Given a reference basename like "SPEC-001.md", extract the artifact ID
 * prefix ("SPEC-001") and extension (".md"), then scan the directory for all
 * files whose name starts with that prefix and ends with that extension.
 */
function globSingleDir(dir: string, basename: string): string[] {
  const ext = path.extname(basename);
  const stem = path.basename(basename, ext); // e.g. "SPEC-001"

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(
      (e) =>
        e.isFile() &&
        e.name.startsWith(stem) &&
        e.name.endsWith(ext),
    )
    .map((e) => path.join(dir, e.name));
}

// ---------------------------------------------------------------------------
// resolveArtifactPath
// ---------------------------------------------------------------------------

/**
 * Resolve a (possibly stale) artifact path reference to the actual file on
 * disk. Tries exact match first, then a same-directory glob on the artifact
 * ID prefix.
 */
export function resolveArtifactPath(
  referencePath: string,
  baseDir: string,
): ResolutionRecord {
  const timestamp = nowIso();

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

  // 2. Glob match — search the file's own directory (ignore baseDir for the
  //    glob itself; baseDir is kept for context / future use).
  const dir = path.dirname(referencePath);
  const basename = path.basename(referencePath);
  const candidates = globSingleDir(dir, basename);

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

  // Zero or 2+ matches — ambiguous or not found
  return {
    timestamp,
    seam: 'artifact_path',
    reference: referencePath,
    candidates,
    resolved_to: null,
    method: 'glob',
  };
}

// ---------------------------------------------------------------------------
// reconcileTaskId
// ---------------------------------------------------------------------------

/**
 * Reconcile an orchestrator task status against the canonical external
 * (Taskmaster) status. Taskmaster is always canonical — returns external
 * status as resolved_to. Logs a warning if the two disagree.
 */
export function reconcileTaskId(
  orchestratorTask: TaskSummary,
  externalStatus: string,
): ResolutionRecord {
  const timestamp = nowIso();
  const reference = String(orchestratorTask.id);

  if (orchestratorTask.status !== externalStatus) {
    console.warn(
      `[resolution] Task ${orchestratorTask.id} status drift: ` +
        `orchestrator="${orchestratorTask.status}" external="${externalStatus}". ` +
        `Using external (Taskmaster) as canonical.`,
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

// ---------------------------------------------------------------------------
// resolveReviewFindingFile
// ---------------------------------------------------------------------------

/**
 * Resolve a review-finding file path. Tries exact match, then git rename
 * detection. Never throws — a missing finding must not block verdict routing.
 */
export function resolveReviewFindingFile(
  filePath: string,
  baseDir: string,
): ResolutionRecord {
  const timestamp = nowIso();

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
    const raw = execSync(
      `git log --follow --diff-filter=R --name-only --pretty=format: -1 -- "${filePath}"`,
      { cwd: baseDir, timeout: 5000, encoding: 'utf8' },
    );

    // Output may have leading/trailing blank lines; find the first non-empty line
    const renamedPath = raw
      .split('\n')
      .map((l: string) => l.trim())
      .find((l: string) => l.length > 0);

    if (renamedPath) {
      const resolved = path.isAbsolute(renamedPath)
        ? renamedPath
        : path.join(baseDir, renamedPath);

      if (fs.existsSync(resolved)) {
        return {
          timestamp,
          seam: 'finding_file',
          reference: filePath,
          candidates: [resolved],
          resolved_to: resolved,
          method: 'git_follow',
        };
      }
    }
  } catch {
    // git not available, not a repo, or timed out — fall through to null
  }

  return {
    timestamp,
    seam: 'finding_file',
    reference: filePath,
    candidates: [],
    resolved_to: null,
    method: 'git_follow',
  };
}
