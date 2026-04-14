# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A shared toolkit of reusable AI agent configurations, Claude Code skills, and utility scripts owned by Patrick and Christie Deuley (GitHub org: deuleyville). Items here are templates and starting points — meant to be copied into target projects and customized. There is no versioning contract or sync mechanism.

## Repository Structure

```
agents/              — Agent persona definitions (CLAUDE.md + skills + rules + philosophy)
  product-manager/     — Customer-focused product strategist (proposals, market research, outcome validation)
  program-manager/     — Translation layer between product and engineering (projects, sequencing, acceptance criteria)
  engineering-manager/  — Execution orchestrator (tasks, worker dispatch, PR validation)
templates/           — Document templates for the protocol (proposal, project, task, message, context)
scripts/             — Operational scripts (project init, inbox watcher)
skills/              — Standalone Claude Code skill definitions (copy into .claude/skills/)
docs/
  superpowers/specs/   — Design specs
  superpowers/plans/   — Implementation plans
  operations/          — Operational guides (session startup, project onboarding)
```

## Architecture: The Agent Triad Protocol

The three agents coordinate through a structured protocol defined in `docs/superpowers/specs/2026-03-23-agent-triad-protocol-design.md`.

**The pipeline:**

```
Human (strategy, goals) → PM (proposals) → PgM (projects) → EM (tasks) → Dev (code)
```

- **Product Manager** produces proposals describing customer needs and proposed solutions. Reviews project plans from PgM. Validates completed work against business outcomes.
- **Program Manager** decomposes proposals into sized, sequenced projects with acceptance criteria. Reviews task lists from EM. Validates completed projects.
- **Engineering Manager** decomposes projects into atomic tasks for dev workers. Dispatches workers to isolated worktrees. Validates PRs and reports completed projects.

Communication happens through file-based inbox messages (`docs/inbox/<agent>/`) with a filesystem watcher for tmux notifications. Negotiation is bounded (max 2 revision cycles per boundary) with human escalation.

**Deployment model:** Agents run from this toolkit repo, pointed at target projects. Target projects receive protocol infrastructure (`docs/proposals/`, `docs/projects/`, `docs/tasks/`, `docs/inbox/`) via `scripts/init-project.sh`. Per-project context files in `agents/<role>/context/` persist learning across sessions.

## Key Context Files

- `docs/superpowers/specs/2026-03-23-agent-triad-protocol-design.md` — Protocol spec (document formats, negotiation rules, agent interface contracts)
- `docs/superpowers/plans/2026-03-23-agent-triad-implementation.md` — Implementation plan
- `docs/operations/session-startup.md` — How to start an agent triad session
- `docs/operations/onboarding.md` — How to onboard a new project
- `CONTEXT.md` — Detailed breakdown of agent directory contents
- `notes.md` — Planning notes and open questions

## Working With This Repo

This is a content/configuration repository — no build system, no tests (except `skills/update-llmstxt/tests/`), no package manager. The primary operations are:

- **Reading and understanding** agent configurations and skill definitions
- **Editing** CLAUDE.md files, skill SKILL.md files, philosophy docs, and rules
- **Running scripts** to initialize projects (`scripts/init-project.sh`) or start inbox watchers (`scripts/inbox-watcher.sh`)
- **Comparing** agent configurations across deployments to identify improvements

### Skills (standalone)

Each skill lives in `skills/<name>/` with a `SKILL.md` as its entry point. Some skills have `references/` subdirectories with supporting material. Skills with Python scripts: `publish-gdoc/md2gdoc.py`, `sync-gdoc/gdoc2md.py`, `update-llmstxt/map_scanner.py`.

To run the update-llmstxt tests:
```
cd skills/update-llmstxt && python -m pytest tests/
```

### Agent Internals

Each agent directory is structured as a self-contained Claude Code project root:
- `CLAUDE.md` — Agent identity, protocol role, operating instructions
- `.claude/skills/` — Protocol skills (create-proposal, check-inbox, send-message, etc.)
- `.claude/rules/` — Enforcement rules (TDD, task completion checklist)
- `philosophy/` — Decision framework (principles, playbook, anti-patterns)
- `context/` — Per-project context files that persist cross-session learning

### Templates

`templates/` contains document templates used by agents:
- `proposal.md` — PMD-NNN format, owned by PM
- `project.md` — PRJ-NNN format, owned by PgM
- `task.md` — T-NNN format, owned by EM
- `message.md` — Inbox message format
- `project-context.md` — Per-project agent context file
