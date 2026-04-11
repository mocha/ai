# ai-experts

A Claude Code plugin that generates domain-specific expert reviewers on-the-fly using vocabulary routing. Instead of picking from pre-built expert profiles, each expert is custom-built from the document being reviewed — precise terminology activates deep knowledge clusters in the model, producing reviews that catch issues generic reviewers miss.

Builds on practices from the [jdforsythe/forge](https://github.com/jdforsythe/forge) methodology.

## Skills

| Skill | What it does |
|---|---|
| `/ai-experts:review-expert` | Generate a single bespoke expert and dispatch it to review a document |
| `/ai-experts:review-panel` | Generate 2-5 experts with different specializations and dispatch in parallel |
| `/ai-experts:execution-expert` | Full pipeline: review spec, plan, panel-validate, execute in worktree, PR |

## How It Works

### Vocabulary Routing

Large language models organize knowledge in clusters. The term "BM25 (Robertson & Zaragoza) — term frequency saturation, inverse document frequency" activates a deep information retrieval cluster. The phrase "full-text search" activates a broad, shallow one.

This plugin reads whatever document you point it at, extracts precise domain terminology, upgrades it to practitioner-grade language with originator attribution, and organizes it into 3-5 clusters. These clusters become the expert's operating context — routing the model into the right knowledge region before it begins reviewing.

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

The vocabulary routing alone (no model upgrade) tripled the issue count. The panel caught 18 findings that no single-expert run found — domain-specific issues like FTS5 column tokenization behavior, Obsidian alias resolution gaps, and cross-query score incomparability.

## Install

```bash
# Add the marketplace, then install the plugin
/plugin marketplace add https://github.com/mocha/ai-experts
/plugin install ai-experts@mocha-ai-experts

# Or for local development / testing
claude --plugin-dir /path/to/ai-experts
```

## Usage

```bash
# Single expert review
/ai-experts:review-expert path/to/SPEC.md

# Multi-perspective panel review
/ai-experts:review-panel path/to/SPEC.md

# Full development pipeline from spec
/ai-experts:execution-expert path/to/SPEC.md
```

## How the Methodology Works

The expert generation process follows six principles from the [Forge Methodology](https://github.com/jdforsythe/forge/blob/main/METHODOLOGY.md):

1. **Vocabulary Routing** — precise terms activate domain knowledge clusters; generic language activates shallow ones
2. **Real-World Roles** — brief identities (<50 tokens) with real job titles outperform elaborate personas
3. **Anti-Pattern Watchlists** — named failure modes steer output away from the distribution center (generic output)
4. **Progressive Disclosure** — identity first (primacy), vocabulary second (routing), anti-patterns third (steering)
5. **Structured Artifacts** — experts produce typed deliverables (Strengths/Issues/Missing/Verdict), not free-form prose
6. **Scaling Laws** — single expert for most tasks; panel only when the document genuinely spans multiple domains

## Project Structure

```
ai-experts/
├── .claude-plugin/
│   └── plugin.json           # Plugin manifest
├── skills/
│   ├── _shared/       # Internal methodology (not a skill)
│   │   ├── expert-prompt-generator.md
│   │   ├── vocabulary-guide.md
│   │   └── prompt-template.md
│   ├── review-expert/
│   │   └── SKILL.md
│   ├── review-panel/
│   │   └── SKILL.md
│   └── execution-expert/
│       ├── SKILL.md
│       └── references/
│           └── flow-development.md
├── LICENSE
└── README.md
```

## License

MIT
