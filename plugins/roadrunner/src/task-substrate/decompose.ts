/**
 * DECOMPOSE command handler.
 *
 * Takes a spec path and risk level, feeds it through Taskmaster's
 * decomposition pipeline (parse -> analyze -> expand -> validate),
 * and returns a DECOMPOSITION_COMPLETE event.
 */

import type { TaskmasterClient } from './mcp-client.js';
import type { TaskPayload } from './types.js';
import { SIZING_CONSTANTS, DEFAULT_DOMAIN_KEYWORDS, VERTICAL_SLICE_PROMPT } from './types.js';
import type { RiskLevel } from '../orchestrator/types.js';
import type { DecompositionComplete } from '../orchestrator/events.js';

// ---------------------------------------------------------------------------
// Domain cluster extraction
// ---------------------------------------------------------------------------

function extractDomainClusters(tasks: TaskPayload[]): string[] {
  const domains = new Set<string>();

  for (const task of tasks) {
    const searchText = [
      task.title,
      task.description,
      task.details,
      ...task.relevantFiles.map((f) => `${f.path} ${f.description}`),
    ]
      .join(' ')
      .toLowerCase();

    for (const keyword of DEFAULT_DOMAIN_KEYWORDS) {
      if (searchText.includes(keyword)) {
        domains.add(keyword);
      }
    }
  }

  return [...domains].sort();
}

// ---------------------------------------------------------------------------
// Decompose
// ---------------------------------------------------------------------------

export interface DecomposeOptions {
  specPath: string;
  risk: RiskLevel;
}

/**
 * Handler for the DECOMPOSE command from the orchestrator.
 *
 * 1. Parse PRD into initial task set
 * 2. Run complexity analysis
 * 3. Expand tasks above the complexity threshold (respecting the floor)
 * 4. Validate the DAG
 * 5. Return DECOMPOSITION_COMPLETE event
 */
export async function decompose(
  client: TaskmasterClient,
  opts: DecomposeOptions,
): Promise<DecompositionComplete> {
  const { specPath, risk } = opts;

  // Step 1: Parse PRD into tasks
  await client.parsePrd(specPath);

  // Step 2: Run complexity analysis
  let complexityReport;
  try {
    complexityReport = await client.analyzeComplexity();
  } catch {
    // Complexity analysis is optional — proceed without it
    complexityReport = null;
  }

  // Step 3: Expand complex tasks
  const subtaskCount = risk === 'critical' ? 8 : 5;
  const tasks = await client.getTasks();

  for (const task of tasks) {
    const complexity = complexityReport?.tasks.find((c) => c.taskId === task.id);
    const score = complexity?.complexityScore ?? task.complexity ?? 0;

    // Floor: don't decompose tasks that are already atomic
    if (score <= SIZING_CONSTANTS.COMPLEXITY_FLOOR) {
      continue;
    }

    // Threshold: decompose tasks above the threshold
    if (score > SIZING_CONSTANTS.COMPLEXITY_DECOMPOSE_THRESHOLD) {
      const prompt = [
        complexity?.expansionPrompt ?? '',
        VERTICAL_SLICE_PROMPT,
      ].filter(Boolean).join('\n\n');

      try {
        await client.expandTask(task.id, {
          numSubtasks: subtaskCount,
          prompt: prompt || undefined,
        });
      } catch (err) {
        // If expansion fails for a single task, log and continue
        console.warn(
          `[task-substrate] Failed to expand task ${task.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // Step 4: Validate dependencies
  const validation = await client.validateDependencies();

  if (!validation.valid) {
    // Attempt auto-fix by re-validating (Taskmaster's validate_dependencies
    // can fix some issues). If still invalid, throw.
    console.warn(
      `[task-substrate] DAG validation found ${validation.issues.length} issues, attempting re-validation`,
    );

    const recheck = await client.validateDependencies();
    if (!recheck.valid) {
      const details = recheck.issues
        .map((i) => `${i.type} on task ${i.taskId}: ${i.details}`)
        .join('; ');
      throw new Error(`DAG validation failed after fix attempt: ${details}`);
    }
  }

  // Step 5: Build DECOMPOSITION_COMPLETE event
  const finalTasks = await client.getTasks();
  const taskIds = finalTasks.map((t) => t.id);
  const domains = extractDomainClusters(finalTasks);

  return {
    type: 'DECOMPOSITION_COMPLETE',
    task_count: finalTasks.length,
    task_ids: taskIds,
    domains,
  };
}
