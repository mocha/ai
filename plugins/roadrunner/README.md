# roadrunner

XState v5 deterministic pipeline engine for composed AI-assisted development workflows. Roadrunner provides the orchestration layer that drives [Skylark](../skylark/README.md) skills through a state machine with vocabulary-routed expert generation, task DAG decomposition, and OpenLLMetry telemetry.

## Architecture

Seven layers, each independently swappable through file-based contracts:

| Layer | Name | Technology | Role |
|:-----:|------|-----------|------|
| 1 | Triage & Routing | Skylark skills | Classify input, assess risk, determine pipeline path |
| 2 | **Orchestrator** | **XState v5** | Deterministic state machine — transitions, guards, persistence |
| 3 | Task Substrate | Taskmaster AI (MCP) | Decompose specs into task DAGs, query ready tasks, roll up status |
| 4 | Expert Generation & Review | Skylark `_shared/` | Vocabulary-routed prompts, drift validation, panel verdicts |
| 5 | Worker Execution | Claude Code CLI + worktrees | Isolated implementation per task |
| 6 | Monitoring | OpenLLMetry + Langfuse | Cost/duration spans, dashboards |
| 7 | Context Engineering | Budget hooks | Capacity alerts at 40%/60%/70%, pre-compact persistence |

Layers 1-5 form the sequential pipeline. Layers 6-7 are cross-cutting concerns attached to every worker session.

## Risk-Based Activation

Not every layer runs for every task. Risk level (from triage) determines which stages activate:

|  | Trivial | Standard | Elevated | Critical |
|:---|:---:|:---:|:---:|:---:|
| Triage | yes | yes | yes | yes |
| Decomposition | skip | skip | yes | yes |
| Expert generation | skip | yes | yes | yes |
| Spec review | skip | skip | Opus 3-4 | Opus 5→3 |
| Plan review | skip | skip | Opus 3-4 | Opus 5→3 |
| Worktree isolation | no | yes | yes | yes |
| Code quality panel | skip | Sonnet 2-3 | Sonnet 3-4 | Opus 3-4 |

## How It Works

The orchestrator is a pure state machine. It holds only metadata (<=20K tokens): current state, task statuses, round counts, risk level, and file path references. Artifact content (specs, plans, code, reviews) is never inlined — always referenced by path.

**State persistence:** Orchestrator snapshots to `.roadrunner/state.json` after every transition. On startup, it reads the snapshot and resumes via `createActor(machine, { snapshot })`.

**Key transitions:**

1. **Triage → Decompose/Dispatch** — risk level gates whether to decompose or dispatch immediately
2. **Decompose → Query Next Task** — L3 decomposes spec into DAG; L2 queries for next ready task
3. **Expert Generation → Worker** — L4 generates vocabulary-routed prompt + drift check; L5 runs worker in worktree
4. **Worker → Review** — L4 conducts spec compliance review, then panel code review
5. **Verdict Loop** — SHIP: mark complete. REVISE: re-dispatch (max 2 rounds). RETHINK: escalate to user.

## Runtime Artifacts

```
.roadrunner/
├── state.json              # XState persisted snapshot
├── experts/                # Generated expert prompts (L4)
├── verdicts/               # Review verdicts (L4)
├── results/                # Worker results (L5)
└── telemetry/              # Per-task cost/duration (L6)
```

## Relationship to Skylark

Roadrunner orchestrates; Skylark implements. Roadrunner has no skills of its own — it drives Skylark's triage, expert generation, and review skills through the state machine. The split keeps orchestration logic deterministic and skill logic in readable markdown.

## Install

From the mocha-ai marketplace:

```bash
/plugin install roadrunner@mocha-ai
```

## Build & Test

```bash
npm install
npm run build       # Compile TypeScript to dist/
npm run test        # Run vitest
npm run test:watch  # Watch mode
```

Requires Node.js 22+, TypeScript 5.5+, XState v5.
