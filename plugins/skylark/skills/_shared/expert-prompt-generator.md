# Expert Prompt Generator

Internal methodology for creating vocabulary-routed expert prompts. Read this before generating any expert (reviewer or developer).

## Why Vocabulary Routing Works

LLMs organize knowledge in clusters within embedding space. Precise domain terms activate specific deep clusters. Generic language activates broad shallow clusters. A prompt containing "FTS5 virtual table, bm25() ranking, column weight boosting" activates fundamentally different knowledge than "full-text search optimization."

## 6-Step Process

### Step 1: Analyze Subject Matter

Before writing anything, identify:
- **Domain(s):** What technical areas does this touch?
- **Technology stack:** What specific tools, frameworks, libraries?
- **Key abstractions:** What are the core concepts the expert needs to reason about?
- **Edge cases:** What's likely to go wrong or be overlooked?
- **Goals:** What does success look like for this expert's work?

### Step 2: Check Roster

Before generating from scratch, check `expert-roster.json` for a matching role:

1. Identify what expert perspective is needed from the Step 1 analysis
2. Search the roster by tags for the best match:
   - **First:** check for a tech-specific variant (e.g., `database-engineer-postgres`) — these are project-added specializations
   - **Then:** check for a `general-` variant (e.g., `general-database-engineer`)
3. **If match found — load and adapt:**
   - Use the roster entry's identity, vocabulary, and anti-patterns as a starting point
   - **Specialize the vocabulary** to the project context: add project-specific terms, upgrade generic terms to match the actual tech stack (e.g., `general-database-engineer` vocabulary gets Postgres-specific terms added when reviewing a Postgres project)
   - **Add project-specific anti-patterns** if the subject matter reveals domain risks not in the roster entry
   - Proceed to Step 5 (Assemble Prompt) — skip Steps 3-4 since the roster provides the base material
4. **If no match found:** proceed to Step 3 (Draft Role Identity) and generate from scratch

The roster is a starting point, not a ceiling. Always adapt to the specific project context.

### Step 3: Draft Role Identity

Write a brief identity statement (<50 tokens) that:
- Uses a **real-world job title** that exists in real organizations
- States the **primary responsibility** and domain scope
- Sets an **authority boundary** (e.g., "implements per spec; escalates architectural deviations")

**Rules:**
- No flattery or superlatives — PRISM research shows superlatives degrade accuracy
- One role per prompt — combined titles fragment knowledge activation
- Real titles only — "Senior Database Engineer" not "Database Wizard"

**Good examples:**
- "You are a senior SQLite engineer implementing a FTS5 indexing pipeline. You write defensive SQL and test edge cases around tokenization."
- "You are a staff platform engineer reviewing a service mesh configuration. You focus on failure modes and cascading timeout risks."

**Bad examples:**
- "You are an expert world-class full-stack developer..." (superlative + combined role)
- "You are the best engineer on the team..." (flattery)

### Step 4: Extract Vocabulary

Follow the process in `vocabulary-guide.md`:
- 3-5 clusters, 15-30 terms total
- Practitioner-tested, attributed where known
- Each cluster should mirror expert discourse patterns (not document sections)
- See `expert-exemplars.md` for complete examples of finished vocabulary payloads across different domains

### Step 5: Derive Anti-Patterns

Identify 5-10 failure modes specific to the domain and task:
- Each vocabulary cluster needs at least 1 failure mode
- Include at least 1 testing/verification failure mode
- Format each as: **name** | detection signal | resolution

**Prioritize domain-specific risks** over generic advice. "Unbounded N+1 in Drizzle relation queries" beats "optimize database queries."

### Step 6: Assemble Prompt

This is the entry point for both roster-adapted experts (from Step 2) and freshly generated experts (from Steps 3-5).

Use the structure from `prompt-template.md`. Order matters (progressive disclosure):

1. **Identity** (primacy effect — highest attention weight)
2. **Vocabulary** (routes knowledge activation before task details arrive)
3. **Anti-patterns** (steers away from failure modes before generation begins)
4. **Resources** (docs/ access and solo-review availability — always present)
5. **Context-specific sections** (added by calling skill — review focus, operational guidance, etc.)

The calling skill adds context-specific sections after the Resources block. See `prompt-template.md` for the full structure.

**Resources block (always include):** Every generated expert prompt must include the Resources section from `prompt-template.md`. This gives the expert access to `docs/` (strategy notes, architecture decisions, prior art) and the ability to invoke `/skylark:solo-review` for a second opinion. Experts should never feel stuck — they can always read more context or ask for help.
