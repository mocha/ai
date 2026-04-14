# deuleyville-toolkit

Shared repository of reusable agents, skills, and scripts across Deuleyville projects.

**Org:** [deuleyville](https://github.com/deuleyville)
**Owners:** Patrick + Christie Deuley

## What This Is

A toolkit for running autonomous multi-agent development workflows. Three agent roles (Product Manager, Program Manager, Engineering Manager) coordinate through a structured protocol to take a product idea from proposal to shipped code — with bounded negotiation, human escalation, and file-based communication.

The agents, skills, and scripts here are templates and starting points. Copy what you need, customize freely. No versioning contract, no sync expected.

## Quick Start

```bash
# 1. Initialize a target project
./scripts/init-project.sh ~/code/my-project

# 2. Start an agent triad session (from this repo)
# Uses /start-triad skill — creates tmux session, starts 3 agents, inbox watchers
/start-triad org/my-project ~/code/my-project

# 3. Talk to the PM about what to build
# The pipeline flows: PM → PgM → EM → Dev workers
```

## Structure

```
agents/                    — Agent persona definitions
  product-manager/           — Customer-focused product strategist
  program-manager/           — Translation layer between product and engineering
  engineering-manager/       — Execution orchestrator with worker dispatch
templates/                 — Document templates (proposal, project, task, message, context)
scripts/                   — Operational scripts
  init-project.sh            — Initialize protocol infrastructure in a target project
  inbox-watcher.sh           — Filesystem watcher for inter-agent messaging
.claude/skills/            — Orchestration skills (for the supervisor session)
  start-triad/               — Create a new agent triad tmux session
  kick-triad/                — Restart crashed or stuck agents
  status-triad/              — Check current state of all agents
  resume-triad/              — Reconnect and verify session health
skills/                    — Standalone Claude Code skills (copy into any project)
docs/
  superpowers/specs/         — Design specs (protocol, experiments)
  superpowers/plans/         — Implementation plans
  operations/                — Session startup and project onboarding guides
  active-projects.md         — Registry of running agent triad sessions
```

## The Agent Triad Protocol

Three agents coordinate through file-based messaging with bounded negotiation:

```
Human (strategy, goals) → PM (proposals) → PgM (projects) → EM (tasks) → Dev (code)
```

| Role | Produces | Validates | Primary Concern |
|------|----------|-----------|-----------------|
| **Product Manager** | Proposals (PMD-NNN) | Business outcomes | Customer value, market fit |
| **Program Manager** | Projects (PRJ-NNN) | Acceptance criteria | Sequencing, feasibility, scope |
| **Engineering Manager** | Tasks (T-NNN) | Code quality | Execution, worker dispatch |

**Communication:** File-based inbox messages in `docs/inbox/<agent>/` with filesystem watcher notifications via tmux. All messages are git-tracked as the decision record.

**Negotiation:** Max 2 revision cycles per boundary before human escalation. Each handoff includes a "challenge before approve" step.

**Deployment:** Agents run from this toolkit repo, pointed at target projects. Target projects receive protocol infrastructure via `scripts/init-project.sh`. Agents run inside [Agent Safehouse](https://github.com/eugene1g/agent-safehouse) with `--dangerously-skip-permissions` for autonomous operation.

**Spec:** `docs/superpowers/specs/2026-03-23-agent-triad-protocol-design.md`

## Agents

| Agent | Description |
|---|---|
| [product-manager](./agents/product-manager/) | Customer-focused product strategist — explores needs, writes proposals, validates outcomes. Philosophy: customer empathy, evidence over intuition, value before completeness |
| [program-manager](./agents/program-manager/) | Translation layer — decomposes proposals into projects, reviews tasks, validates completions. Philosophy: epistemic triage, confidence protocol, 8 reasoning axioms |
| [engineering-manager](./agents/engineering-manager/) | Execution orchestrator — creates tasks, dispatches Sonnet workers to isolated worktrees, validates PRs. Enforces TDD, 30-min task timeout, full-stack validation |

## Skills (standalone)

Copy into any project's `.claude/skills/` directory.

| Skill | Description |
|---|---|
| [deck-to-md](./skills/deck-to-md/) | Convert presentation PDFs into structured Obsidian markdown |
| [defuddle](./skills/defuddle/) | Web content extraction and cleaning |
| [ingest-paper](./skills/ingest-paper/) | Ingest research paper PDFs with conversion, tagging, summarization |
| [investigate-service](./skills/investigate-service/) | Analyze a codebase and produce architecture docs (SUMMARY.md + INTERFACES.md) |
| [meeting-prep](./skills/meeting-prep/) | Prepare meeting briefs and agendas |
| [obsidian-bases](./skills/obsidian-bases/) | Obsidian database view configurations |
| [parallel-agents](./skills/parallel-agents/) | Dispatch multiple agents for parallel work |
| [pdf-to-md](./skills/pdf-to-md/) | Convert PDF documents into structured markdown |
| [pr-review](./skills/pr-review/) | Pull request review workflow |
| [prd-architect](./skills/prd-architect/) | Build and maintain structured PRD directories |
| [publish-gdoc](./skills/publish-gdoc/) | Publish markdown to Google Docs |
| [security-audit](./skills/security-audit/) | Product Security Matrix audit (6 domains × 6 principles) |
| [summarize-document](./skills/summarize-document/) | Document summarization |
| [sync-gdoc](./skills/sync-gdoc/) | Sync Google Docs back to markdown |
| [update-llmstxt](./skills/update-llmstxt/) | Update llms.txt navigation files |
| [writing](./skills/writing/) | Writing assistance and style guidance |

## Scripts

| Script | Description |
|---|---|
| [init-project.sh](./scripts/init-project.sh) | Initialize agent triad infrastructure in a target project (proposals, projects, tasks, inboxes) |
| [inbox-watcher.sh](./scripts/inbox-watcher.sh) | Watch an agent's inbox directory and send tmux notifications on new messages. Debounced to prevent duplicate notifications |
| [inbox-watcher.service](./scripts/inbox-watcher.service) | systemd unit template for running inbox watchers as services (Linux) |
| [com.deuleyville.inbox-watcher.plist](./scripts/com.deuleyville.inbox-watcher.plist) | launchd plist template for running inbox watchers as services (macOS) |

## Onboarding a New Project

See `docs/operations/onboarding.md` for the full guide. The short version:

1. Run `scripts/init-project.sh ~/code/your-project`
2. Start agents: `/start-triad org/repo ~/code/your-project`
3. Talk to the PM about what to build
4. The pipeline handles the rest — proposals → projects → tasks → code
