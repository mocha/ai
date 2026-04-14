# experts

Generate domain-specific expert reviewers on-the-fly using vocabulary routing.
Instead of picking from pre-built expert profiles, each expert is custom-built
from the document being reviewed — precise terminology activates deep knowledge
clusters in the model, producing reviews that catch issues generic reviewers
miss.

Builds on practices from the
[jdforsythe/forge](https://github.com/jdforsythe/forge) methodology.

## Skills

### Building Blocks

| Skill | What it does |
|---|---|
| `/expert:solo-review` | Generate a single bespoke expert and dispatch it to review a document |
| `/expert:panel-review` | Generate 2-5 experts with different specializations and dispatch in parallel |

### Flows

| Skill | What it does |
|---|---|
| `/expert:spec-review` | Iterative spec review — panel review, fix, re-review (max 2 rounds) |
| `/expert:plan-review` | Decompose a plan into tasks, panel-review each task spec individually |
| `/expert:develop` | Single task execution — fresh expert, worktree, build, validate |
| `/expert:implement` | Full pipeline — orchestrates spec-review, planning, plan-review, and per-task development |

## How It Works

### Vocabulary Routing

Large language models organize knowledge in clusters. The term "BM25 (Robertson
& Zaragoza) — term frequency saturation, inverse document frequency" activates
a deep information retrieval cluster. The phrase "full-text search" activates a
broad, shallow one.

This plugin reads whatever document you point it at, extracts precise domain
terminology, upgrades it to practitioner-grade language with originator
attribution, and organizes it into 3-5 clusters. These clusters become the
expert's operating context — routing the model into the right knowledge region
before it begins reviewing.

### The Expert Generation Pipeline

1. **Analyze** the document — identify domain, technology stack, key abstractions, edge cases
2. **Draft identity** — real job title, <50 tokens, no flattery (PRISM research: superlatives degrade accuracy)
3. **Extract vocabulary** — 15-30 terms, practitioner-tested, attributed, clustered by expert discourse patterns
4. **Derive anti-patterns** — 5-10 domain-specific failure modes with detection signals and resolutions
5. **Dispatch** — the generated prompt becomes the subagent's primary context

### Benchmark Results

Tested against the same spec document with identical review instructions:

| Approach | Tokens | Time | Issues Found |
|---|---|---|---|
| Generic prompt (Sonnet) | ~5K | 43s | 2 |
| Vocabulary-routed (Sonnet) | 28K | 89s | 15 |
| Vocabulary-routed (Opus) | 31K | 128s | 22 |
| Panel, 4 experts (Opus) | 137K | 163s | 43 |

The vocabulary routing alone (no model upgrade) tripled the issue count. The
panel caught 18 findings that no single-expert run found — domain-specific
issues like FTS5 column tokenization behavior, Obsidian alias resolution gaps,
and cross-query score incomparability.

## Usage

```bash
# Single expert review
/expert:solo-review path/to/document.md

# Multi-perspective panel review
/expert:panel-review path/to/document.md

# Harden a spec through iterative review
/expert:spec-review path/to/SPEC.md

# Decompose a plan and review each task
/expert:plan-review path/to/PLAN.md

# Develop a single task with a fresh expert
/expert:develop path/to/TASK.md

# Full pipeline from spec to PR
/expert:implement path/to/SPEC.md
```

For installation, see the [marketplace README](../../README.md).

## How the Methodology Works

The expert generation process follows six principles from the
[Forge Methodology](https://github.com/jdforsythe/forge/blob/main/METHODOLOGY.md):

1. **Vocabulary Routing** — precise terms activate domain knowledge clusters; generic language activates shallow ones
2. **Real-World Roles** — brief identities (<50 tokens) with real job titles outperform elaborate personas
3. **Anti-Pattern Watchlists** — named failure modes steer output away from the distribution center (generic output)
4. **Progressive Disclosure** — identity first (primacy), vocabulary second (routing), anti-patterns third (steering)
5. **Structured Artifacts** — experts produce typed deliverables (Strengths/Issues/Missing/Verdict), not free-form prose
6. **Scaling Laws** — single expert for most tasks; panel only when the document genuinely spans multiple domains

## Plugin Structure

```
experts/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
└── skills/
    ├── _shared/                 # Internal methodology (not a skill)
    │   ├── expert-prompt-generator.md
    │   ├── vocabulary-guide.md
    │   └── prompt-template.md
    ├── solo-review/             # Building block: single expert review
    │   └── SKILL.md
    ├── panel-review/            # Building block: multi-expert panel
    │   └── SKILL.md
    ├── spec-review/             # Flow: iterative spec approval
    │   └── SKILL.md
    ├── plan-review/             # Flow: plan decomposition + task review
    │   └── SKILL.md
    ├── develop/                 # Flow: per-task expert development
    │   └── SKILL.md
    └── implement/               # Orchestrator: full pipeline
        └── SKILL.md
```

## License

MIT
