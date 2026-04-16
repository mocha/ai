/**
 * Artifact bridging — Taskmaster <-> Skylark cross-references.
 *
 * Taskmaster knows tasks and subtasks. Skylark knows specs, plans,
 * task specs, reports, and session notes as markdown with YAML frontmatter.
 * This bridge maintains bidirectional cross-references.
 *
 * Linking strategy (per spec 03-task-substrate.md Section 2.2):
 * - Taskmaster -> Skylark: task's tags include 'artifact:SPEC-001',
 *   relevantFiles include the artifact path
 * - Skylark -> Taskmaster: task spec's task_number frontmatter matches
 *   the Taskmaster task ID
 */

import * as fs from 'node:fs';
import type { TaskmasterClient } from './mcp-client.js';
import type { ArtifactRef, TaskmasterStatus } from './types.js';

// ---------------------------------------------------------------------------
// Link a Taskmaster task to a Skylark artifact
// ---------------------------------------------------------------------------

export async function linkTaskToArtifact(
  client: TaskmasterClient,
  taskId: number,
  artifactPath: string,
  artifactId: string, // e.g., "SPEC-001"
): Promise<void> {
  let task;
  try {
    task = await client.getTask(taskId);
  } catch {
    console.warn(
      `[artifact-bridge] Task ${taskId} not found — cannot link to ${artifactId}`,
    );
    return;
  }

  // Add artifact tag if not already present
  const tags = task.tags ?? [];
  const tagValue = `artifact:${artifactId}`;
  if (!tags.includes(tagValue)) {
    tags.push(tagValue);
  }

  // Add artifact path to relevantFiles if not already present
  const relevantFiles = task.relevantFiles ?? [];
  const alreadyReferenced = relevantFiles.some((f) => f.path === artifactPath);
  if (!alreadyReferenced) {
    relevantFiles.push({
      path: artifactPath,
      description: `Linked artifact: ${artifactId}`,
      action: 'reference',
    });
  }

  await client.updateTask(taskId, { tags, relevantFiles });

  // If the artifact is a Skylark task spec, update its task_number frontmatter
  if (artifactPath.match(/docs\/tasks\/TASK-\d+-/)) {
    updateTaskSpecFrontmatter(artifactPath, taskId);
  }
}

// ---------------------------------------------------------------------------
// Resolve: Taskmaster task ID -> Skylark artifact
// ---------------------------------------------------------------------------

export async function resolveArtifactForTask(
  client: TaskmasterClient,
  taskId: number,
): Promise<ArtifactRef | null> {
  let task;
  try {
    task = await client.getTask(taskId);
  } catch {
    return null;
  }

  // Check tags for artifact references
  const tags = task.tags ?? [];
  for (const tag of tags) {
    const match = tag.match(/^(artifact|spec|plan):(.+)$/);
    if (match) {
      const artifactId = match[2];
      const type = inferArtifactType(artifactId);
      const path = findArtifactPath(artifactId);
      if (path) {
        return { type, id: artifactId, path };
      }
    }
  }

  // Check relevantFiles for artifact paths
  const relevantFiles = task.relevantFiles ?? [];
  for (const file of relevantFiles) {
    const ref = parseArtifactPath(file.path);
    if (ref) return ref;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Resolve: Skylark artifact -> Taskmaster task IDs
// ---------------------------------------------------------------------------

export async function resolveTasksForArtifact(
  client: TaskmasterClient,
  artifactPath: string,
): Promise<number[]> {
  const allTasks = await client.getTasks();
  const artifactId = extractArtifactId(artifactPath);
  const matchingIds: number[] = [];

  for (const task of allTasks) {
    // Check tags
    const tags = task.tags ?? [];
    const hasTag = tags.some(
      (t) =>
        t === `artifact:${artifactId}` ||
        t === `spec:${artifactId}` ||
        t === `plan:${artifactId}`,
    );

    // Check relevantFiles
    const hasFile = task.relevantFiles?.some(
      (f) => f.path === artifactPath,
    );

    if (hasTag || hasFile) {
      matchingIds.push(task.id);
    }
  }

  return matchingIds;
}

// ---------------------------------------------------------------------------
// Sync status from Taskmaster to Skylark task spec
// ---------------------------------------------------------------------------

export async function syncArtifactStatus(
  client: TaskmasterClient,
  taskId: number,
  newStatus: TaskmasterStatus,
): Promise<void> {
  const artifactRef = await resolveArtifactForTask(client, taskId);
  if (!artifactRef) return;

  // Only sync task specs (not specs or plans)
  if (!artifactRef.path.match(/docs\/tasks\/TASK-\d+-/)) return;

  try {
    const content = fs.readFileSync(artifactRef.path, 'utf8');
    const updated = updateFrontmatterStatus(content, newStatus);
    if (updated !== content) {
      fs.writeFileSync(artifactRef.path, updated);
    }
  } catch {
    console.warn(
      `[artifact-bridge] Failed to sync status for ${artifactRef.path}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function inferArtifactType(
  artifactId: string,
): ArtifactRef['type'] {
  if (artifactId.startsWith('SPEC-')) return 'spec';
  if (artifactId.startsWith('PLAN-')) return 'plan';
  if (artifactId.startsWith('TASK-')) return 'task';
  if (artifactId.startsWith('R-')) return 'report';
  if (artifactId.startsWith('NOTE-')) return 'notes';
  return 'task';
}

function findArtifactPath(artifactId: string): string | null {
  const dirs: Record<string, string> = {
    SPEC: 'docs/specs',
    PLAN: 'docs/plans',
    TASK: 'docs/tasks',
    R: 'docs/reports',
    NOTE: 'docs/notes',
  };

  for (const [prefix, dir] of Object.entries(dirs)) {
    if (artifactId.startsWith(prefix)) {
      try {
        const files = fs.readdirSync(dir);
        const match = files.find((f) => f.startsWith(artifactId));
        if (match) return `${dir}/${match}`;
      } catch {
        // Directory doesn't exist
      }
    }
  }

  return null;
}

function parseArtifactPath(filePath: string): ArtifactRef | null {
  const patterns: Array<{ regex: RegExp; type: ArtifactRef['type'] }> = [
    { regex: /docs\/specs\/(SPEC-\d+)/, type: 'spec' },
    { regex: /docs\/plans\/(PLAN-\d+)/, type: 'plan' },
    { regex: /docs\/tasks\/(TASK-\d+)/, type: 'task' },
    { regex: /docs\/reports\/(R-\d+)/, type: 'report' },
    { regex: /docs\/notes\/(NOTE-\d+)/, type: 'notes' },
  ];

  for (const { regex, type } of patterns) {
    const match = filePath.match(regex);
    if (match) {
      return { type, id: match[1], path: filePath };
    }
  }

  return null;
}

function extractArtifactId(path: string): string {
  // Extract SPEC-001, PLAN-002, etc. from a path
  const match = path.match(/(SPEC-\d+|PLAN-\d+|TASK-\d+|R-\d+|NOTE-\d+)/);
  return match ? match[1] : path;
}

function updateTaskSpecFrontmatter(
  filePath: string,
  taskId: number,
): void {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return;

    let frontmatter = frontmatterMatch[1];

    // Update or add task_number
    if (frontmatter.includes('task_number:')) {
      frontmatter = frontmatter.replace(
        /task_number:\s*.*/,
        `task_number: ${taskId}`,
      );
    } else {
      frontmatter += `\ntask_number: ${taskId}`;
    }

    const updated = content.replace(
      /^---\n[\s\S]*?\n---/,
      `---\n${frontmatter}\n---`,
    );

    fs.writeFileSync(filePath, updated);
  } catch {
    console.warn(
      `[artifact-bridge] Failed to update task_number in ${filePath}`,
    );
  }
}

function updateFrontmatterStatus(
  content: string,
  status: TaskmasterStatus,
): string {
  // Map Taskmaster statuses to Skylark statuses
  const statusMap: Record<string, string> = {
    pending: 'draft',
    'in-progress': 'in-progress',
    done: 'complete',
    blocked: 'blocked',
    deferred: 'draft',
    cancelled: 'complete',
  };

  const skylarkStatus = statusMap[status] ?? status;
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return content;

  let frontmatter = frontmatterMatch[1];

  if (frontmatter.includes('status:')) {
    frontmatter = frontmatter.replace(
      /status:\s*.*/,
      `status: ${skylarkStatus}`,
    );
  }

  // Append changelog entry
  const timestamp = new Date().toISOString().split('T')[0];
  const changelogEntry = `\n- ${timestamp} [TASK-SUBSTRATE] Status updated to ${status}.`;

  let result = content.replace(
    /^---\n[\s\S]*?\n---/,
    `---\n${frontmatter}\n---`,
  );

  // Append to changelog section if it exists
  if (result.includes('## Changelog')) {
    result = result.replace('## Changelog', `## Changelog${changelogEntry}`);
  }

  return result;
}
