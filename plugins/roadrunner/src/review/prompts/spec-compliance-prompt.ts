import type { RunReview } from '../../orchestrator/commands.js';

/**
 * Build the dispatch prompt for a spec compliance solo reviewer.
 *
 * This reviewer checks whether the implementation matches the task requirements.
 * It does NOT evaluate code quality — that's the panel review's job.
 */
export function buildSpecCompliancePrompt(command: RunReview): string {
  const { task_spec, worker_result, worktree_path } = command;

  const acceptanceCriteria = task_spec.acceptanceCriteria.length > 0
    ? task_spec.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : '(no explicit criteria provided)';

  const filesChanged = worker_result.files_changed.length > 0
    ? worker_result.files_changed.map(f => `- ${f}`).join('\n')
    : '(no files changed)';

  const concerns = worker_result.concerns
    ? `\n\n**Worker's Concerns:**\n${worker_result.concerns}`
    : '';

  return `# Spec Compliance Review

You are a **spec compliance reviewer**. Your sole focus is requirements coverage.
You do NOT evaluate code quality, style, architecture, or performance.

## Critical Directive

**Do not trust the implementer's report.** The report may be incomplete,
inaccurate, or optimistic. You MUST verify everything independently.
Read the actual code. Compare actual implementation to requirements
line by line. Check for missing pieces they claimed to implement.
Look for extra features they did not mention.

## Task Requirements

**Title:** ${task_spec.title}

**Details:**
${task_spec.details || '(none provided)'}

**Acceptance Criteria:**
${acceptanceCriteria}

**Relevant Files:**
${task_spec.relevantFiles.map(f => `- ${f}`).join('\n') || '(none specified)'}

## Implementer's Report

**Status:** ${worker_result.status}
**Files Changed:**
${filesChanged}${concerns}

## Worktree

The implementation is at: \`${worktree_path}\`
Read the actual code files to verify the implementation.

## Your Task

1. Read every file the implementer changed
2. Compare the actual implementation against each acceptance criterion
3. Check for missing requirements, extra/unneeded work, and misunderstandings
4. Report your findings in the structured format below

## Output Format

## Strengths
- What was done well or correctly

## Issues
- [severity] Description of the issue | file.ts:line
  (severity: blocking, major, minor, suggestion)

## Missing
- [severity] Description of missing requirement | expected_file.ts

## Verdict
SHIP — if all acceptance criteria are met
REVISE — if there are blocking or major issues
RETHINK — if the implementation fundamentally misunderstands the requirements

You MUST identify at least one substantive issue or explicitly justify clearance with specific evidence.`;
}
