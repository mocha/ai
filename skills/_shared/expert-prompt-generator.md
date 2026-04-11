# Expert Prompt Generator

Internal methodology for generating vocabulary-routed expert prompts. Not user-facing.

## Input

A document to analyze — spec, proposal, codebase, plan, or other artifact that defines the domain.

## Steps

### 1. Analyze the Subject Matter

Read the input document. Identify:
- **Domain(s):** What field(s) does this live in? (e.g., distributed systems, information retrieval, frontend engineering)
- **Technology stack:** Specific tools, languages, frameworks, and services mentioned or implied
- **Key abstractions:** Core concepts the document revolves around
- **Edge cases:** Ambiguities, unstated assumptions, gaps
- **Goals:** What success looks like

### 2. Draft Role Identity

Write a role identity statement:
- Real-world job title that exists in real organizations
- Primary responsibility and domain scope
- Authority boundary: "implements per spec; escalates architectural deviations" (or equivalent for reviews: "evaluates against stated requirements; flags unstated assumptions")
- **Under 50 tokens.** Longer identities degrade accuracy (PRISM research).
- **No flattery or superlatives.** "World's best" activates marketing clusters, not expertise.
- **One role per prompt.** Combined titles fragment knowledge activation.

### 3. Extract Vocabulary

Follow the detailed process in `vocabulary-guide.md`. Summary:
- Scan the document for precise technical terms
- Upgrade each to practitioner-grade language with context
- Add originator attribution where known (e.g., "PageRank (Page & Brin, 1998)")
- Organize into 3-5 clusters of terms that co-occur in expert discourse
- Target 15-30 terms total
- Apply the 15-year practitioner test: would a senior with 15+ years use this exact term with a peer?
- Cut anything that fails. Cut all consultant-speak.

### 4. Derive Anti-Patterns

Identify 5-10 failure modes specific to this domain and task:
- For each vocabulary cluster, ensure at least one failure mode
- Each anti-pattern needs: **name**, **detection signal**, **resolution**
- Prioritize domain-specific risks over generic ones
- Include at least one testing/verification failure mode

### 5. Assemble the Prompt

Use the structure in `prompt-template.md`. Order matters (progressive disclosure):
1. Identity (highest attention — primacy effect)
2. Vocabulary clusters (routes knowledge activation before task details)
3. Anti-patterns (steers away from failure modes)

The calling skill adds context-specific sections after the core three:
- **Development context** adds: Operational Guidance, Testing Expectations, Deliverables
- **Review context** adds: Review Focus, Output Format
