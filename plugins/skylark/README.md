# skylark

A Claude Code plugin encoding the _Skylark_ development pipeline. Designed for our [Linear](https://linear.app)-based workflow, but easy to remix to fit your own.

## What it does

`skylark` provides a unified workflow that routes any development input — an issue, spec, plan, bug report, or raw idea — through the appropriate pipeline stages with risk-proportional gating at each step. Small fixes flow through fast. Load-bearing changes get detailed reviews at multiple gates to ensure high-quality output.

```
/skylark:implement ENG-142
  → triage (classify, assess risk, detect state)
  → prepare (enrich with Linear context, vocabulary, references)
  → spec-review (panel review, max 2 rounds)
  → write-plan (no-placeholder implementation plan)
  → plan-review (decompose into tasks, review each)
  → develop (per-task vocabulary-routed expert in isolated worktree)
  → finish (verify, branch options, Linear ceremony, session notes, cleanup)
```

The pipeline adapts based on the work itself. A trivial bugfix goes straight to `develop` and `finish`. A standard issue gets `prepare`, `develop`, and `finish`. Only elevated and critical work runs the full pipeline.

## Skills

### User-invocable

| Skill | Purpose |
|-------|---------|
| `/skylark:implement` | Single entry point — classifies input, routes through pipeline |
| `/skylark:brainstorm` | Socratic design conversation, produces spec |
| `/skylark:finish` | Close out a branch — verify, merge/PR/keep/discard, cleanup |
| `/skylark:panel-review` | Multi-expert parallel review of any document |
| `/skylark:solo-review` | Single expert review of any document |

### Internal (called by the pipeline)

| Skill | Purpose |
|-------|---------|
| `triage` | Classify input type, detect state, assess risk, route |
| `prepare` | Enrich with Linear context, vocabulary payload, references |
| `spec-review` | Iterative panel review of spec (max 2 rounds) |
| `write-plan` | Generate implementation plan from approved spec |
| `plan-review` | Decompose plan into tasks, panel-review each |
| `develop` | Per-task expert developer in isolated worktree |
| `linear` | Linear interaction conventions |

### Shared methodology

| File | Purpose |
|------|---------|
| `_shared/expert-prompt-generator.md` | 5-step process for creating vocabulary-routed experts |
| `_shared/vocabulary-guide.md` | Domain term extraction, clustering, validation |
| `_shared/prompt-template.md` | Output skeleton for expert prompts |
| `_shared/artifact-conventions.md` | File naming, locations, frontmatter, provenance chains |
| `_shared/risk-matrix.md` | Risk levels and gate activation table |

## Key techniques

**Vocabulary routing** — precise domain terms (15-30 per expert) activate deep knowledge clusters in the model. "FTS5 virtual table, bm25() ranking, column weight boosting" produces fundamentally different output than "full-text search optimization." Every expert (reviewer and developer) gets vocabulary routing scoped to their specific task and domain.

**Risk-proportional gating** — trivial fixes skip expensive review. Standard work gets a Sonnet panel. Elevated work gets Opus panels at spec and plan gates. Critical work gets 5-expert Opus panels that narrow to 2-3 on re-review. Token cost scales with actual risk.

**Two-stage implementation review** — after implementation, a spec compliance reviewer verifies the work matches the spec (deliberately distrustful: "do not trust the implementer's report"), then a vocabulary-routed panel reviews code quality. Three layers of validation catching different failure modes.

**Artifact-based state** — all pipeline state lives in files with YAML frontmatter and provenance chains, not in agent memory. A session can crash and resume by detecting state from artifacts. Every pipeline event also gets a Linear comment for discoverability.

## Installation

For installation, see the [marketplace README](../../README.md).

Designed to run alongside [Superpowers](https://github.com/obra/superpowers). Superpowers provides discipline and technique skills (TDD, systematic debugging, verification-before-completion, git worktrees) that complement this plugin's workflow pipeline. Where skill names overlap, use the fully-qualified `/skylark:` prefix.

## Acknowledgments

This plugin is a remix of techniques and approaches from two excellent open-source projects:

### [Superpowers](https://github.com/obra/superpowers) by [@obra](https://github.com/obra)

Superpowers provides a complete software development workflow for coding agents — brainstorming, plan writing, subagent-driven development, code review, and branch management. Several skills in `skylark-ai` are directly adapted from Superpowers under its MIT license:

- **`brainstorm`** adapts the Superpowers `brainstorming` skill — the Socratic one-question-at-a-time design flow, the hard gate preventing premature implementation, the "too simple to need a design" anti-pattern callout, the scope assessment before deep questions, and the spec self-review checklist.
- **`write-plan`** adapts the Superpowers `writing-plans` skill — the zero-context implementer framing, the no-placeholders rule, bite-sized task granularity (2-5 minute steps), the self-review checklist (spec coverage, placeholder scan, type consistency), and the plan document structure.
- **`develop`** incorporates the Superpowers `subagent-driven-development` skill — the structured implementer prompt with question-asking and escalation guidance, the four return statuses (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED), the deliberately distrustful spec compliance reviewer, and model selection by task complexity.
- **`finish`** adapts the Superpowers `finishing-a-development-branch` skill — the test-first gate, the four structured branch options (merge/PR/keep/discard), typed confirmation for destructive operations, and worktree cleanup logic.

### [Forge](https://github.com/jdforsythe/forge) by [@jdforsythe](https://github.com/jdforsythe)

Forge provides the science-backed methodology for AI agent assembly that underpins all expert generation in this plugin. The vocabulary routing technique — the single highest-leverage intervention in our toolchain — comes from Forge's research synthesis:

- **Vocabulary routing** — precise domain terms activate deep knowledge clusters, producing expert-quality output that generic prompts miss. Forge's "15-year practitioner test" (would a senior with 15+ years use this term with a peer?) is how we validate every term in every expert prompt.
- **Real-world role principle** — brief realistic job titles (<50 tokens) outperform elaborate personas. No flattery, no superlatives, one role per prompt.
- **Anti-pattern principle** — every expert includes 5-10 named failure modes with detection signals and resolution steps, derived from the MAST framework.
- **Progressive disclosure** — identity first (primacy effect), vocabulary second (knowledge activation), anti-patterns third (failure mode steering), task details last (recency effect).

The shared methodology files in `_shared/` (expert-prompt-generator, vocabulary-guide, prompt-template) are adapted from Forge's methodology under its MIT license.

### What skylark-ai adds

Beyond remixing these foundations, `skylark-ai` contributes:

- **Risk-proportional gating** — a triage stage that classifies input and activates only the pipeline stages warranted by the work's risk level
- **Linear integration** — issue lifecycle, blocking relations, and event comments as an audit trail throughout the pipeline
- **Artifact-based state recovery** — YAML frontmatter provenance chains that make pipeline state reconstructable from files alone
- **Adaptive panel narrowing** — 5-expert first rounds that narrow to 2-3 strongest voices on re-review, balancing thoroughness against token cost
- **Model calibration by risk** — Sonnet for standard implementation review, Opus for elevated+ spec/plan review, cheapest-viable-model for implementer dispatch

## License

MIT. See [LICENSE](LICENSE).

Incorporates material from [Superpowers](https://github.com/obra/superpowers) (MIT) and [Forge](https://github.com/jdforsythe/forge) (MIT).
