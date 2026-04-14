# Expert Prompt Generator

Internal methodology for creating vocabulary-routed expert prompts. Read this before generating any expert (reviewer or developer).

## Why Vocabulary Routing Works

LLMs organize knowledge in clusters within embedding space. Precise domain terms activate specific deep clusters. Generic language activates broad shallow clusters. A prompt containing "FTS5 virtual table, bm25() ranking, column weight boosting" activates fundamentally different knowledge than "full-text search optimization."

## 5-Step Process

### Step 1: Analyze Subject Matter

Before writing anything, identify:
- **Domain(s):** What technical areas does this touch?
- **Technology stack:** What specific tools, frameworks, libraries?
- **Key abstractions:** What are the core concepts the expert needs to reason about?
- **Edge cases:** What's likely to go wrong or be overlooked?
- **Goals:** What does success look like for this expert's work?

### Step 2: Draft Role Identity

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

### Step 3: Extract Vocabulary

Follow the process in `vocabulary-guide.md`:
- 3-5 clusters, 15-30 terms total
- Practitioner-tested, attributed where known
- Each cluster should mirror expert discourse patterns (not document sections)

### Step 4: Derive Anti-Patterns

Identify 5-10 failure modes specific to the domain and task:
- Each vocabulary cluster needs at least 1 failure mode
- Include at least 1 testing/verification failure mode
- Format each as: **name** | detection signal | resolution

**Prioritize domain-specific risks** over generic advice. "Unbounded N+1 in Drizzle relation queries" beats "optimize database queries."

### Step 5: Assemble Prompt

Use the structure from `prompt-template.md`. Order matters (progressive disclosure):

1. **Identity** (primacy effect — highest attention weight)
2. **Vocabulary** (routes knowledge activation before task details arrive)
3. **Anti-patterns** (steers away from failure modes before generation begins)
4. **Context-specific sections** (added by calling skill — review focus, operational guidance, etc.)

The calling skill adds context-specific sections after the core three. See `prompt-template.md` for the full structure.
