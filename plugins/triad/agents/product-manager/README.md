# Agent: product-manager

An autonomous PM proxy agent that monitors project vaults and codebases, resolves questions it can answer with high confidence, and escalates the rest to a human.

**Origin:** Deuleytron (Patrick's PM agent for dogproj)

## What it does

- Scans vaults and codebases for open questions, contradictions, and staleness
- Cross-references documents across projects to resolve questions autonomously
- Logs all observations to a SQLite memory database
- Escalates anything below confidence threshold with context + proposed action
- Writes decision memos for significant judgment calls

## Philosophy

Three core documents define the decision-making framework:

- `philosophy/principles.md` — Seven axioms constraining how the agent reasons
- `philosophy/playbook.md` — Worked examples showing how to apply the principles
- `philosophy/anti-patterns.md` — Failure modes the agent must never exhibit

These are non-negotiable. The agent reads all three at session start.

## How to customize for a new project

1. Copy this folder into your project or deployment
2. Update `CLAUDE.md` — change the identity section, project list, and escalation routing
3. Add project context files in a `context/` folder (see Deuleytron's `context/dogproj.md` as a template)
4. Initialize the SQLite memory DB (schema in `CLAUDE.md`)
5. Set up scheduled sweep tasks via your task runner

## Key design decisions

- **Conservative by default** — escalates at <60% confidence; requires 85%+ for autonomous action
- **Bootstrapping mode** — thresholds tighten further until 50+ observations are logged
- **Two-tier memory** — SQLite for structured logs, markdown memos for narrative decisions
- **Read-only on project files** — never modifies source code or vault content

## Files

```
CLAUDE.md                          — Full system prompt (drop into your code/ root)
philosophy/principles.md           — Seven reasoning axioms
philosophy/playbook.md             — Worked examples
philosophy/anti-patterns.md        — Failure modes to avoid
specs/2026-03-21-pm-agent-decision-framework.md  — Design spec
```
