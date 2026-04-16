# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

A curated set of Claude Code plugins for AI-assisted engineering workflows. No application code, no build system, no tests at the repo level — this is a **plugin marketplace** containing prompt-engineering artifacts (skills, shared methodology, agent configurations) organized as installable Claude Code plugins.

## Repository Structure

```
plugins/
├── skylark/      # (active) Autonomous dev pipeline — the primary plugin
├── reflect/      # (active) Date-scoped /insights reimplementation
├── llmstxt/      # (active) llms.txt navigation file generator for content vaults
├── experts/      # (retired) Predecessor to skylark — single-threaded expert flow
└── triad/        # (retired) Three-agent PM/PgM/EM framework over tmux
```

Each plugin follows the Claude Code plugin format:
- `.claude-plugin/plugin.json` — plugin metadata
- `skills/<name>/SKILL.md` — skill definitions with YAML frontmatter
- `skills/_shared/` — shared methodology files read by skills at runtime

The root `.claude-plugin/marketplace.json` registers all active plugins for marketplace installation.

## Plugin Architecture: Skylark

Skylark is the main plugin and the most complex. It encodes a risk-proportional development pipeline where the amount of review scales with the risk of the change.

**Entry point:** `/skylark:implement` — classifies any input (spec, plan, task, idea, bug report, file path) and routes through the pipeline.

**Pipeline stages (in order):** TRIAGE -> PREPARE -> BRAINSTORM -> SPEC-REVIEW -> WRITE-PLAN -> PLAN-REVIEW -> DEVELOP -> FINISH. Most work skips most stages — triage determines which gates are active based on risk level (trivial/standard/elevated/critical).

**Key concepts:**
- **Vocabulary routing** — precise domain terms (15-30 per expert) activate deep knowledge clusters. Every expert prompt is generated using the methodology in `skills/_shared/`.
- **Artifact-based state** — all pipeline state lives in files with YAML frontmatter (`docs/specs/`, `docs/plans/`, `docs/tasks/`, `docs/reports/`, `docs/notes/`) with provenance chains and in-file changelogs. No external system dependency.
- **Risk-proportional gating** — trivial goes straight to DEVELOP->FINISH; critical runs full pipeline with Opus panels at every gate and user confirmation at every step.
- **Crash recovery** — re-running `/skylark:implement` detects state from artifact frontmatter and resumes at the correct stage.

**Shared methodology files** in `skills/_shared/` are critical — they define how expert prompts are generated (`expert-prompt-generator.md`), how vocabulary terms are validated (`vocabulary-guide.md`), the prompt skeleton (`prompt-template.md`), artifact file conventions (`artifact-conventions.md`), and the gate activation matrix (`risk-matrix.md`).

## Version Bumps

Plugin versions are tracked in multiple places — update all of them:
- `plugins/<name>/.claude-plugin/plugin.json` — what Claude Code displays for installed plugins
- `.claude-plugin/marketplace.json` — the marketplace registry entry
- `plugins/<name>/package.json` — if present (not all plugins have one)

## Conventions

- Skills use fully-qualified names with plugin prefix: `/skylark:<skill-name>`, `/reflect:<skill-name>`, `/llmstxt:<skill-name>`
- Designed to run alongside the [Superpowers](https://github.com/obra/superpowers) plugin — use prefixed names to avoid routing collisions
- Skill files are the source of truth for behavior — modify `SKILL.md` to change what a skill does
- Shared methodology in `_shared/` is read by multiple skills; changes there affect all skills that reference it
- Artifact IDs are sequential within type (`SPEC-001`, `PLAN-001`, `TASK-001`), zero-padded to 3 digits
- Retired plugins (`experts`, `triad`) are preserved for reference but not installable via marketplace

## Working on Skills

- Every skill must be self-contained or explicitly reference `_shared/` methodology
- No external dependencies — skills are pure prompt-engineering artifacts
- Test changes against real issues at each risk level (trivial, standard, elevated, critical)
- The `_shared/` directory is load-bearing — many skills read these files at runtime to generate expert prompts

## Plugin Testing

- `llmstxt` has a pytest suite: `cd plugins/llmstxt/skills/update && python -m pytest tests/`
- `reflect` has a Python aggregator script: `python3 plugins/reflect/skills/self-reflection/scripts/aggregate.py --since 24h`
- Skylark skills are tested by running them against real codebases — no automated test harness
