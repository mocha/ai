# Agent Triad: Transfer & Experimentation Project

## What This Is

This directory contains three extracted agent configurations — a **product manager**, an **engineering manager**, and a **program manager** — pulled from active projects where they were developed organically. The goal is to make them portable so they can be dropped into new projects, tested, and iteratively improved.

## Background

Patrick Deuley has been building out an agentic development practice across several projects in the `mocha` GitHub organization. Over time, three distinct agent roles emerged:

1. **Product Manager** (extracted from `dogproj`) — An Obsidian-based knowledge vault for a pet care SaaS startup. The PM agent operates within this vault doing competitive intelligence, market research, PRD development, and business analysis. It has 9 skills ranging from structured PRD authoring to web scraping to database-style views over vault content.

2. **Engineering Manager** (extracted from `dogproj-app`) — The codebase for that same SaaS product. The EM agent orchestrates development through a structured task system: milestones contain projects, projects decompose into tasks, tasks are assigned to worker agents in isolated git worktrees. Work is organized into waves/phases with parallel workers. The EM has skills for task lifecycle management, decision document creation, and a post-completion review checklist. Worker agents receive standardized briefings and operate under TDD-first rules.

3. **Program Manager** (extracted from `tron`, deployed as "Deuleytron") — An autonomous supervisory agent that monitors projects, resolves what it can with high confidence, and escalates conservatively. It operates through a layered decision framework: seven core principles, eleven worked example scenarios (the "playbook"), and six explicit anti-patterns to avoid. It maintains per-project context files that define authority boundaries and escalation contacts.

These three agents were built to work together. The coordination model is documented in `2026-03-22-three-agent-system-design.md` at this directory's root. In short: the engineering manager creates decision documents when blocked, pushes them to git, and the program manager discovers and resolves them asynchronously. A separate chat assistant (Domo/NanoClaw, not included here) handles human-facing communication.

## Why They Were Extracted

All three agents are currently deeply embedded in their source projects. The CLAUDE.md files reference project-specific details (dogproj's Obsidian vault structure, dogproj-app's Supabase/Drizzle/Fastify stack, Deuleytron's authority over specific repositories). The skills assume specific directory layouts and tooling.

Patrick wants to experiment with applying this agent triad to different projects entirely — ones with different tech stacks, different domain contexts, different team structures. To do that, the agents need to be studied in isolation, understood for what's truly portable vs. what's project-specific, and then generalized.

## What's In Each Directory

### `product-manager/`
| File | Purpose |
|------|---------|
| `CLAUDE.md` | Full agent identity and operating instructions (dogproj-specific) |
| `CONTRIBUTING.md` | Vault structural conventions and content guidelines |
| `.claude/settings.json` | Base permission rules |
| `.claude/settings.local.json` | Extended local permissions (web scraping, CLI tools) |
| `.claude/skills/` | 9 skills: prd-architect, obsidian-bases, obsidian-cli, obsidian-markdown, map-directories, defuddle, export-html, pdf-to-md, parallel-agents |

### `engineering-manager/`
| File | Purpose |
|------|---------|
| `CLAUDE.md` | Full agent identity — task execution workflow, documentation system, scope rules, engineering conventions |
| `.claude/skills/` | 4 skills: create-task, assign-task, update-task, create-decision |
| `.claude/rules/` | 3 enforcement rules: database conventions, testing (TDD-first), post-task completion checklist |
| `.claude/worker-context.md` | Standardized briefing given to every worker agent — TDD cycle, commit rules, report format |
| `.claude/worker-dispatch-template.md` | Template with variables for launching worker agents into worktrees |
| `.claude/settings.local.json` | Permissions for Supabase SQL, Context7 docs |
| `.agents/skills/` | Shared supabase-postgres best practices skill (40+ reference files) |
| `docs/tasks/CLAUDE.md` | Task execution conventions — lifecycle, scope discipline, completion format |
| `docs/tasks/_template.md` | Blank task template showing expected frontmatter structure |
| `docs/tasks/T001-*.md` | Sample completed task (status: done) |
| `docs/tasks/T037-*.md` | Sample blocked task (status: blocked) |
| `docs/tasks/T042-*.md` | Sample pending task (status: todo) |
| `docs/projects/m1-*/` | 2 sample feature project files showing milestone structure |
| `docs/projects/m2-*/_decisions/` | 2 sample decision documents showing the async decision protocol |
| `docs/superpowers/specs/` | M1 planning design — shows the wave/phase execution model |
| `docs/superpowers/plans/` | M1 phase 1 execution plan — shows concrete worker assignments |
| `docs/superpowers/retros/` | Iteration 1 retrospective — shows what was learned |
| `docs/architecture/CLAUDE.md` | Architecture reference conventions (dogproj-app-specific) |

### `program-manager/`
| File | Purpose |
|------|---------|
| `CLAUDE.md` | Deuleytron identity — authority model, confidence protocol, bootstrapping mode, task classification |
| `philosophy/principles.md` | 7 non-negotiable axioms for reasoning (epistemic triage, signal discrimination, etc.) |
| `philosophy/playbook.md` | 11 worked examples showing how principles apply to real scenarios |
| `philosophy/anti-patterns.md` | 6 explicit failure modes with guardrails (Zero Claw, Confident Confabulator, etc.) |
| `context/dogproj.md` | Per-project authority scope for the knowledge vault |
| `context/dogproj-app.md` | Per-project authority scope for the codebase |
| `specs/` | Design specs for the decision framework and three-agent coordination model |
| `memory/decisions/` | Empty — narrative decision memo directory (Tier 1 memory) |
| `memory/insights/` | Empty — cross-project pattern directory |

### Root
| File | Purpose |
|------|---------|
| `2026-03-22-three-agent-system-design.md` | Coordination architecture across all three agents |
| `CONTEXT.md` | This file |

## The Iterative Improvement Vision

The experiment Patrick wants to run:

1. **Deploy** — Drop one or more of these agents into a new project repository
2. **Adapt** — Give the agent permission to edit its own configuration (CLAUDE.md, skills, rules) as it learns the new project
3. **Execute** — Work through real project tasks as a human-agent team
4. **Compare** — After a cycle of work, diff the agent's self-modifications against this upstream baseline
5. **Judge** — Evaluate which changes improved efficacy and which were noise or regression
6. **Merge back** — Incorporate validated improvements into the canonical agent definitions
7. **Repeat** — Drop the improved version into the next project

This creates a feedback loop where each deployment teaches us something about what makes the agent configurations more or less effective, and the agents themselves participate in surfacing those improvements.

## What Needs To Happen Next

- **Three new repos** are being created in the mocha GitHub organization to host each agent independently
- The files in each subdirectory here will be committed to those repos
- The project-specific content (dogproj references, Supabase conventions, etc.) is intentionally left intact as working reference — generalization is the next phase, not this one
- The first experiment will be choosing a target project and deciding which agent(s) to deploy into it

## Source Projects

| Agent | Source | Location |
|-------|--------|----------|
| Product Manager | dogproj | `/Users/deuley/code/dogproj` |
| Engineering Manager | dogproj-app | `/Users/deuley/code/dogproj-app` |
| Program Manager | tron (Deuleytron) | `/Users/deuley/code/tron` |

Extracted 2026-03-23.
