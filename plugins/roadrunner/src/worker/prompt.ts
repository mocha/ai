import type { TaskSpec, ReviewFinding } from '../orchestrator/types.js';

/**
 * Build the initial task dispatch prompt.
 */
export function buildTaskPrompt(task: TaskSpec): string {
  const criteria =
    task.acceptanceCriteria.length > 0
      ? task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : 'No explicit criteria provided';

  const files =
    task.relevantFiles.length > 0
      ? task.relevantFiles.map(f => `- ${f}`).join('\n')
      : 'None specified';

  return `# Task: ${task.title}

## Details
${task.details}

## Acceptance Criteria
${criteria}

## Relevant Files
${files}

## Instructions
- Implement the task as described above
- Run tests to verify your work
- Commit your changes with a descriptive message
- Report your status: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED
- If DONE_WITH_CONCERNS, describe your concerns
- If NEEDS_CONTEXT or BLOCKED, explain what you need`;
}

/**
 * Build the fix/re-dispatch prompt after REVISE verdict.
 * Includes findings as a numbered list with severity/description/file/line.
 */
export function buildFixPrompt(task: TaskSpec, findings: ReviewFinding[], round: number): string {
  const findingsList =
    findings.length > 0
      ? findings
          .map(
            (f, i) =>
              `${i + 1}. [${f.severity}] ${f.description}\n   File: ${f.file}:${f.line}`,
          )
          .join('\n')
      : 'No specific findings recorded.';

  return `# Fix Round ${round}: ${task.title}

The following issues were found during review. Fix each one.

## Findings
${findingsList}

## Instructions
- Address each finding above
- Run tests to verify your fixes
- Commit your changes
- Report your status: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED`;
}

/**
 * Build the review dispatch prompt.
 * Instructs the reviewer agent to evaluate implementation against
 * acceptance criteria and produce a structured verdict.
 */
export function buildReviewPrompt(task: TaskSpec, filesChanged: string[], round: number): string {
  const criteria =
    task.acceptanceCriteria.length > 0
      ? task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : 'No explicit criteria provided';

  const files =
    filesChanged.length > 0
      ? filesChanged.map(f => `- ${f}`).join('\n')
      : 'No files recorded';

  return `# Review: ${task.title} (Round ${round})

## Task Requirements
${task.details}

## Acceptance Criteria
${criteria}

## Files Changed
${files}

## Instructions
Review the implementation against the requirements and acceptance criteria above.

For each issue found, report:
- Severity: blocking | major | minor | suggestion
- Description of the problem
- File path and line number

Conclude with a verdict:
- SHIP: All acceptance criteria met, no blocking or major issues
- REVISE: Issues found that need fixing (list the findings)
- RETHINK: Fundamental approach is wrong, needs architectural change`;
}
