import type { GenerateExpert } from '../../orchestrator/commands.js';

/**
 * Build the metaprompt dispatched to a sub-agent for expert prompt generation.
 *
 * The sub-agent reads the _shared/ methodology files and produces a complete
 * vocabulary-routed expert prompt following the 5-step process.
 */
export function buildExpertMetaprompt(
  command: GenerateExpert,
  mode: 'build' | 'critique',
  methodologyPath: string,
): string {
  const { task, codebase_context } = command;

  const entryPoints = codebase_context.entry_points.length > 0
    ? codebase_context.entry_points.map(f => `- ${f}`).join('\n')
    : '(none provided)';

  const recentChanges = codebase_context.recent_changes.length > 0
    ? codebase_context.recent_changes.map(c => `- ${c}`).join('\n')
    : '(none provided)';

  const relatedTests = codebase_context.related_tests.length > 0
    ? codebase_context.related_tests.map(t => `- ${t}`).join('\n')
    : '(none provided)';

  const acceptanceCriteria = task.acceptanceCriteria.length > 0
    ? task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : '(none provided)';

  const relevantFiles = task.relevantFiles.length > 0
    ? task.relevantFiles.map(f => `- ${f}`).join('\n')
    : '(none provided)';

  const modeSection = mode === 'build'
    ? BUILD_MODE_SECTION
    : CRITIQUE_MODE_SECTION;

  return `# Expert Prompt Generation Task

You are generating a vocabulary-routed expert prompt for a ${mode === 'build' ? 'worker/implementer' : 'reviewer'}.

## Methodology

Read these methodology files carefully before proceeding:

1. \`${methodologyPath}/expert-prompt-generator.md\` — the 5-step process
2. \`${methodologyPath}/vocabulary-guide.md\` — term extraction and validation rules
3. \`${methodologyPath}/prompt-template.md\` — output skeleton and section order

Follow the 5-step process exactly:
1. Analyze the subject matter from the task spec and codebase context below
2. Draft a role identity (<50 tokens, real job title, no superlatives)
3. Extract vocabulary (15-30 terms in 3-5 clusters, practitioner-grade)
4. Derive anti-patterns (5-10 failure modes, one per vocabulary cluster minimum)
5. Assemble the prompt following the 4-part structure (identity → vocabulary → anti-patterns → context)

## Task Spec

**Title:** ${task.title}

**Details:**
${task.details || '(none provided)'}

**Acceptance Criteria:**
${acceptanceCriteria}

**Relevant Files:**
${relevantFiles}

## Codebase Context

**Entry Points:**
${entryPoints}

**Recent Changes:**
${recentChanges}

**Related Tests:**
${relatedTests}

${modeSection}

## Output Format

Output ONLY the generated expert prompt — no preamble, no explanation, no markdown code fences wrapping the output. The output will be written directly to a .md file.

The prompt must follow the 4-part structure in this exact order:
1. **Identity** (primacy effect — highest attention weight)
2. **Vocabulary** (routes knowledge activation before task details)
3. **Anti-patterns** (steers away from failure modes before generation)
4. **Context-specific sections** (recency effect for task details)

Do NOT rearrange this order. It is load-bearing.`;
}

const BUILD_MODE_SECTION = `## Mode: Build (Worker/Implementer)

Generate context sections for an implementer:
- **Operational Guidance** — error philosophy, concurrency model, edge case handling
- **Testing Expectations** — language-idiomatic patterns, edge case fixtures, performance verification
- **Deliverables** — concrete files to create or modify, validated against anti-patterns

Include status reporting instructions at the end:
> Report your status: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED`;

const CRITIQUE_MODE_SECTION = `## Mode: Critique (Reviewer)

Generate context sections for a reviewer:
- **Review Focus** — specific aspects to evaluate (requirements coverage, code quality, etc.)
- **Output Format** — structured output with Strengths / Issues / Missing / Verdict sections

Include the mandatory review directive:
> "You must identify at least one substantive issue or explicitly justify clearance with specific evidence."

Include the "do not trust" directive for spec compliance reviews:
> "Do not trust the implementer's report. Verify everything independently by reading the actual code."`;
