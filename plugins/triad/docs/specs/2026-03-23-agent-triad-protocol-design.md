# Agent Triad Protocol Design

> A structured coordination protocol for autonomous product, program, and engineering management agents operating as a pipeline from customer need to shipped code.

**Date:** 2026-03-23
**Status:** Draft
**Author:** Patrick Deuley + Claude (brainstorming session)
**Supersedes:** `2026-03-22-three-agent-system-design.md` (coordination model only — that doc's deployment architecture for code.lan remains valid)

---

## 1. Problem Statement

Three agent roles — product manager, program manager, and engineering manager — were grown organically in separate projects and share too much DNA. The PM and PgM in particular are nearly identical, both optimized for analytical reasoning at the expense of role-appropriate thinking. The PM lacks the soft skills for customer empathy and value judgment; the PgM lacks sufficient engineering translation capability; and the EM operates without awareness of the broader pipeline.

Additionally, there is no structured protocol for how these agents communicate. The existing decision-doc mechanism (EM writes a question, PM pulls and answers) handles one narrow case but doesn't cover the full lifecycle from proposal to shipped code.

## 2. Design Thesis

**Context engineering between agents is the primary lever for system performance.** The same progressive disclosure philosophy that makes a single agent effective within a knowledge base should govern how agents share context with each other across the pipeline. Each agent gets a curated, compressed view of adjacent domains — not raw access, not full isolation, but the right summary that gives them just enough to make good decisions without drifting into the wrong lane.

If we give these models the right context, they will produce the right outcomes. The protocol — document formats, negotiation rules, escalation paths, context boundaries — is the product. Individual agent prompts are tunable; the protocol is canonical.

**The negotiation records become the observability layer.** Friction patterns in the message archive reveal where agent prompts need tuning. If the PgM consistently gets pushback on the same kind of issue, that's a prompt problem, not a protocol problem. The protocol stays stable; the agents get tuned based on what the records show.

## 3. Architecture Overview

### 3.1 The Pipeline

Four roles form a chain of custody from customer need to shipped code:

```
Human (strategy, goals, priorities)
  ↓ informs
Product Manager — the "why" and "what"
  ↓ proposals
Program Manager — the "when" and "in what order"
  ↓ projects + tasks
Engineering Manager — the "how" and "who does it"
  ↓ task dispatch
Dev Worker — executes, produces PRs
```

Each role has a distinct span of control:

| Role | Produces | Validates | Primary Concern |
|------|----------|-----------|-----------------|
| **Product Manager** | Proposals | Completed proposals | Customer value, market fit, business outcomes |
| **Program Manager** | Projects | Completed projects, task acceptance criteria | Sequencing, dependencies, feasibility, scope tradeoffs |
| **Engineering Manager** | Tasks | Completed PRs | Technical execution, code quality, worker dispatch |
| **Dev Worker** | Code (PRs) | — | Implementation against task spec |

### 3.2 Context Boundaries

Each agent's effectiveness depends on having the right context boundary — not too much, not too little. The agent separation is a context engineering architecture. Boundaries are information firewalls that prevent each role from drifting into adjacent concerns:

- PM with too much technical depth → builds for the sake of building, chases feature chains instead of market signal
- PgM without business context → makes myopic sequencing decisions, misses one-way doors that affect future delivery
- EM with too much strategic context → workers get distracted, build features nobody asked for
- Dev with anything beyond the task → same problem, amplified

Each agent needs just enough bleed-through from adjacent layers to avoid being blind. That bleed-through is curated and compressed, not raw access.

```
                    Vault/     Proposal  Project  Architecture  Source  Task   Market
                    Research   Docs      Docs     References    Code    Files  Research
                    ─────────────────────────────────────────────────────────────────────
Product Manager     DEEP       FULL      review   llms.txt      —       —      DEEP
Program Manager     summary    FULL      FULL     moderate      —       FULL   summary
Engineering Manager —          summary   FULL     DEEP          FULL    FULL   —
Dev Worker          —          —         —        task-scoped   scoped  single —
```

### 3.3 Runtime Model

Each agent runs in an independent tmux session. Communication is file-based and asynchronous:

- All inboxes live in the project repo at `docs/inbox/<agent>/`
- A lightweight filesystem watcher (systemd/launchd) monitors each agent's `unread/` directory
- On new file: `tmux send-keys -t <session> "NEW_MESSAGE: <filename>" Enter`
- The human inbox at `docs/inbox/human/` can be symlinked to `~/inbox/` for convenience

Agents are always running. They process messages when notified, complete their current atomic operation before checking the inbox, and stall the downstream chain by not responding if something is wrong (passive stop-the-line).

## 4. Document Hierarchy

Three canonical artifact types flow through the system. Each has a single source of truth, a single owner, and a defined lifecycle.

### 4.1 Proposal

**Owner:** Product Manager
**Location:** `docs/proposals/<PMD-id>-<slug>/proposal.md`
**Purpose:** Articulate a customer need and a proposed solution

```yaml
---
id: PMD-001
title: "Import accounting data from QuickBooks"
status: draft | review | approved | in-progress | completed | cancelled
author: product-manager
created: 2026-03-23
updated: 2026-03-23
customer_need: "Facility operators manually re-enter financial data between systems"
personas:
  - facility-owner
  - office-manager
success_criteria:
  - "Facility operator can connect QuickBooks account in under 5 minutes"
  - "Transaction data syncs daily without manual intervention"
  - "Operator can see consolidated financial view across POS and QuickBooks"
---

## Context

Why this matters, the business environment, constraints, customer pain.
Rich narrative — the PM selling the reader on the problem.

## Proposed Solution

High-level approach described in terms of user-facing capabilities.
Not implementation detail — what the product does, not how it's built.

### Suggested Projects

Illustrative decomposition. Starting points for the PgM, not commitments.

1. **QuickBooks OAuth Integration** — Connect accounts, manage tokens
2. **Transaction Sync Pipeline** — Daily pull, transform, store
3. **Consolidated Financial View** — UI for merged financial data

## Open Questions

Things the PM knows are unresolved and wants the PgM to weigh in on.
```

**Design notes:**
- `status` tracks the proposal through the negotiation lifecycle. `approved` means PM and PgM agreed on the project plan. `in-progress` means projects are being executed. `completed` means PM validated the final outcome.
- `success_criteria` are business outcomes, not technical tests. These are what the PM validates at the end.
- Suggested projects are explicitly illustrative — the PgM may restructure entirely.
- The proposal directory can hold supporting material (mockups, research, competitive analysis) alongside the canonical `proposal.md`.

### 4.2 Project

**Owner:** Program Manager (co-created with PM, validated by EM)
**Location:** `docs/projects/<PMD-id>-<slug>/<project-slug>.md`
**Purpose:** A sized, sequenced chunk of work with clear acceptance criteria

```yaml
---
id: PRJ-001
title: "QuickBooks OAuth Integration"
status: draft | review | approved | in-progress | completed | blocked
proposal: PMD-001
author: program-manager
sequence: 1
depends_on: []
blocks: [PRJ-002]
created: 2026-03-23
updated: 2026-03-23
acceptance_criteria:
  - "OAuth flow completes successfully with QuickBooks sandbox"
  - "Token refresh handles expiration without user intervention"
  - "Connection status visible in facility settings"
  - "Disconnection cleanly revokes tokens and removes stored credentials"
estimated_complexity: medium  # small | medium | large
---

## Scope

What this project delivers and what it explicitly does not.

## Approach

How this will be implemented at a high level — enough for the EM to
evaluate feasibility and decompose into tasks.

## Rationale

Why this project exists in this form. If the PgM modified the PM's
suggested decomposition, explain why here.

## Dependencies & Risks

What this project needs from other projects or external systems.
Known risks and mitigation strategies.
```

**Design notes:**
- Projects nest under their parent proposal's directory — the filesystem reflects the hierarchy.
- `acceptance_criteria` are more specific than proposal success criteria but still outcome-oriented, not implementation tests.
- `sequence` defines execution order within the proposal. The PgM owns sequencing.
- `estimated_complexity` helps the EM gauge task decomposition granularity.

### 4.3 Task

**Owner:** Engineering Manager (acceptance criteria refined by PgM)
**Location:** `docs/tasks/<T-id>-<slug>.md`
**Purpose:** An atomic work item completable in a single agent context window

```yaml
---
id: T-001
title: "QuickBooks OAuth route and token storage"
status: todo | in-progress | done | blocked
project: PRJ-001
author: engineering-manager
depends_on: []
blocks: [T-002]
created: 2026-03-23
completed:
scope:
  boundaries:
    - "src/routes/integrations/"
    - "src/db/schema/integrations.ts"
  references:
    - "docs/projects/PMD-001-quickbooks-import/quickbooks-oauth.md"
acceptance_criteria:
  - "`pnpm test -- --grep 'quickbooks oauth'` — all passing"
  - "POST /api/v1/integrations/quickbooks/connect returns redirect URL"
  - "GET /api/v1/integrations/quickbooks/callback stores tokens"
  - "Tokens encrypted at rest in integrations table"
actual_tokens:
actual_duration_minutes:
---

## Description

What the dev agent needs to build. Specific enough to execute without
ambiguity in a single context window.

## Acceptance Criteria Detail

Expanded detail on any criteria that need clarification.

---
<!-- Completion summary written by executing agent below this line -->
```

**Design notes:**
- Active tasks are flat in `docs/tasks/` — easier for workers to find and for the EM to manage a queue. The contents of `docs/tasks/` represent the current work queue; a quick listing shows the burndown.
- When a task reaches `done` status, the EM moves it to `docs/tasks/_completed/`. This keeps the active queue clean and makes incomplete work immediately visible.
- `project` field links back to the parent project for traceability.
- Acceptance criteria at this level are concrete, runnable tests.
- `scope.boundaries` and `scope.references` carry forward from the existing EM design.
- Completion summary below the `---` divider is written by the dev agent.

### 4.4 Directory Structure

```
docs/
├── proposals/
│   └── PMD-001-quickbooks-import/
│       ├── proposal.md              ← PM owns
│       └── [supporting files]       ← research, mockups, etc.
├── projects/
│   └── PMD-001-quickbooks-import/     ← mirrors proposal ID + slug
│       ├── quickbooks-oauth.md      ← PgM owns
│       ├── transaction-sync.md
│       └── financial-view.md
└── tasks/
    ├── T-001-qb-oauth-route.md      ← EM owns (active work queue)
    ├── T-002-qb-token-refresh.md
    ├── ...
    └── _completed/
        └── T-000-test-infra.md      ← done tasks moved here
```

## 5. Messaging System

### 5.1 Inbox Structure

All inboxes live in the project repository under `docs/inbox/`. This keeps all communication tracked alongside the canonical documents, makes messages directly referenceable from project files, and ensures the full decision trail is committed together with the work.

```
docs/inbox/
├── product-manager/
│   ├── unread/    ← filesystem watcher monitors this
│   └── read/      ← processed messages, git-tracked archive
├── program-manager/
│   ├── unread/
│   └── read/
├── engineering-manager/
│   ├── unread/
│   └── read/
└── human/
    ├── unread/
    └── read/
```

The human inbox at `~/inbox/` is a symlink or mirror of `docs/inbox/human/` — the canonical location is in the project repo, but the human may want a convenient local path for notifications and direct access.

### 5.2 Message Format

Each message is a markdown file with YAML frontmatter.

**Filename:** `<YYMMDDHHMMSS>-<object-id>-<step>.md`

Object IDs in filenames drop the hyphen for cleaner parsing (e.g., `PMD-001` becomes `PMD001`, `PRJ-001` becomes `PRJ001`).

Examples:
- `260323140000-PMD001-proposal-review.md`
- `260323150000-PMD001-project-plan.md`
- `260323161000-T015-info.md`
- `260324090000-PRJ003-escalation.md`

**Content:**

```yaml
---
type: <step name>
from: product-manager | program-manager | engineering-manager | human
to: product-manager | program-manager | engineering-manager | human
disposition: approved | revise | escalate | info
references:
  - path/to/canonical/document.md
proposal: PMD-001
project: PRJ-001       # if applicable
task: T-001            # if applicable
round: 1               # which negotiation round
timestamp: 2026-03-23T14:00:00-04:00
urgency: blocking | non-blocking    # for escalations
reason: need-clarity | process-concern  # for escalations
---

## Summary

One-paragraph description of what this message is about and what
action is needed from the recipient.

## Detail

Specific feedback, rationale, or context. For revise dispositions,
this describes the requested changes with enough specificity for the
recipient to act without ambiguity.
```

### 5.3 Dispositions

| Disposition | Meaning | What Happens Next |
|---|---|---|
| `approved` | Document meets requirements | Advances to next phase |
| `revise` | Specific changes requested | Author revises, re-submits (counts as a round) |
| `escalate` | Cannot reach agreement or insufficient clarity | Goes to human with full context |
| `info` | FYI notification, no action required | No response expected; recipient processes at their discretion |
| `directive` | Human-issued instruction | Recipient incorporates and acknowledges with `info` disposition |

### 5.4 Filesystem Watcher

One service per agent. Monitors `docs/inbox/<agent>/unread/` in the project repo. On new file:

```bash
tmux send-keys -t <session-name> "NEW_MESSAGE: <filename>" Enter
```

Agent behavior on notification:
1. Complete current atomic operation (don't preempt work in progress)
2. Read the message file from `inbox/unread/`
3. Read the referenced canonical documents
4. Take the appropriate action based on message type and disposition
5. Move the message to `inbox/read/`

At session start, agents check `inbox/unread/` for any messages that arrived while they were inactive.

Multiple messages arriving simultaneously are processed in timestamp order. Messages for different proposals/projects are independent.

**State recovery:** If an agent restarts and has lost its in-memory context about which negotiation cycle it is in, it can reconstruct state by reading the messages in `docs/inbox/<agent>/read/` for the relevant object ID. The `round` field in each message and the chronological filename ordering provide a complete history of the negotiation.

### 5.5 Git Integration

- **Canonical documents** (`docs/proposals/`, `docs/projects/`, `docs/tasks/`) — always committed
- **Message archives** (`docs/inbox/*/read/`) — committed as decision record
- **Unread messages** (`docs/inbox/*/unread/`) — transient, not committed (they move to `read/` quickly)

Since all inboxes live in the project repo, the full decision trail is committed alongside the work itself. Messages can be directly referenced from project and task documents (e.g., `docs/inbox/program-manager/read/260323150000-PMD001-project-plan.md`), making it easy to trace any decision back to the negotiation that produced it.

## 6. Negotiation Protocol

### 6.1 Core Rules

1. **Max 2 revision cycles** at each boundary before escalation to human. A revision cycle is: reviewer sends `revise` → author revises → reviewer evaluates revision. The initial submission and first review are not a revision cycle.
2. Every review produces a message with a clear disposition
3. The canonical document is the single source of truth — messages reference it, they don't duplicate it
4. Negotiations are sequential — one active negotiation per document at a time

### 6.2 Boundary 1: PM ↔ PgM (Proposal → Project Plan)

```
Submit:     PM writes proposal (status: draft → review)
            PM sends → PgM: *-<PMD-id>-proposal-review

Initial:    PgM reads proposal, creates project files
            PgM sends → PM: *-<PMD-id>-project-plan

Review:     PM reviews project plan
            PM sends → PgM: *-<PMD-id>-feedback
              disposition: approved  → projects finalized (status: approved)
              disposition: revise    → revision cycle 1 begins

Cycle 1:    (only if revise) PgM revises project plan
            PgM sends → PM: *-<PMD-id>-project-plan-revised

            PM reviews revised plan
            PM sends → PgM: *-<PMD-id>-feedback
              disposition: approved  → projects finalized
              disposition: revise    → revision cycle 2 begins

Cycle 2:    (only if revise) PgM revises again
            PgM sends → PM: *-<PMD-id>-project-plan-revised

            PM reviews second revision
            PM sends → PgM: *-<PMD-id>-feedback
              disposition: approved  → projects finalized
              disposition: escalate  → human intervenes (max cycles reached)
```

### 6.3 Boundary 2: PgM ↔ EM (Projects → Tasks)

```
Submit:     PgM finalizes project files (status: approved)
            PgM sends → EM: *-<PRJ-id>-project-ready

Initial:    EM evaluates feasibility, proposes task list
            EM sends → PgM: *-<PRJ-id>-tasks-proposed

Review:     PgM reviews tasks, refines acceptance criteria
            PgM sends → EM: *-<PRJ-id>-feedback
              disposition: approved  → tasks enter work queue
              disposition: revise    → revision cycle 1 begins

Cycle 1:    (only if revise) EM revises tasks
            EM sends → PgM: *-<PRJ-id>-tasks-revised

            PgM reviews revised tasks
            PgM sends → EM: *-<PRJ-id>-feedback
              disposition: approved  → tasks enter work queue
              disposition: revise    → revision cycle 2 begins

Cycle 2:    (only if revise) EM revises again
            EM sends → PgM: *-<PRJ-id>-tasks-revised

            PgM reviews second revision
            PgM sends → EM: *-<PRJ-id>-feedback
              disposition: approved  → tasks enter work queue
              disposition: escalate  → human intervenes (max cycles reached)
```

### 6.4 Boundary 3: EM ↔ Dev (Task Execution)

No negotiation at this boundary — dispatch and validation only:

```
EM assigns task to dev worker (task status → in-progress)
Dev executes, produces PR, writes completion summary
EM validates PR against task acceptance criteria
  → pass: task status → done
  → fail: EM either provides feedback to dev or flags to PgM
```

**Ad hoc tasks** discovered during execution:

```
Dev identifies additional work needed → reports in completion summary
EM creates new task file
EM sends → PgM: *-<T-id>-info
  disposition: info
  "Added T-015 for [reason], spawned from T-012"
PgM acknowledges (no round consumed, no approval gate)
```

### 6.5 Completion Validation (Back Up the Chain)

When all tasks for a project are done:

```
EM validates aggregate:
  → all task acceptance criteria still pass
  → project-level acceptance criteria pass
  EM sends → PgM: *-<PRJ-id>-project-complete
    disposition: approved

PgM validates against project plan:
  → acceptance criteria met
  PgM sends → PM: *-<PRJ-id>-project-validated
    disposition: approved

PM validates when all projects for a proposal are done:
  → business outcomes achieved
  PM sends → Human: *-<PMD-id>-proposal-complete
    disposition: approved
  Proposal status → completed
```

**Validation failure:** If a validator determines acceptance criteria are not met, they send a `revise` message back down identifying which specific criteria failed and what needs to change. The recipient determines whether this requires new tasks (EM creates them), modifications to existing work (EM re-dispatches), or a scope discussion (escalate to the boundary above).

Completion validation is not a negotiation — it is a pass/fail check against defined criteria. If criteria are met, the work advances. If not, the specific failures are identified and the appropriate corrective action is taken. There is no bounded revision cycle here; instead, the corrective work flows through the normal task execution pipeline.

**Status transitions during completion:**
- When the EM begins validating a project's tasks: project status → `in-progress` (if not already)
- When the PgM approves a project: project status → `completed`
- When the first project for a proposal enters execution: proposal status → `in-progress`
- When the PM validates all projects: proposal status → `completed`
- If a proposal is abandoned: proposal status → `cancelled` (human directive only)

### 6.6 Escalation Rules

**When to escalate (any agent, any time):**
- Max negotiation rounds exhausted without agreement
- Agent lacks clarity and the adjacent agent cannot provide it
- Agent identifies a one-way door decision outside their authority
- Agent discovers a contradiction between documents at different levels
- Agent believes the process itself is not working correctly

**Escalation message includes:**
- What was attempted (links to the negotiation thread)
- The specific question or decision needed
- Proposed resolution if the agent has one
- Urgency: `blocking` (work stopped) or `non-blocking` (work continues on other items)
- Reason: `need-clarity` (content problem) or `process-concern` (systemic problem)

**Escalation chain:** Dev → EM → PgM → PM → Human. Each level attempts to resolve before passing up. An agent may skip levels if the question is clearly outside the next level's domain.

### 6.7 Stop the Line

Any agent, at any time, can halt processing by:

1. **Not responding** to a message — the downstream chain stalls passively
2. **Sending an escalation to `docs/inbox/human/`** with `reason: process-concern` — the agent explicitly flags that something systemic is wrong and waits for human input before continuing

The `process-concern` reason is distinct from `need-clarity`. It signals "I think the process itself is broken at this boundary" rather than "I need more information to do my job." These are the signals to watch when tuning agent prompts.

The human can respond by:
- Dropping a `*-feedback` message in the stalled agent's inbox with guidance
- Going directly to the other agent involved and mediating
- Adjusting the protocol or agent prompts based on what the escalation reveals

## 7. Agent Interface Contracts

These define what each agent receives, produces, reads, and is responsible for. The contracts are what make agents independently tunable — as long as an agent honors its interface, its internals can change freely.

### 7.1 Product Manager

**Receives:**

| Message Step | From | Action |
|---|---|---|
| `project-plan` | PgM | Review project plan against proposal intent |
| `project-plan-revised` | PgM | Review revised plan |
| `project-validated` | PgM | Validate business outcomes achieved for this project |
| `escalation` | PgM | Provide product/customer clarity |
| `feedback` | Human | Incorporate direction, resume |
| `directive` | Human | Incorporate new priority or course correction |

**Produces:**

| Message Step | To | Trigger |
|---|---|---|
| `proposal-review` | PgM | New proposal ready for decomposition |
| `feedback` | PgM | Response to project plan (approved/revise) |
| `proposal-complete` | Human | All projects validated, proposal fulfilled |
| `escalation` | Human | Cannot resolve with available context |
| `info` | PgM | Acknowledgment of directive that affects in-flight work |

**Owns:** Proposal documents (`docs/proposals/`)

**Context access:**
- Own knowledge base (vault) — deep access
- Architecture references — llms.txt level only, not service-level detail
- Project files — to validate outcomes, not to influence implementation
- Competitor/market research — deep access
- Does NOT read: task files, source code, service-level architecture, worker completion summaries

**Responsibilities:**
- Articulate customer needs grounded in research and data
- Propose solutions in terms of user-facing capabilities
- Define business-level success criteria
- Validate that completed work achieves customer outcomes
- Escalate when product direction needs human input

### 7.2 Program Manager

**Receives:**

| Message Step | From | Action |
|---|---|---|
| `proposal-review` | PM | Decompose proposal into project plan |
| `feedback` | PM | Revise project plan per PM feedback |
| `info` | PM | Acknowledgment or FYI from PM (e.g., directive impact) |
| `tasks-proposed` | EM | Review task list, refine acceptance criteria |
| `tasks-revised` | EM | Re-review revised tasks |
| `project-complete` | EM | Validate project against acceptance criteria |
| `info` | EM | Acknowledge ad hoc task additions |
| `escalation` | EM | Provide sequencing/dependency/architecture clarity |
| `feedback` | Human | Incorporate direction, resume |
| `directive` | Human | Incorporate new priority or course correction |

**Produces:**

| Message Step | To | Trigger |
|---|---|---|
| `project-plan` | PM | Project plan ready for review |
| `project-plan-revised` | PM | Revised plan after PM feedback |
| `project-ready` | EM | Approved projects ready for task decomposition |
| `feedback` | EM | Response to proposed tasks (approved/revise) |
| `project-validated` | PM | Validated project ready for PM review |
| `escalation` | PM or Human | Cannot resolve at this level |
| `info` | PM or EM | Acknowledgment of directive or FYI |

**Owns:** Project documents (`docs/projects/`)

**Context access:**
- Proposal documents — full access, needs to understand intent
- Architecture references — deeper than PM, enough to evaluate feasibility and sequence
- Task files — to validate acceptance criteria and review completeness
- Project dependency graph — full picture of what blocks what
- Roadmap / current priorities — to sequence work appropriately
- Does NOT read: source code, worker completion summaries, deep market research, service-level interfaces

**Responsibilities:**
- Translate proposals into sized, sequenced, dependency-ordered projects
- Ensure projects are feasible given architecture constraints
- Define project-level acceptance criteria bridging business outcomes to testable results
- Negotiate scope/priority tradeoffs with PM
- Validate task acceptance criteria against project intent
- Validate completed projects against acceptance criteria
- Own the sequencing and dependency graph across all active work

### 7.3 Engineering Manager

**Receives:**

| Message Step | From | Action |
|---|---|---|
| `project-ready` | PgM | Evaluate feasibility, propose tasks |
| `feedback` | PgM | Revise tasks per PgM feedback |
| `info` | PgM | Acknowledgment or FYI from PgM |
| `escalation` | Dev | Provide technical clarity or missing context |
| `feedback` | Human | Incorporate direction, resume |
| `directive` | Human | Incorporate new priority or course correction |

**Produces:**

| Message Step | To | Trigger |
|---|---|---|
| `tasks-proposed` | PgM | Task list ready for review |
| `tasks-revised` | PgM | Revised tasks after PgM feedback |
| `info` | PgM | Ad hoc task added during execution |
| `project-complete` | PgM | All tasks done, project validated |
| `escalation` | PgM or Human | Cannot resolve at this level |

**Owns:** Task documents (`docs/tasks/`), worker dispatch, PR validation

**Context access:**
- Project files — full access, needs to understand what's being asked
- Architecture references — deep access, needs to evaluate feasibility and design tasks
- Source code — full access, needs to identify patterns for workers
- Task completion summaries — full access, validates worker output
- Proposal documents — summary level only (reads `success_criteria` and `customer_need`, not full narrative)
- Does NOT read: market research, customer persona details, strategic planning, PM's vault

**Responsibilities:**
- Evaluate project feasibility (sequencing, dependencies, technical risk)
- Decompose projects into atomic, single-context-window tasks
- Define task-level acceptance criteria (runnable, testable)
- Dispatch dev workers with curated context (task file + pattern files)
- Validate PRs against task specs
- Aggregate completed tasks into project-level validation
- Flag one-way door decisions for PgM review

### 7.4 Human

**Receives:**

| Message Step | From | Action |
|---|---|---|
| `escalation` | Any agent | Make a decision, provide clarity, or mediate |
| `proposal-complete` | PM | Acknowledge completed work |
| `info` | Any agent | FYI notifications (ad hoc tasks, directive acknowledgments) |

**Produces:**

| Message Step | To | Trigger |
|---|---|---|
| `feedback` | Any agent | Response to escalation or direct intervention |
| `directive` | Any agent | Unprompted instruction (new priority, course correction) |

The human inbox lives at `docs/inbox/human/` in the project repo (same structure as agent inboxes). Any agent can write to it. `~/inbox/` can symlink here for convenience. Notification delivery to the human (Signal, terminal bell, etc.) is an implementation detail outside this protocol.

The human can also intervene directly by entering any agent's tmux session.

**Directive handling:** A `directive` is the only message type that can arrive unprompted (not in response to a prior message). When an agent receives a directive:

1. Read the directive and assess impact on current work
2. If the directive affects an in-flight negotiation, pause that negotiation
3. Incorporate the directive into current work
4. Send an `info` acknowledgment back to `docs/inbox/human/` confirming receipt and any impacts
5. If the directive conflicts with existing approved documents, the agent escalates back to the human rather than silently overriding the approved plan

Directives do not consume negotiation rounds. They are outside the normal protocol flow — they represent the human exercising direct authority over the system.

## 8. Future Work

This spec defines the protocol. The following items are deferred:

- **Agent philosophical foundations** — each agent needs a role-appropriate reasoning framework (the PM's empathy-driven product thinking vs. the PgM's analytical evaluation vs. the EM's execution discipline). The protocol's interface contracts inform what each framework needs to produce, but the frameworks themselves are a separate design exercise.
- **Filesystem watcher implementation** — the specific systemd/launchd service configuration, tmux integration, and error handling.
- **Observability and tuning** — how to systematically analyze the message archive for friction patterns, and how those patterns translate into agent prompt changes.
- **Multi-proposal coordination** — how the system handles multiple proposals in flight simultaneously, resource contention, and priority changes.
- **Dev worker protocol** — the EM↔Dev boundary is simpler (dispatch + validate) but the worker context, dispatch template, and completion summary format need to be formalized within this protocol framework. The existing EM patterns are a strong starting point.
- **Integration with product-kb-template** — how the PM agent's knowledge base (built on the progressive disclosure vault pattern) connects to the protocol's document hierarchy.

## Appendix A: Full Pipeline Sequence

**Phase 1: Proposal → Project Plan (PM ↔ PgM)**

| Step | Actor | Action | Message Sent | Stage |
|------|-------|--------|-------------|-------|
| 1 | PM | Writes proposal | `→ PgM: *-<PMD-id>-proposal-review` | Submit |
| 2 | PgM | Creates project files | `→ PM: *-<PMD-id>-project-plan` | Initial |
| 3 | PM | Reviews project plan | `→ PgM: *-<PMD-id>-feedback` | Review |
| 4 | PgM | Revises if needed | `→ PM: *-<PMD-id>-project-plan-revised` | Cycle 1 |
| 5 | PM | Reviews revision | `→ PgM: *-<PMD-id>-feedback` | Cycle 1 |
| 6 | PgM | Revises if needed | `→ PM: *-<PMD-id>-project-plan-revised` | Cycle 2 |
| 7 | PM | Reviews or escalates | `→ PgM: *-<PMD-id>-feedback` | Cycle 2 (max) |

**Phase 2: Projects → Tasks (PgM ↔ EM)**

| Step | Actor | Action | Message Sent | Stage |
|------|-------|--------|-------------|-------|
| 1 | PgM | Sends approved projects | `→ EM: *-<PRJ-id>-project-ready` | Submit |
| 2 | EM | Proposes tasks | `→ PgM: *-<PRJ-id>-tasks-proposed` | Initial |
| 3 | PgM | Reviews tasks + criteria | `→ EM: *-<PRJ-id>-feedback` | Review |
| 4 | EM | Revises if needed | `→ PgM: *-<PRJ-id>-tasks-revised` | Cycle 1 |
| 5 | PgM | Reviews revision | `→ EM: *-<PRJ-id>-feedback` | Cycle 1 |
| 6 | EM | Revises if needed | `→ PgM: *-<PRJ-id>-tasks-revised` | Cycle 2 |
| 7 | PgM | Reviews or escalates | `→ EM: *-<PRJ-id>-feedback` | Cycle 2 (max) |

**Phase 3: Execution (EM → Dev)**

| Step | Actor | Action | Message Sent |
|------|-------|--------|-------------|
| 1 | EM | Dispatches worker | (task status → in-progress) |
| 2 | Dev | Executes, PRs | (completion summary) |
| 3 | EM | Validates PR | (task status → done) |
| 4 | EM | Ad hoc tasks | `→ PgM: *-<T-id>-info` |

**Phase 4: Completion Validation (back up)**

| Step | Actor | Action | Message Sent |
|------|-------|--------|-------------|
| 1 | EM | Validates project aggregate | `→ PgM: *-<PRJ-id>-project-complete` |
| 2 | PgM | Validates against plan | `→ PM: *-<PRJ-id>-project-validated` |
| 3 | PM | Validates proposal outcomes | `→ Human: *-<PMD-id>-proposal-complete` |
