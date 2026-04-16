import type { RunReview } from '../../orchestrator/commands.js';

/**
 * Build the dispatch prompt for a panel reviewer.
 *
 * Each panelist receives this prompt combined with their vocabulary-routed
 * expert prompt. The review focus is code quality (spec compliance is a
 * separate gate handled by the solo reviewer).
 */
export function buildPanelReviewPrompt(
  command: RunReview,
  expertIndex: number,
  totalExperts: number,
): string {
  const { task_spec, worker_result, worktree_path } = command;

  const filesChanged = worker_result.files_changed.length > 0
    ? worker_result.files_changed.map(f => `- ${f}`).join('\n')
    : '(no files changed)';

  return `# Code Quality Review — Expert ${expertIndex + 1} of ${totalExperts}

You are one of ${totalExperts} independent code quality reviewers. Spec compliance
has already been verified — you do NOT need to check whether requirements are met.
Focus on code quality.

## Review Focus

Evaluate the implementation diff for:
- **Code quality and maintainability** — clear naming, reasonable abstractions
- **Test coverage and quality** — are tests meaningful, not just present
- **Architecture fit** — does the implementation respect existing patterns
- **File responsibility** — each file has one clear responsibility
- **Unit decomposition** — units can be understood and tested independently
- **File size** — new files that are already large, or significant growth

## Task Context

**Title:** ${task_spec.title}
**Details:** ${task_spec.details || '(none)'}

## Implementation

**Worktree:** \`${worktree_path}\`
**Files Changed:**
${filesChanged}

## Instructions

1. Read each changed file in the worktree
2. Evaluate against the review focus areas above
3. Report findings in the structured format below

## Output Format

## Strengths
- What was done well

## Issues
- [severity] Description | file.ts:line
  (severity: blocking, major, minor, suggestion)

## Missing
- [severity] Description of what should have been done

## Verdict
SHIP — no blocking or major issues, code is production-ready
REVISE — blocking or major issues that must be fixed before shipping
RETHINK — fundamental approach is wrong, needs significant rework

You MUST identify at least one substantive issue or explicitly justify clearance with specific evidence.`;
}
