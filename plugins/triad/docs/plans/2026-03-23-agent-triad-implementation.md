# Agent Triad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the agent triad protocol — rewrite three agent definitions, create protocol infrastructure templates, and build the operational tooling so these agents can coordinate on real projects.

**Architecture:** Three agent roles (PM, PgM, EM) with canonical definitions in this toolkit repo. Target projects receive protocol infrastructure (docs/proposals, docs/projects, docs/tasks, docs/inbox). Agents are invoked from their directories in the toolkit and pointed at a target project. Inter-agent communication via file-based inbox messages with filesystem watcher notifications.

**Spec:** `docs/superpowers/specs/2026-03-23-agent-triad-protocol-design.md`

---

## Deployment Model

Before diving into tasks — this is how the pieces fit together at runtime:

```
~/code/mocha/ai-toolkit/          ← this repo (canonical agent definitions)
├── agents/
│   ├── product-manager/          ← PM runs from here
│   │   ├── CLAUDE.md             ← identity, philosophy, protocol instructions
│   │   ├── philosophy/           ← product thinking framework
│   │   ├── context/              ← per-project context files
│   │   │   └── <project>.md      ← "here's what I know about project X"
│   │   └── .claude/skills/       ← protocol skills (create-proposal, etc.)
│   ├── program-manager/          ← PgM runs from here
│   │   ├── CLAUDE.md
│   │   ├── philosophy/           ← analytical evaluation framework
│   │   ├── context/
│   │   └── .claude/skills/
│   └── engineering-manager/      ← EM runs from here
│       ├── CLAUDE.md
│       ├── context/
│       └── .claude/skills/
│
~/code/<project>/                 ← any target project
├── docs/
│   ├── proposals/                ← PM writes here
│   ├── projects/                 ← PgM writes here
│   ├── tasks/                    ← EM writes here
│   │   └── _completed/
│   └── inbox/                    ← agents communicate here
│       ├── product-manager/
│       │   ├── unread/
│       │   └── read/
│       ├── program-manager/
│       │   ├── unread/
│       │   └── read/
│       ├── engineering-manager/
│       │   ├── unread/
│       │   └── read/
│       └── human/
│           ├── unread/
│           └── read/
```

**Session startup:** Human opens a tmux session per agent, invokes Claude Code from the agent's directory in the toolkit, and tells it: "We're working on project X at ~/code/<project>/. Load your context file for that project."

**Cross-project learning:** Each agent accumulates per-project context files. These persist between sessions and capture what the agent has learned about that project's domain, architecture, team, and quirks.

---

## Part 1: Protocol Infrastructure

This creates the reusable skeleton that gets added to any target project.

### Task 1: Create project scaffolding script

A script that initializes the protocol infrastructure in a target project. This is how you onboard a new project to the triad system.

**Files:**
- Create: `scripts/init-project.sh`

- [ ] **Step 1: Write the scaffolding script**

```bash
#!/usr/bin/env bash
# Initialize agent triad protocol infrastructure in a target project.
# Usage: ./init-project.sh /path/to/project

set -euo pipefail

TARGET="${1:?Usage: $0 /path/to/project}"

if [ ! -d "$TARGET" ]; then
  echo "Error: $TARGET does not exist"
  exit 1
fi

echo "Initializing agent triad protocol in $TARGET..."

# Document hierarchy
mkdir -p "$TARGET/docs/proposals"
mkdir -p "$TARGET/docs/projects"
mkdir -p "$TARGET/docs/tasks/_completed"

# Agent inboxes
for agent in product-manager program-manager engineering-manager human; do
  mkdir -p "$TARGET/docs/inbox/$agent/unread"
  mkdir -p "$TARGET/docs/inbox/$agent/read"
done

# Keep empty dirs in git
for dir in $(find "$TARGET/docs/inbox" -type d -empty) \
           "$TARGET/docs/proposals" \
           "$TARGET/docs/projects" \
           "$TARGET/docs/tasks/_completed"; do
  touch "$dir/.gitkeep"
done

# Gitignore unread (transient) but track read (decision record)
cat > "$TARGET/docs/inbox/.gitignore" << 'GITIGNORE'
# Unread messages are transient — they move to read/ quickly
*/unread/*
!*/unread/.gitkeep
GITIGNORE

echo "Done. Protocol infrastructure created at $TARGET/docs/"
echo ""
echo "Next steps:"
echo "  1. Create context files for this project in each agent's context/ directory"
echo "  2. Commit the new docs/ structure to the project repo"
echo "  3. Start agent tmux sessions"
```

- [ ] **Step 2: Make it executable and test**

Run: `chmod +x scripts/init-project.sh`
Run: `./scripts/init-project.sh /tmp/test-project` (on a temp directory)
Expected: Directory structure created matching the spec.

- [ ] **Step 3: Commit**

```bash
git add scripts/init-project.sh
git commit -m "add project scaffolding script for triad protocol"
```

### Task 2: Create document templates

Templates for proposals, projects, tasks, and messages that agents use when creating new documents. These live in the toolkit as reference and get copied by the agents when needed.

**Files:**
- Create: `templates/proposal.md`
- Create: `templates/project.md`
- Create: `templates/task.md`
- Create: `templates/message.md`

- [ ] **Step 1: Create proposal template**

```markdown
---
id: PMD-000
title: ""
status: draft
author: product-manager
created: YYYY-MM-DD
updated: YYYY-MM-DD
customer_need: ""
personas: []
success_criteria: []
---

## Context

Why this matters, the business environment, constraints, customer pain.

## Proposed Solution

High-level approach described in terms of user-facing capabilities.
Not implementation detail — what the product does, not how it's built.

### Suggested Projects

Illustrative decomposition. Starting points for the PgM, not commitments.

1. **Project Name** — Brief description

## Open Questions

Things the PM knows are unresolved and wants the PgM to weigh in on.
```

- [ ] **Step 2: Create project template**

```markdown
---
id: PRJ-000
title: ""
status: draft
proposal: PMD-000
author: program-manager
sequence: 1
depends_on: []
blocks: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
acceptance_criteria: []
estimated_complexity: medium
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

- [ ] **Step 3: Create task template**

```markdown
---
id: T-000
title: ""
status: todo
project: PRJ-000
author: engineering-manager
depends_on: []
blocks: []
created: YYYY-MM-DD
completed:
scope:
  boundaries: []
  references: []
acceptance_criteria: []
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

- [ ] **Step 4: Create message template**

```markdown
---
type:
from:
to:
disposition:
references: []
proposal:
project:
task:
round:
timestamp:
urgency:
reason:
---

## Summary

One-paragraph description of what this message is about and what
action is needed from the recipient.

## Detail

Specific feedback, rationale, or context.
```

- [ ] **Step 5: Commit**

```bash
git add templates/
git commit -m "add document templates for proposals, projects, tasks, messages"
```

### Task 3: Create project context file template

A template for the per-project context files that each agent maintains. This is what gets created when onboarding a new project.

**Files:**
- Create: `templates/project-context.md`

- [ ] **Step 1: Create the context file template**

```markdown
---
project: ""
repo_path: ""
domain: ""
last_updated: YYYY-MM-DD
---

## Domain Summary

What this project is, who it's for, what stage it's at.

## Key Navigation

Entry points for understanding this project:
- Architecture overview: `<path>`
- Current priorities: `<path>`
- Documentation root: `<path>`

## Architecture Summary

High-level description of the tech stack, major components, and system
boundaries. Enough for the agent to evaluate feasibility and understand
constraints without reading the full codebase.

## Active Work

What's currently in flight for this project. Updated at session start/end.

## Project-Specific Notes

Anything the agent has learned about this project that wouldn't be obvious
from reading the code. Quirks, conventions, known issues, team preferences.
```

- [ ] **Step 2: Commit**

```bash
git add templates/project-context.md
git commit -m "add project context file template"
```

---

## Part 2: Agent Rewrites

Each agent gets a new CLAUDE.md, philosophy docs (where applicable), and skills for their protocol responsibilities. The rewrites preserve what's working from the current agents and add the protocol layer.

### Task 4: Rewrite Product Manager CLAUDE.md

The PM is the most changed agent. Currently it's a copy of the PgM with an analytical/epistemological bent. It needs to become a customer-focused product thinker.

**Files:**
- Rewrite: `agents/product-manager/CLAUDE.md`
- Rewrite: `agents/product-manager/philosophy/principles.md`
- Rewrite: `agents/product-manager/philosophy/playbook.md`
- Rewrite: `agents/product-manager/philosophy/anti-patterns.md`
- Create: `agents/product-manager/context/` (directory, empty — context files added per project)

**What to preserve from current agent:**
- The confidence protocol structure (thresholds, modifiers) — but recalibrate for product decisions
- The memory/learning discipline — session start/end routines
- The mutual accountability model (agent challenges human, human challenges agent)

**What to change:**
- Identity: from "analytical decision engine" to "customer-focused product strategist"
- Philosophy: from epistemic triage to product thinking (customer empathy, value judgment, market signal interpretation, design philosophy)
- Context boundaries: deep vault/research access, llms.txt-level architecture, NO task/code access
- Protocol role: produces proposals, validates completed proposals, reviews project plans with PgM

- [ ] **Step 1: Write the new CLAUDE.md**

The CLAUDE.md should cover:
- **Identity**: You are the product manager. Your job is to understand customers, identify valuable problems, and propose solutions that deliver business outcomes. You think in terms of customer journeys, value propositions, and market fit — not systems and architectures.
- **Protocol role**: Reference the spec. You produce proposals (docs/proposals/), review project plans from the PgM, validate completed work against business outcomes. You communicate via docs/inbox/.
- **Context boundaries**: You have deep access to the knowledge vault (competitive intel, customer research, market analysis). You read architecture at llms.txt summary level only. You do NOT read task files, source code, or worker completion summaries.
- **Session startup**: Load project context file. Check inbox for messages. Review current proposal statuses.
- **How to create a proposal**: Use the proposal template. Include customer need, personas, success criteria, proposed solution with suggested projects, open questions.
- **How to review a project plan**: Read the PgM's project files. Validate they achieve the proposal's success criteria. Check that the sequencing makes sense from a customer value perspective (what delivers value earliest?). Send feedback via inbox message.
- **How to validate completed work**: When PgM sends project-validated, check the proposal's success criteria. Are the business outcomes achieved? Does the customer get what they need?
- **Escalation**: When you don't have enough product/customer context to make a call, escalate to human. When you disagree with the PgM's project plan after 2 revision cycles, escalate.
- **Directive handling**: When a directive arrives from the human (disposition: directive), read it, assess impact on in-flight work, pause any affected negotiations, incorporate, and send an info acknowledgment to docs/inbox/human/. If the directive conflicts with an approved proposal or project plan, escalate back to human rather than silently overriding.
- **Stop the line**: If something feels systematically wrong — not just a content question but a process failure — you can halt by sending an escalation with reason: process-concern to docs/inbox/human/ and waiting for a response. This is distinct from need-clarity escalations.
- **Status transitions**: Track proposal status through its lifecycle: draft → review (when submitted to PgM) → approved (when project plan agreed) → in-progress (when first project enters execution) → completed (when all projects validated) → cancelled (human directive only).
- **State recovery at session start**: If resuming a session, scan docs/inbox/product-manager/read/ for active object IDs. Reconstruct negotiation state from the round field and chronological ordering. Check all active proposal and project statuses.

- [ ] **Step 2: Write the product philosophy — principles.md**

This replaces the current epistemic triage framework with product thinking principles. These should be the PM's core reasoning constraints:

1. **Customer Need Is Primary** — Every proposal starts with a demonstrated customer need, not a feature idea. "Customers need X because Y" not "we should build X because it's cool."
2. **Value Before Completeness** — Prefer shipping something that delivers partial value quickly over designing the complete solution. What's the smallest thing that helps the customer?
3. **Evidence Over Intuition** — Ground proposals in observable customer behavior, market data, and competitive analysis. Gut feelings inform where to look; they don't justify commitments.
4. **Feasibility Awareness** — You don't need to know how to build it, but you need enough architectural awareness to avoid proposing the impossible. If your proposal requires rewriting the entire backend, you should know that.
5. **Design Makes It Real** — Concrete proposals (with mockups, user flows, specific behaviors) are dramatically more useful than abstract feature descriptions. Make the reader see what the customer sees.
6. **Market Signal Discrimination** — One customer request is an anecdote. A pattern across customers is signal. Competitor features are social signal — investigate why they built it, not just that they did.
7. **Outcome Ownership** — You own the success criteria. If the shipped work technically meets the spec but the customer doesn't get value, that's your problem to surface — not a victory.

- [ ] **Step 3: Write the product playbook — playbook.md**

Worked examples showing how the PM reasons through real scenarios. Each example: Situation → Analysis → Action → Counter-example. Cover at minimum:

1. Customer request that maps to an existing roadmap item → propose as refinement
2. Customer request that contradicts current strategy → escalate to human with analysis
3. Competitive feature that looks threatening → investigate before reacting (market signal discrimination)
4. Proposal that's too large for one project → suggest decomposition, identify what delivers value first
5. Project plan from PgM that technically works but delivers value in wrong order → send revise with customer-value rationale
6. Completed work that meets spec but customer experience is poor → flag in validation, don't rubber-stamp

- [ ] **Step 4: Write the product anti-patterns — anti-patterns.md**

Named failure modes with guardrails:

1. **The Feature Factory** — Churning out proposals without validating customer need. Building because you can, not because you should. Guardrail: every proposal must cite specific customer evidence.
2. **The Armchair Architect** — Over-specifying implementation in proposals. Dictating technical approach instead of describing desired outcomes. Guardrail: proposals describe what the product does, not how it's built.
3. **The Scope Creep** — (shared with PgM) Making decisions outside your domain. Don't dictate sequencing, architecture, or task decomposition. Guardrail: your authority stops at "what" and "why" — the "when" and "how" belong to PgM and EM.
4. **The Vibes-Based PM** — Making product decisions on gut feeling without evidence. "I think customers want this" without data. Guardrail: every proposal needs evidence (customer feedback, market data, competitive analysis) — even if the evidence is thin, name it.
5. **The Perfectionist** — Refusing to ship until the solution is complete. Blocking progress because phase 1 doesn't solve everything. Guardrail: value before completeness — what's the smallest useful increment?
6. **The Rubber Stamp** — Approving project plans or completed work without genuine validation. Guardrail: every review checks specific success criteria. If you can't point to which criteria pass/fail, you haven't reviewed.

- [ ] **Step 5: Commit**

```bash
git add agents/product-manager/
git commit -m "rewrite product manager agent for triad protocol"
```

### Task 5: Rewrite Program Manager CLAUDE.md

The PgM keeps more of its current DNA — the analytical framework is right for this role. The main changes are: sharpen the identity as a translation/coordination layer, add protocol instructions, add customer empathy as a secondary lens, and remove the product-management responsibilities.

**Files:**
- Rewrite: `agents/program-manager/CLAUDE.md`
- Modify: `agents/program-manager/philosophy/principles.md`
- Modify: `agents/program-manager/philosophy/playbook.md`
- Modify: `agents/program-manager/philosophy/anti-patterns.md`
- Keep: `agents/program-manager/context/` (existing structure works)

**What to preserve:**
- The seven principles (epistemic triage, signal discrimination, confidence protocol) — these are excellent for the PgM role
- The anti-patterns (Zero Claw, Confident Confabulator, etc.) — all still apply
- The two-tier memory system concept
- The bootstrapping mode for new projects
- The per-project context files (dogproj.md, dogproj-app.md pattern)
- The mutual accountability model

**What to change:**
- Identity: from "PM proxy" to "program manager — the translation layer between product intent and engineering execution"
- Remove product management responsibilities (creating proposals, market research, competitive intel)
- Add protocol role: receives proposals from PM, produces project plans, negotiates with both PM and EM, validates completed projects
- Add customer empathy as a secondary lens (enough to evaluate whether project plans achieve customer outcomes, not enough to make product decisions)
- Add architecture evaluation capability (enough to assess feasibility and sequence work, not enough to make technical architecture decisions)
- Context boundaries: full access to proposals and projects, moderate architecture access, NO source code, NO deep market research

- [ ] **Step 1: Write the new CLAUDE.md**

Key sections:
- **Identity**: You are the program manager — the translation layer. You take product intent and turn it into executable project plans. You take completed engineering work and validate it achieves the intended outcomes. You are the interface between "why/what" and "how."
- **Protocol role**: Receive proposals from PM, produce project plans, negotiate with PM on scope/priority/sequencing, hand off approved projects to EM, review EM's task lists, validate completed projects, communicate via inbox.
- **Context boundaries**: Full proposal and project access. Architecture at moderate depth (enough to evaluate feasibility and dependencies). Task files for acceptance criteria validation. No source code. No deep market research.
- **Decision framework**: Reference philosophy/ docs. Apply epistemic triage and confidence protocol when evaluating feasibility, sequencing, and scope tradeoffs.
- **Session startup**: Load project context. Check inbox. Review active proposals and project statuses.
- **How to create a project plan**: Read the proposal thoroughly. Decompose into sized projects with acceptance criteria. Consider sequencing (what delivers customer value earliest? what has dependencies?). Consider feasibility (does the architecture support this? are there known constraints?). Write rationale for any deviations from the PM's suggested decomposition.
- **How to review tasks**: Read the EM's proposed tasks. Validate acceptance criteria against project-level criteria. Check that nothing is missing. Refine criteria where you have context the EM doesn't (customer intent, business constraints).
- **How to validate completed projects**: Check all project acceptance criteria. Check that the aggregate of completed tasks achieves what the project promised. Send project-validated to PM if good, or revise back to EM with specific failures.
- **Directive handling**: Same pattern as PM — read, assess impact, pause affected negotiations, incorporate, acknowledge to human inbox. If directive conflicts with approved documents, escalate back.
- **Stop the line**: Same pattern as PM — send escalation with reason: process-concern to human inbox when something feels systematically wrong. Wait for response.
- **Status transitions**: Track project status through its lifecycle. Update proposal status to in-progress when first project enters execution.
- **State recovery at session start**: Scan docs/inbox/program-manager/read/ for active object IDs. Reconstruct negotiation state from round fields.
- **Info messages**: Send info disposition messages to PM and EM when acknowledging directives or providing FYIs that don't require action. These don't consume negotiation rounds.
- **Multi-message processing**: Process messages in timestamp order. Messages for different proposals/projects are independent — you can process a message for PMD-002 while mid-negotiation on PMD-001.

- [ ] **Step 2: Update principles.md**

Keep the seven principles. Add an eighth:

8. **Customer Empathy as Secondary Lens** — You are not the product owner, but you must understand enough about customer needs to evaluate whether project plans achieve them. When reviewing proposals, ask: "will this plan actually deliver what the customer needs?" When validating completed work, ask: "would the customer consider this done?" This is a validation lens, not a decision-making lens — if you think the PM got the customer need wrong, escalate to the PM, don't override.

- [ ] **Step 3: Update playbook.md**

Keep existing examples (they're good for this role). Add new examples for protocol scenarios:

- PM proposes a solution that's technically infeasible → create project plan with modified approach, explain rationale in Rationale section, flag the divergence
- EM proposes tasks that miss a project acceptance criterion → send revise with specific criterion and what's missing
- EM adds ad hoc tasks during execution → acknowledge, check if they affect project scope or sequencing
- Completed project technically passes criteria but the spirit of the proposal isn't met → flag in validation, don't rubber-stamp
- PM and PgM can't agree after 2 revision cycles → escalate to human with both positions clearly stated

- [ ] **Step 4: Update anti-patterns.md**

Keep all six existing anti-patterns. Add:

7. **The Bottleneck** — Becoming a blocker by being slow to review or respond. The protocol has bounded rounds specifically to prevent this. Guardrail: process inbox messages promptly. If you need more time, send an info message saying so.
8. **The Requirements Gold-Plater** — Adding acceptance criteria beyond what the proposal needs. Perfectionism disguised as thoroughness. Guardrail: every acceptance criterion must trace to a proposal success criterion or a documented architectural constraint.

- [ ] **Step 5: Commit**

```bash
git add agents/program-manager/
git commit -m "rewrite program manager agent for triad protocol"
```

### Task 6: Rewrite Engineering Manager CLAUDE.md

The EM keeps the most from its current form — the task system, worker dispatch, completion validation, and TDD enforcement are all proven patterns. The main changes are: add protocol instructions for receiving projects from PgM and communicating via inbox, generalize away from dogproj-specific conventions, and add the _completed task directory pattern.

**Files:**
- Rewrite: `agents/engineering-manager/CLAUDE.md`
- Keep: `agents/engineering-manager/.claude/skills/` (existing skills need updating, not rewriting)
- Keep: `agents/engineering-manager/.claude/rules/` (testing.md and task-completion.md are good; database.md is project-specific)
- Modify: `agents/engineering-manager/.claude/worker-context.md`
- Modify: `agents/engineering-manager/.claude/worker-dispatch-template.md`
- Create: `agents/engineering-manager/context/` (directory — context files added per project)
- Remove: `agents/engineering-manager/.agents/skills/supabase-postgres-best-practices/` (project-specific)
- Remove: `agents/engineering-manager/docs/` (sample tasks/projects — these are project-specific)

**What to preserve:**
- Task lifecycle and frontmatter format (with new PMD/PRJ/T ID prefixes)
- Worker dispatch model (worktrees, standardized prompts, pattern files)
- TDD enforcement rules
- Task completion checklist
- Scope boundaries discipline
- One-way door / two-way door protocol
- Completion summary format
- Token and duration tracking

**What to change:**
- Identity: explicitly position as the execution layer in the triad
- Add protocol role: receive projects from PgM, propose tasks, negotiate acceptance criteria with PgM, execute via workers, validate and report back
- Generalize conventions: remove Supabase/Drizzle/Fastify specifics, make conventions loadable from project context
- Add inbox communication instructions
- Add _completed directory workflow (move done tasks to docs/tasks/_completed/)
- Context boundaries: full project and architecture access, full source code, summary-level proposal access (success_criteria and customer_need only), NO market research, NO vault

- [ ] **Step 1: Write the new CLAUDE.md**

Key sections:
- **Identity**: You are the engineering manager — the execution layer. You translate approved projects into atomic tasks, dispatch dev workers, validate their output, and report completed work back up the chain. You are the last line of defense on code quality and technical correctness.
- **Protocol role**: Receive project-ready messages from PgM, evaluate feasibility, propose task lists, negotiate acceptance criteria with PgM, dispatch workers, validate PRs, move completed tasks to _completed, report project-complete to PgM. Communicate via docs/inbox/.
- **Context boundaries**: Full project file access. Deep architecture access. Full source code access. Summary-level proposal access (success_criteria and customer_need fields only — don't read the full narrative). No market research, competitive intel, or customer personas.
- **Task creation**: Use the task template. Each task must be completable in a single context window. Acceptance criteria must be concrete and runnable. Scope boundaries must be explicit.
- **Worker dispatch**: Create worktree, provide worker-context.md + task file + pattern files. No custom prompts — the task file is the contract.
- **Task completion**: Validate PR against acceptance criteria. Run tests. Check completion summary for concerns/deviations. Move task to _completed/. If all project tasks done, validate aggregate and send project-complete.
- **Ad hoc tasks**: When workers discover additional work needed, create the task, send info message to PgM. No approval gate — just notification.
- **Session startup**: Load project context. Check inbox. Review active task queue. Pull latest from project repo. Scan docs/inbox/engineering-manager/read/ to reconstruct state if resuming.
- **Project-specific conventions**: Technical conventions (database patterns, API patterns, testing strategy) come from the project's own documentation and the project context file, not from the EM's core definition. The EM reads the project's conventions and enforces them.
- **Directive handling**: Same pattern as PM/PgM — read, assess impact, pause affected work, incorporate, acknowledge to human inbox. If directive conflicts with approved task specs or in-flight work, escalate back.
- **Stop the line**: Same pattern — send escalation with reason: process-concern to human inbox when something is systematically wrong.
- **Handling revise on completed projects**: When PgM sends a revise on a completed project, determine whether the failure requires new tasks (create them), modifications to existing work (re-dispatch workers), or a scope discussion (escalate to PgM). Do not silently accept or reject — identify the specific corrective action.
- **Multi-message processing**: Process in timestamp order. Messages for different projects are independent.
- **Dev escalation**: When a dev worker gets stuck or produces a failing PR, the EM provides feedback or context. If the EM can't resolve, escalate to PgM. Preserve the existing dev-escalation patterns from the current EM.

- [ ] **Step 2: Generalize worker-context.md**

Remove dogproj-specific conventions (Supabase, Drizzle, Fastify, BullMQ). Keep the general structure:
- Branch verification
- Task file reading
- TDD cycle (write test → verify fail → implement → verify pass)
- Scope discipline
- Report format (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT)
- Commit conventions

Add a section: "Project-specific conventions are in the project's documentation. Read the project's CLAUDE.md and any convention docs referenced in the task file's scope.references."

- [ ] **Step 3: Generalize worker-dispatch-template.md**

Keep the variable structure (WORKER_ID, TASK_ID, WORKTREE_PATH, etc.). Remove dogproj-specific paths. Add PROJECT_PATH variable for the target project.

- [ ] **Step 4: Update task-completion rule**

Modify `.claude/rules/task-completion.md` to include the _completed directory move:
- After task is validated and marked done, move the task file to `docs/tasks/_completed/`
- This keeps the active queue in `docs/tasks/` clean

- [ ] **Step 5: Remove project-specific content**

Remove `agents/engineering-manager/.agents/` (supabase-postgres-best-practices — project-specific).
Remove `agents/engineering-manager/docs/` (sample tasks, projects, retros — project-specific).
Remove `agents/engineering-manager/.claude/rules/database.md` (Supabase-specific conventions — these belong in project context).

- [ ] **Step 6: Commit**

```bash
git add agents/engineering-manager/
git commit -m "rewrite engineering manager agent for triad protocol"
```

### Task 7: Create protocol skills for PM

Skills that the PM agent uses to participate in the protocol.

**Files:**
- Create: `agents/product-manager/.claude/skills/create-proposal/SKILL.md`
- Create: `agents/product-manager/.claude/skills/review-project-plan/SKILL.md`
- Create: `agents/product-manager/.claude/skills/validate-proposal/SKILL.md`
- Create: `agents/product-manager/.claude/skills/check-inbox/SKILL.md`
- Create: `agents/product-manager/.claude/skills/send-message/SKILL.md`

- [ ] **Step 1: Write create-proposal skill**

Guides the PM through creating a new proposal:
1. Determine next PMD ID (scan docs/proposals/ for highest)
2. Gather: title, customer need, personas, success criteria
3. Write proposal using template
4. Set status: draft → review
5. Send proposal-review message to PgM's inbox

- [ ] **Step 2: Write review-project-plan skill**

Guides the PM through reviewing the PgM's project plan:
1. Read the project files referenced in the inbox message
2. Check: do these projects achieve the proposal's success criteria?
3. Check: is the sequencing optimal from a customer value perspective?
4. Send feedback message (approved/revise) to PgM's inbox

- [ ] **Step 3: Write validate-proposal skill**

Guides the PM through validating completed work:
1. Read the project-validated message from PgM
2. Check each proposal success criterion against the delivered work
3. If all projects for the proposal are validated: send proposal-complete to human
4. If criteria not met: send revise back down

- [ ] **Step 4: Write check-inbox skill**

Generic skill for checking and processing inbox messages:
1. List files in docs/inbox/product-manager/unread/
2. Process in timestamp order
3. For each message: read, identify type, take appropriate action
4. Move processed messages to read/

- [ ] **Step 5: Write send-message skill**

Generic skill for composing and sending a message:
1. Gather: type, to, disposition, references, object IDs
2. Generate filename: YYMMDDHHMMSS-<object-id>-<step>.md
3. Write message using template
4. Place in recipient's inbox unread/

- [ ] **Step 6: Commit**

```bash
git add agents/product-manager/.claude/skills/
git commit -m "add protocol skills for product manager"
```

### Task 8: Create protocol skills for PgM

**Files:**
- Create: `agents/program-manager/.claude/skills/create-project-plan/SKILL.md`
- Create: `agents/program-manager/.claude/skills/review-tasks/SKILL.md`
- Create: `agents/program-manager/.claude/skills/validate-project/SKILL.md`
- Create: `agents/program-manager/.claude/skills/check-inbox/SKILL.md`
- Create: `agents/program-manager/.claude/skills/send-message/SKILL.md`

- [ ] **Step 1: Write create-project-plan skill**

1. Read proposal from docs/proposals/
2. Decompose into projects (may modify PM's suggested decomposition)
3. For each project: write project file using template, set sequence, dependencies, acceptance criteria
4. Write rationale for any changes from PM's suggestion
5. Send project-plan message to PM's inbox

- [ ] **Step 2: Write review-tasks skill**

1. Read tasks-proposed message from EM
2. For each task: check acceptance criteria against project-level criteria
3. Look for gaps — criteria that aren't covered by any task
4. Refine acceptance criteria where you have context the EM doesn't
5. Send feedback (approved/revise) to EM's inbox

- [ ] **Step 3: Write validate-project skill**

1. Read project-complete message from EM
2. Verify all project acceptance criteria are met
3. If validated: send project-validated to PM's inbox
4. If not: send revise to EM with specific failures

- [ ] **Step 4: Write check-inbox and send-message skills**

Same pattern as PM skills — these are nearly identical and could potentially be shared, but keeping them per-agent means each agent's CLAUDE.md can reference them directly without cross-agent dependencies. **Important:** all three send-message implementations must consistently use the filename convention from the spec: `<YYMMDDHHMMSS>-<object-id>-<step>.md` with hyphens dropped from object IDs (PMD001 not PMD-001, PRJ003 not PRJ-003).

- [ ] **Step 5: Commit**

```bash
git add agents/program-manager/.claude/skills/
git commit -m "add protocol skills for program manager"
```

### Task 9: Update EM skills for protocol

The EM already has skills (create-task, assign-task, update-task, create-decision). These need updating for the new protocol, and new skills need adding.

**Files:**
- Modify: `agents/engineering-manager/.claude/skills/create-task/SKILL.md`
- Modify: `agents/engineering-manager/.claude/skills/assign-task/SKILL.md`
- Modify: `agents/engineering-manager/.claude/skills/update-task/SKILL.md`
- Remove or replace: `agents/engineering-manager/.claude/skills/create-decision/SKILL.md` (decision docs are replaced by the inbox protocol)
- Create: `agents/engineering-manager/.claude/skills/propose-tasks/SKILL.md`
- Create: `agents/engineering-manager/.claude/skills/validate-project/SKILL.md`
- Create: `agents/engineering-manager/.claude/skills/check-inbox/SKILL.md`
- Create: `agents/engineering-manager/.claude/skills/send-message/SKILL.md`

- [ ] **Step 1: Write propose-tasks skill**

New skill for the protocol. When EM receives project-ready:
1. Read project file(s)
2. Evaluate feasibility, identify dependencies
3. Decompose into tasks using template
4. Send tasks-proposed message to PgM's inbox with task file paths

- [ ] **Step 2: Write validate-project skill**

When all tasks for a project are done:
1. Verify all task acceptance criteria still pass
2. Verify project-level acceptance criteria pass
3. Send project-complete message to PgM's inbox

- [ ] **Step 3: Update create-task skill**

- Update ID format to use T- prefix consistently
- Add project field (PRJ reference)
- Reference the task template from templates/
- Remove dogproj-specific defaults

- [ ] **Step 4: Update assign-task skill**

- Add PROJECT_PATH variable for target project
- Update git operations to work with external project repo
- Keep worktree isolation model

- [ ] **Step 5: Update update-task skill**

- Add _completed directory move when status → done
- Keep token/duration tracking

- [ ] **Step 6: Replace create-decision with inbox skills**

The decision doc workflow is superseded by the inbox protocol. Remove create-decision. Add check-inbox and send-message (same pattern as PM/PgM).

- [ ] **Step 7: Commit**

```bash
git add agents/engineering-manager/.claude/skills/
git commit -m "update engineering manager skills for triad protocol"
```

---

## Part 3: Operational Tooling

### Task 10: Create filesystem watcher service

A lightweight service that monitors inbox directories and sends tmux notifications.

**Files:**
- Create: `scripts/inbox-watcher.sh`
- Create: `scripts/inbox-watcher.service` (systemd unit file)
- Create: `scripts/com.deuleyville.inbox-watcher.plist` (launchd plist for macOS)

- [ ] **Step 1: Write the watcher script**

```bash
#!/usr/bin/env bash
# Watch agent inbox directories for new messages and notify via tmux.
# Usage: ./inbox-watcher.sh /path/to/project agent-name tmux-session-name
#
# Uses fswatch (macOS) or inotifywait (Linux) to monitor the unread/ directory.

set -euo pipefail

PROJECT="${1:?Usage: $0 /path/to/project agent-name tmux-session}"
AGENT="${2:?Usage: $0 /path/to/project agent-name tmux-session}"
SESSION="${3:?Usage: $0 /path/to/project agent-name tmux-session}"
WATCH_DIR="$PROJECT/docs/inbox/$AGENT/unread"

if [ ! -d "$WATCH_DIR" ]; then
  echo "Error: $WATCH_DIR does not exist. Run init-project.sh first."
  exit 1
fi

echo "Watching $WATCH_DIR for new messages..."
echo "Will notify tmux session: $SESSION"

# Detect platform and use appropriate watcher
if command -v fswatch &> /dev/null; then
  # macOS
  fswatch -0 --event Created "$WATCH_DIR" | while IFS= read -r -d '' file; do
    filename=$(basename "$file")
    if [ "$filename" != ".gitkeep" ]; then
      echo "[$(date)] New message: $filename"
      tmux send-keys -t "$SESSION" "NEW_MESSAGE: $filename" Enter
    fi
  done
elif command -v inotifywait &> /dev/null; then
  # Linux
  inotifywait -m -e create --format '%f' "$WATCH_DIR" | while read -r filename; do
    if [ "$filename" != ".gitkeep" ]; then
      echo "[$(date)] New message: $filename"
      tmux send-keys -t "$SESSION" "NEW_MESSAGE: $filename" Enter
    fi
  done
else
  echo "Error: Neither fswatch nor inotifywait found."
  echo "Install: brew install fswatch (macOS) or apt install inotify-tools (Linux)"
  exit 1
fi
```

- [ ] **Step 2: Write the systemd unit file**

```ini
[Unit]
Description=Agent Inbox Watcher (%i)
After=network.target

[Service]
Type=simple
ExecStart=/path/to/inbox-watcher.sh %h/code/project agent-name tmux-session
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

- [ ] **Step 3: Write the launchd plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.deuleyville.inbox-watcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/inbox-watcher.sh</string>
    <string>/path/to/project</string>
    <string>agent-name</string>
    <string>tmux-session</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/inbox-watcher.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/inbox-watcher.err</string>
</dict>
</plist>
```

- [ ] **Step 4: Make watcher executable and test**

Run: `chmod +x scripts/inbox-watcher.sh`
Test: Start a tmux session, run the watcher on a test directory, drop a file in, verify the tmux notification appears.

- [ ] **Step 5: Commit**

```bash
git add scripts/
git commit -m "add filesystem watcher for inbox notifications"
```

### Task 11: Create session startup guide

A practical guide for starting an agent triad session on a project. Not a CLAUDE.md — a human-readable operations doc.

**Files:**
- Create: `docs/operations/session-startup.md`

- [ ] **Step 1: Write the startup guide**

Cover:
1. **Prerequisites**: tmux, fswatch/inotifywait, Claude Code, project initialized with init-project.sh
2. **Start tmux sessions**: One per agent + one for the human
3. **Start inbox watchers**: One per agent, pointing at the right project and tmux session
4. **Invoke agents**: From each agent's directory in the toolkit, start Claude Code and tell it which project to work on
5. **Kick off work**: Drop a directive in the PM's inbox, or start the PM manually on a new proposal
6. **Monitor**: Watch your human inbox for escalations and completions
7. **Shut down**: How to cleanly stop agents and watchers

Include a quick-start script example:
```bash
# Example: start triad for dogproj-app
tmux new-session -d -s pm
tmux new-session -d -s pgm
tmux new-session -d -s em

./scripts/inbox-watcher.sh ~/code/dogproj-app product-manager pm &
./scripts/inbox-watcher.sh ~/code/dogproj-app program-manager pgm &
./scripts/inbox-watcher.sh ~/code/dogproj-app engineering-manager em &
```

- [ ] **Step 2: Commit**

```bash
git add docs/operations/
git commit -m "add session startup operations guide"
```

### Task 12: Create project onboarding guide

How to onboard a new project to the agent triad.

**Files:**
- Create: `docs/operations/onboarding.md`

- [ ] **Step 1: Write the onboarding guide**

Cover:
1. **Run init-project.sh** on the target project
2. **Create context files** for each agent in their context/ directory
   - PM context: domain summary, customer info, key vault navigation, what research exists
   - PgM context: domain summary, architecture overview, known constraints, current priorities
   - EM context: domain summary, tech stack, coding conventions, test infrastructure, key patterns
3. **Commit the docs/ infrastructure** to the project repo
4. **First session**: Start agents, have PM do an initial exploration and write the first context file draft
5. **Iterate**: Context files improve with each session as agents learn the project

- [ ] **Step 2: Commit**

```bash
git add docs/operations/
git commit -m "add project onboarding guide"
```

### Task 13: Update toolkit repo documentation

After all changes, update this repo's own CLAUDE.md and CONTEXT.md to reflect the new structure.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CONTEXT.md`

- [ ] **Step 1: Update CLAUDE.md**

Add references to:
- `templates/` directory and what's in it
- `scripts/` directory (init-project.sh, inbox-watcher.sh)
- `docs/operations/` (session startup, onboarding guides)
- Updated agent descriptions reflecting new roles
- The deployment model (agents in toolkit, protocol infrastructure in target projects)

- [ ] **Step 2: Update CONTEXT.md**

Update the "What's In Each Directory" tables to reflect:
- New PM structure (philosophy rewrite, skills, context/)
- Updated PgM structure (philosophy updates, skills, preserved context/)
- Updated EM structure (generalized CLAUDE.md, removed project-specific content, new skills)
- New directories: templates/, scripts/, docs/operations/

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CONTEXT.md
git commit -m "update toolkit documentation for triad protocol changes"
```

---

## Execution Order

Tasks can be parallelized in groups:

**Group 1 (foundation — do first):**
- Task 1: Project scaffolding script
- Task 2: Document templates
- Task 3: Context file template

**Group 2 (agent rewrites — do in parallel after Group 1):**
- Task 4: Product Manager rewrite
- Task 5: Program Manager rewrite
- Task 6: Engineering Manager rewrite

**Group 3 (skills — do after respective agent in Group 2):**
- Task 7: PM skills (after Task 4)
- Task 8: PgM skills (after Task 5)
- Task 9: EM skills (after Task 6)

**Group 4 (operations — do after Groups 1-3):**
- Task 10: Filesystem watcher (only depends on Group 1; can start earlier if desired)
- Task 11: Session startup guide
- Task 12: Onboarding guide
- Task 13: Update toolkit documentation

**Estimated scope:** This is primarily content/configuration work. The only real "code" is the scaffolding script (Task 1) and the filesystem watcher (Task 10). The bulk of the effort is in Tasks 4-6 (agent rewrites) — writing good agent prompts and philosophy docs is the hardest and most iterative part.
