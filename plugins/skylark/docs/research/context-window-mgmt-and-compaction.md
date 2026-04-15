2026-04-15
---

# Surviving the 1M-token gauntlet: context engineering for long agentic pipelines

**The single most important finding is that compaction is now understood to be the wrong default for multi-stage pipelines.** The state of the art in early 2026 has converged on a clear principle: **split into short-lived workers with disk-persisted handoff artifacts, not one long session that summarizes its way forward.** Amp (Sourcegraph) publicly retired compaction in favor of clean thread handoffs. Anthropic's own harness research prescribes multiple context windows by design. Cognition (Devin) fine-tunes dedicated compression models rather than relying on the same frontier model to both summarize and reason. For a pipeline like Skylark—14 stages, elevated-risk runs consuming the full 1M window—the path forward is to make the orchestrator a near-stateless router that never touches substantive reasoning, push all work into subagents with curated context, and treat disk artifacts as the system of record rather than the conversation history.

## TL;DR

- **Stop fighting compaction; avoid it entirely.** Restructure Skylark so no single agent session exceeds ~60% of the context window. Quality degrades measurably at 60% utilization—well before auto-compaction fires at 75–95%. After 3–4 compactions, critical context is lost and compaction summaries can hallucinate instructions that never existed.
- **Make the orchestrator a state machine, not a thinker.** Hold only a YAML state file, artifact pointers, and a stage-transition table in the orchestrator. Delegate ALL substantive reasoning (brainstorm, spec-review, develop) to short-lived subagents that start with curated context and return structured artifacts to disk.
- **Use disk artifacts as the canonical context, not conversation history.** Write every stage output to a versioned file with YAML frontmatter. On resume or after compaction, the system rebuilds context by reading artifacts from disk—never from conversation memory. Anthropic's own "effective harnesses" pattern uses `claude-progress.txt` + JSON feature lists + `git log` as the ground truth.
- **Split the pipeline at natural phase boundaries.** Run research/planning and implementation in separate sessions (the RPI pattern). Each session starts fresh, reads the prior stage's artifact, and produces its own. Handoff files should contain: completed tasks with commit hashes, pending tasks, key decisions with rationale, modified file paths, and next steps.
- **Prompt caching is NOT retained across subagent dispatches** in Claude Code today (GitHub issue #29966, `enablePromptCaching` hardcoded to `false` for subagent API calls). This means every subagent invocation pays full input pricing on ~7,000+ tokens of tools/system prompt. Plan subagent boundaries accordingly: fewer, chunkier subagent calls beat many tiny ones.

---

## 1. Context-window engineering for long agentic runs

### Current consensus

The field has moved from "how do I fit everything in the context window" to "how do I keep the context window as empty as possible." Multiple independent practitioners report that **output quality degrades at ~60% context utilization**—not at the token limit, but much earlier, due to attention dilution across long contexts. The 1M-token window on Opus 4.6 / Sonnet 4.6 (GA, unified pricing, no long-context premium) buys breathing room but does not solve the fundamental problem: more context means dimmer focus. A focused 300-token context often outperforms an unfocused 113,000-token context.

<PD_Comment>This is interesting because Christy and I have so commonly seen this degradation happening between 20% and 30%. I think it's maybe a difference in the degradation of language-specific jobs; for instance, writing seems to degrade when mixed with code work in that 20% to 30% window. 

I wonder if you can get up to 60% if it is a code-only task. I have definitely seen workers that have been running long windows—where 30% to 40% of the context is all code—and you can see the degradation of their prose output very directly. 

They start returning content in extremely clipped sentences that are distilled down to just functional parts. That makes sense if you think about it: if most of their context window is full of code, they aren't necessarily struggling, but are instead naturally drawing their attention toward code-like output. I guess my takeaway there is that there is probably something around wanting to make sure that there is isolation between modes of content.

So, prose content, task content, and code content probably all need to have separate layers in the management stack.</PD_Comment>

Claude Code implements a **four-layer compaction pipeline** that runs at the start of every iteration: (1) **Snip**—drops entire older messages, (2) **Microcompact**—replaces bulky tool results with `[Old tool result content cleared]` while keeping call structure, (3) **Context Collapse**—LLM-summarizes older message segments (triggers non-blocking at 90%, blocking at 95%), and (4) **Autocompact**—summarizes the entire conversation as a last resort. Microcompaction is cache-aware, using `pendingCacheEdits` applied at the API layer. Autocompact has a circuit breaker: after 3 consecutive failures, it stops trying—added after a production incident wasting ~250K API calls/day.

### Concrete techniques

**Context offloading to disk vs. /compact vs. subagent isolation.** These serve different purposes. Disk offloading (writing to `SCRATCHPAD.md`, `progress.md`, or structured artifact files) is the right tool when you need context to **survive across sessions or compaction boundaries**—it's the only truly persistent store. `/compact` is appropriate when you've finished a logical subtask and want to reclaim space while staying in the same session—always run it proactively at 60–70% capacity with preservation instructions (e.g., `/compact preserve the modified file list, current test failures, and the auth refactoring plan`). Subagent isolation is the right tool when work is **self-contained and the parent doesn't need the intermediate reasoning**—the subagent's tool calls, file reads, and exploratory work never touch the parent's context.

**Prompt caching architecture.** Claude Code's system prompt (~8,700 tokens) is cached after the first turn via prompt caching—essentially free for subsequent turns. The cache structure is: system prompt → tool definitions → CLAUDE.md → conversation history (static prefix → dynamic suffix). Cache TTL is 5 minutes by default, refreshed on each hit; **1-hour extended TTL** costs 2x base input price and is specifically designed for agentic workflows where side-agents take >5 minutes. Cache read tokens cost **0.1x base price** (90% discount). Critical invalidation risks: adding/removing an MCP tool, putting timestamps in system prompts, switching models mid-session, or changing tool schemas. The Manus team's lesson applies directly: keep the prompt prefix stable, make context append-only, and **mask tools rather than removing them** to avoid breaking the KV-cache.

**Subagent caching gap.** GitHub issue #29966 documents that subagent API calls have `enablePromptCaching` **hardcoded to `false`**, meaning every subagent invocation pays full uncached input pricing on 7,000+ tokens of tools and system prompt. Caches are also per-model: Opus and Haiku have separate caches even with identical prompts. One practitioner works around this with a local reverse proxy that injects `cache_control` breakpoints into subagent requests. This is a significant cost consideration for Skylark, where heavy subagent use across 14 stages means substantial uncached overhead.

**The "Dev Docs" checkpointing pattern.** A practitioner-tested workflow maintains three files: `dev/plan.md`, `dev/context.md`, and `dev/tasks.md`. Before compaction, a custom `/update-dev-docs` command saves current state. After compaction, saying "continue" causes Claude to read the dev docs automatically and resume with full context. This is paired with automation hooks: `UserPromptSubmit` activates skills, `PostToolUse` tracks file edits, and a `Stop` hook runs builds. For Skylark, this maps directly to writing each stage's output to artifact files with YAML frontmatter before transitioning to the next stage.

**Handoff documents as lightweight session bridges.** One developer maintains a `~/.claude/handoffs/` directory with 49+ handoff documents from multi-session tasks. Starting a new session with `claude -c` (continue) or reading the handoff document provides full context at minimal token cost. The key insight: "PRD-4 required understanding decisions from PRDs 1-3. Without the handoff, the new session would have needed to re-read all modified files."

### Counter-evidence

Cursor's approach diverges from the compaction-avoidance consensus. Cursor trains **RL-optimized self-summarization models** that compress context from 5,000+ to ~1,000 tokens, claiming 50% fewer compaction errors than naive summarization. Their "Dynamic Context Discovery" architecture writes long tool responses to files (the agent can `tail` or `grep` them later), saves chat history as files during summarization (so the agent can search through history to recover details missing from the summary), and loads skills dynamically by name alone. An A/B test showed **46.9% reduction in total agent tokens** when MCP tool descriptions were deferred to folders. This suggests that if you invest in custom summarization models (rather than using the frontier model for both reasoning and summarization), compaction can work—but this is beyond what most teams can build.

Aider takes the most radical position: **no compaction at all.** It rebuilds context from scratch every request using a graph-ranked repository map (tree-sitter ASTs + PageRank on file dependencies). This avoids all compaction pathologies but limits Aider to short, stateless interactions rather than long-running pipelines.

<PD_Comment>My hunch is that you can actually achieve this same end result of no compaction at all and still have long-running pipelines. At least the orchestrator can have a long-running pipeline by using a task model that ensures the tasks are small enough that each one can be dispatched individually.

From that perspective, what we are really looking at is starting from the bottom-most layer: the task. We must ensure that each task can be accomplished by a worker within a single context window. 

Then, if you assume that those workers are being managed by an orchestrator who can oversee them in a single context window across an epoch—and those, in turn, are being managed by a higher-level orchestrator which can manage the orchestrators below them—it becomes a matter of context engineering.

However, it is context engineering in another dimension. Instead of working across the dimension of context window to context window inside of a single worker, it is context engineering across a series of tasks—breaking each task down into the minimal amount required for it to be managed at that specific layer.</PD_Comment>


---

## 2. The thin orchestrator that only holds pointers

### Current consensus

The orchestrator-worker split is now the dominant architecture across all major agent frameworks, but the specific topology varies. Claude Code, OpenAI Codex, and Cline all implement variants of hub-and-spoke delegation where a parent agent spawns short-lived workers via isolated context windows. The key debate is whether the orchestrator should itself be an LLM (Claude Code Agent Teams, Codex manager agent) or a deterministic state machine (the "thin orchestrator" ideal). **No production system has fully achieved the deterministic-orchestrator ideal**—even Claude Code's Agent Teams use LLM reasoning for synthesis and coordination decisions. But the direction is clear.

<PD_Comment>I don't think the deterministic orchestrator ideal mentioned above is really that big of a problem.

If you consider the amount of discretion that should be required for a very straightforward, pre-planned flow, I think the right approach is actually to use an agent—but have an agent that follows an extremely specific and direct plan. This allows it to pivot or identify when things are slight mismatches.

Using this method allows for "fuzziness" in the workstream in terms of whether or not words match up perfectly in a flow. This helps to reduce edge cases—for example, if a PR is named incorrectly, but the name still carries the right information.

Even if it is just a slight deviation from the pattern, writing all of the deterministic code that would be required to ensure conformity is far more work than relying on even a middle-complexity agent like Sonnet.
</PD_Comments>

### Concrete architectures

**Claude Code Agent Teams** (experimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, requires v2.1.32+) come closest to the thin-orchestrator vision. One session acts as Team Lead, coordinating work and assigning tasks via a **shared task list with DAG-based dependency tracking**. Teammates are independent Claude Code instances with their own context windows, and unlike subagents, they can **communicate directly with each other** via peer-to-peer messaging. When a teammate completes a task that others depend on, blocked tasks auto-unblock. Teams and tasks are stored locally in `~/.claude/teams/{team-name}/config.json`. The key difference from basic subagents: subagents are parent-child only with no inter-worker communication; Agent Teams enable peer-to-peer messaging and shared state.

**Claude Code Tasks** (v2.1.16+, April 2026) adds filesystem-persisted DAGs for dependency tracking. Tasks are written to `~/.claude/tasks` (not a cloud database), so users can run `/clear` or `/compact` to free tokens without losing the project roadmap. The `TaskCreate` and `TaskUpdate` operations support `addBlockedBy` for dependency chains, and multiple sessions can coordinate on the same task list via shared environment variables. This is the closest to Skylark's artifact-based state management and could directly replace a custom state machine.

**ComposioHQ/agent-orchestrator** provides an agent-agnostic orchestration layer (supports Claude Code, Codex, and Aider) where each agent gets its own git worktree, branch, and PR. What makes it distinctive is its **reactive CI loop**: when CI fails, the agent automatically receives logs and fixes the issue; when a reviewer requests changes, the agent addresses them. Configuration is YAML-based (`agent-orchestrator.yaml`), and the system has 7 plugin slots. This is the most "thin orchestrator" of the production systems—the YAML configuration acts as a deterministic state machine, with LLM reasoning confined entirely to individual agents.

**safethecode/orc** implements a full pipeline with distinct roles: Decomposer → Router → Scheduler (DAG) → parallel Workers (isolated worktrees) → Supervisor (stuck detection) → QA Agent. It detects 8 domains (frontend, backend, database, auth, testing, devops, docs, security) and routes work accordingly. Doom-loop detection and a shell command safety classifier are built in. This maps well to Skylark's risk-routing concept.

**Claude Squad** (smtg-ai/claude-squad, ~6K GitHub stars) takes the simplest approach: the **human is the orchestrator**. It provides tmux-based isolated terminal sessions with git worktrees for each agent, a TUI for navigation, and agent-agnostic support (Claude Code, Codex, Gemini, Aider, Amp). No AI-level coordination—the developer manages task assignment and result integration manually. For Skylark, this could work as a low-overhead way to run independent stages in parallel without building custom orchestration.

### Failure modes

Cognition (Devin) has been the loudest critic of multi-agent architectures. Walden Yan's "Don't Build Multi-Agents" manifesto (June 2025) identifies the core failure: **parallel agents making independent implicit decisions that conflict**. In their Flappy Bird example, one subagent builds a Super Mario-style background while another builds a non-game-asset bird—neither has context of the other's design decisions. Cognition advocates a single-threaded linear agent with fine-tuned compression models for long contexts.

<PD_Comment>I wonder if we could use a pattern like emitting a work log or decision log for the other agents. In this scenario, at each step, they would emit those logs to the OpenTelemetry (OTEL) system. At the start of each turn, they would automatically be injected with the work logs from the other concurrent agents. This would ensure they are aware of the events happening around them, allowing them to either pivot a design choice or raise an escalation if something is conflicting. Alternatively, they could simply send a message to the other worker instead.</PD_Comment>

The MAST paper (arXiv:2503.13657) provides a formal taxonomy: inter-agent misalignment accounts for the plurality of failures, with **mismatches between reasoning and action** at 13.2%, **task derailment** at 7.4%, and **proceeding with wrong assumptions** at 6.8%. The paper also documents **withholding crucial information** (0.85%)—workers returning technically valid but contextually incomplete results.

Production reports add practical failure modes: **orchestrator as bottleneck** (if the orchestrator's LLM call takes 3 seconds and 20 workers wait, throughput caps at ~6.7 tasks/second), **state synchronization failures** (Worker A completes and updates state; Worker B begins on stale information), and **token cost explosion** (costs scale quadratically with handoffs in sequential chains—a 50-message thread with 4 handoffs means the 5th agent processes ~200 messages). Addy Osmani's "Code Agent Orchestra" talk (O'Reilly AI CodeCon, March 2026) adds **quality compound decay**: "Small harmless mistakes—a code smell here, a duplication there—compound at a rate that's unsustainable" across an orchestrated army of agents.

For Skylark specifically, the most relevant failure mode is **context loss at handoff boundaries**—information fidelity erodes with each compression/handoff hop. This is the "game of telephone" effect that Cognition warns about, and it's exactly what happens when auto-compaction fires 3–6 times in a critical-risk run.

<PD_Comment>My suspicion is that there's potentially a strategy here which effectively looks like waterfall planning. If you can ensure that the waterfall plan has a strong dependency mapping chain that has been justified with solid evidence, you should be able to minimize concurrent workstreams by having very clear blockers the entire way up and down the tree of issues that need to be completed. (Let’s not use the term "work tree" since that is a Git term).

By doing this pre-planning, and then looking at justification along the way, I think we could potentially consider a different approach entirely to how these things are structured. We could start at the highest layer and break it down until that work is small enough that it can be completed without any need for context handoffs from issue to issue.

In this model, there is always a DAG-like pipeline that is effectively followed, where every issue has an issue that obviously follows it. It seems like a structure we could probably encode.</PD_Comment>

---

## 3. Streaming intermediate artifacts without sacrificing review gates

### Current consensus

The field has split into two camps: **synchronous inline review** (Cursor, Claude Code in interactive mode) where the user watches changes form in real-time, and **asynchronous checkpoint review** (Devin, Cursor Background Agents, Codex) where the agent works autonomously and produces artifacts for later inspection. For a pipeline like Skylark, the right model is a hybrid: autonomous execution within each stage, with **mandatory review gates at stage boundaries**.

### Concrete techniques

**The RPI (Research-Plan-Implement) methodology** (GitHub: mmanzini/rpi-methodology, April 2026, v0.1) provides the most structured approach. Each phase runs in a **fresh context window** with human validation gates between phases: **FAR validation** (Factual, Actionable, Relevant) after Research, and **FACTS validation** (Feasible, Atomic, Clear, Testable, Scoped) after Plan. Markdown checkboxes in plan files allow the agent to resume from exactly where it left off if context fills mid-implementation. Originally from HumanLayer (Dexter Horthy, 2024), adopted by Block's Goose tool. For Skylark, this maps directly to review gates between brainstorm→spec-review and write-plan→plan-review.

<PD_Comment>Yeah, this sounds like a good thing to come back and apply to our methodology. This aligns closely with what we're doing, but it adds a more concrete validation layer to determine whether or not the current plan is appropriate.</PD_Comment>

**Claude Code's stream-JSON chaining** enables piping one Claude instance's output directly into another via `--output-format stream-json` and `--input-format stream-json`. Each agent's output is immediately visible and consumable by the next stage. Combined with the Agent SDK's `StreamEvent` messages (which include `parent_tool_use_id` for tracking which subagent generated which output), this enables real-time visibility into multi-stage pipelines. Skylark could expose each stage's output as a streaming JSON pipe, with a lightweight UI rendering partial results.

**Cursor Hooks** provide a deterministic mechanism for checkpoint automation. The "grind" pattern uses a stop hook to keep agents iterating until tests pass (with a `MAX_ITERATIONS` cap). More relevantly for Skylark, hooks can auto-format after edits, gate dangerous commands, and add commit checkpoints at stage boundaries. Claude Code's equivalent (`PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, Stop hooks) enables the same pattern: write a hook that commits + writes a stage summary artifact at each stage transition.

**Devin's `notes.txt` pattern** is simpler but effective: Devin maintains a `notes.txt` file that logs its thinking during work, serving as both memory and user-visible artifact. This is the asynchronous version of incremental output—the user can check `notes.txt` at any time to see where the agent is. For Skylark, each stage could append to a running `pipeline-log.md` that serves as both the user's visibility mechanism and the system's recovery artifact.

<PD_Comment>This could be interesting because you could combine this with `notes.text` as a pattern during the worker's lifetime. Assuming that everything ends in a Pull Request (PR), you could maintain those notes between when the process starts and when it ends as individual notes per worker. These would then get pulled into a combined `notes.text` that simply appends each time.

It doesn't even necessarily need to be read by the orchestrator, though it could be used for troubleshooting. Each worker would just append to its own `notes.text`, and at the end of the process, that data can be appended to a comment submitted to GitHub. Instead of being captured by the PR directly, it could also be written as an issue note.

Otherwise, I don't know—there are a number of ways we could approach this. Effectively, we can have that local scratchpad quite easily and still capture it throughout the process if we wanted to.</PD_Comment>

### Counter-evidence

The Codegen team (codegen.com) argues that AI code review should serve as a **pre-human-review filter pass**: run 5–10 agents in parallel, each producing commits and PRs in sandboxed environments, then use an AI reviewer to filter before human review. This reduces the human review burden but introduces a dependency on review agent quality. Their finding: CI catches ~15% of agent-generated bugs, but review agents catch an additional ~30% that CI misses.

---

## 4. Auto-compaction degrades quality and can hallucinate

### Current consensus

Auto-compaction is a **necessary evil that should be avoided by design, not relied upon as a feature.** The empirical evidence is consistent across multiple independent sources: quality degrades at 60% utilization, compaction summaries retain only ~20–30% of original detail (focusing on "what happened" while losing "why"), and **after 3–4 compactions critical context may be lost entirely.** More alarmingly, GitHub issue #46602 documents that compaction summaries can **fabricate user instructions that never existed**, which the post-compaction agent then executes as if real. This is a model-faithfulness regression, not a summarization quality issue.

### Empirical evidence

Blake Crosley measured across **50 Claude Code development sessions** and found that output quality degrades at ~60% context utilization, with symptoms including forgetting earlier instructions, repeating rejected suggestions, missing established patterns, and producing less coherent multi-file changes. "A session that started with precise multi-file edits across 8 Python modules degraded into single-file tunnel vision by the 90-minute mark."

Multiple independent reports confirm that post-compaction retention is roughly **20–30% of original detail**. Summaries focus on "what happened" and lose "why" and subtle architectural decisions. The first task after compaction typically goes fine; problems emerge when referencing earlier decisions, patterns, or modified files.

One developer observed that auto-compaction now triggers at ~75% rather than the original 90%+ threshold—Anthropic appears to have progressively pushed the threshold down to preserve more working memory. The working hypothesis: old behavior hit 90% → ran out mid-task → forced compact → lost context; new behavior hits 75% → room for current task → completes it → then compacts with full understanding.

### What survives vs. what's lost

High-level task descriptions, general decisions, overall progress, and task completion status typically survive compaction. What's lost: specific file paths modified, error messages and stack traces, debugging state and hypotheses, exact code changes made, and the rationale behind architectural decisions. For Skylark, this means that early-stage intent (triage reasoning, risk assessment rationale, brainstorm options considered-and-rejected) is exactly the kind of "why" information that compaction drops.

### Known bugs

The most severe: Issue #3274 reports auto-compaction failure **permanently corrupting context management**—context stuck at "102%" regardless of actual conversation length, with even a simple "hi" triggering minutes of auto-compaction. Issue #25620 documents that when context reaches 100%, `/compact` itself fails because there's no reserved buffer for the compaction operation. Issue #41984 reports premature/aggressive compaction—firing at <10% usage, creating infinite compaction loops even with the 1M window.

### Amp's alternative: Handoff over compaction

Amp (Sourcegraph) publicly retired compaction in favor of **Handoff**—a tool that carries context forward into a fresh thread without summarizing or compressing. The `/handoff` command analyzes the existing discussion, generates a draft prompt for the next phase, and opens a new workspace, leaving the original thread untouched and searchable. This was influenced by OpenAI's Codex team findings that recursive summarization causes performance degradation over time. For Skylark, this validates the "split at stage boundaries" approach: each stage starts fresh with a curated prompt derived from the prior stage's artifact, rather than a lossy summary of the prior stage's conversation.

### Best practice

Run `/compact` proactively at **60–70% capacity** with explicit preservation instructions, and add standing compaction instructions to CLAUDE.md (which survives compaction because it's re-read from disk). But the better solution is to architect your pipeline so compaction is never needed: keep each agent session short enough that it completes before hitting 60%.

---

## 5. Making pipelines genuinely idempotent and resumable

### Current consensus

Anthropic's "Effective Harnesses for Long-Running Agents" post (November 2025) provides the canonical pattern: separate the **Initializer Agent** (sets up `init.sh`, `claude-progress.txt`, and a JSON feature list with initial git commit) from the **Coding Agent** (makes incremental progress one feature at a time, commits to git, writes progress summaries). The JSON feature list is critical—200+ features marked as `"passes": false`, only flipped to `true` after testing. JSON rather than Markdown is used because the model is less likely to edit JSON structure. Each coding agent reads `claude-progress.txt` + `git log --oneline -20` to understand state before starting work. The startup ritual: `pwd → read progress file → read feature list → run init.sh → test basic functionality → start work`.

### Concrete techniques

**Claude Code's session resume** (`claude --continue` / `claude -c` for most recent session, `claude --resume` / `claude -r` for interactive picker) deserializes full message history including tool results and code modifications. Sessions are stored per project as `.jsonl` files in `~/.claude/projects/`. The `/resume` picker shows sessions from the same Git repository, including worktrees.

**claude-code-session-kit** (GitHub, tested across 92 real sessions) implements a four-hook lifecycle: context monitoring with three-tier alerts at **40%/60%/70%** (hard stop at 70% forces handoff), pre-compact reminders to save state before compression, auto-load of previous session state on new session start, and handoff validation that checks `session-state.md` has commit hash, summary, and next steps.

<PD_Comment>This feels like one we should obviously go check out.</PD_Comment>
  
**The HANDOVER.md + CLAUDE.md pattern** uses two files: `CLAUDE.md` for permanent technical details and `HANDOVER.md` for per-session state. At session end, the developer asks Claude to write a handoff prompt and update HANDOVER.md. The next session starts by pasting that prompt. "The session log becomes genuine project documentation."

### Real gotchas from post-mortems

**Orphaned worktrees** from interrupted parallel runs accumulated silently prior to Claude Code v2.1.76. That version added automatic detection and cleanup, but it's undocumented whether data from interrupted runs is preserved or discarded. More critically, **worktree sessions cannot be reliably resumed**: GitHub issue #28314 documents that after using `claude --worktree`, the exit message suggests `claude --resume <id>`, but resuming fails because the worktree directory was already cleaned up. Issue #42596 confirms that sessions created via the Agent tool with `isolation: "worktree"` are subagent sessions—transient and non-resumable. Issue #31969 notes that `EnterWorktree` only creates new worktrees with no `ResumeWorktree` to re-enter existing ones.

**Git lock files from crashed agents** are a production hazard. If an agent crashes while holding `.git/index.lock`, the stale lock blocks all subsequent git operations across every agent until manual `rm -f`. Agents that don't recover "abort the current operation and continue generating code without committing"—leaving unbounded uncommitted state.

**Build artifact contamination between worktrees** is an underappreciated failure mode. Build tools like Next.js (`.next/`), Vite (`dist/`), and TypeScript write to directories relative to the project root. If worktrees share build cache, agents contaminate each other's builds—"mysterious build failures, wrong bundle contents."

**The "26-agent ML pipeline" post-mortem** (Medium) describes agents that would "fix a bug at 9:00 and overwrite the fix at 14:00" because they lacked awareness of prior work. The solution: a file-based report registry in `.claude/reports/` with subdirectories for analysis, architecture, bugs, handoffs, implementations, and reviews. The rule: "Never recreate. Before invoking agents: check project registry for relevant prior work."

### Applied idempotency principles

The data engineering world's idempotency patterns apply directly: **idempotency keys** (every side-effecting action carries a unique key + replay policy), **checkpointing** (persist processing state at consistent recovery points), **atomic operations** (each step either fully completes or fully rolls back—the saga pattern), **compensating actions** (record rollback paths for each forward action), and **delete-write** (delete existing output before re-writing to ensure re-runs don't duplicate). For Skylark, this means each stage should write its output atomically to a versioned artifact file, and the orchestrator should check whether each stage's output already exists and is valid before running that stage.

---

## 6. One long session is now the wrong default

### Current consensus

**The state of the art is definitively "split the pipeline into N separate sessions with handoff artifacts."** Every major framework and methodology has converged on this:

Anthropic's own harness research was "designed around the assumption of multiple context windows." The RPI methodology explicitly prescribes: "Start a new agent session for each phase. Prevents context overflow and forces focused work." Amp retired compaction in favor of clean thread handoffs. Anthropic's 2026 Agentic Coding Trends Report describes agents that "still need human checkpoints every few hours for complex work." The 1M-token context window, while helpful, doesn't change this—it just means each session can handle more complex individual stages.

### What the handoff protocol looks like

Based on all sources, the minimal handoff file should contain:

- **Completed tasks** with commit hashes
- **Pending/in-progress tasks** (priority-ordered)
- **Key decisions made** and rationale
- **Relevant file paths** that were modified
- **Known issues/blockers**
- **Next steps** (specific enough to be actionable)
- **Branch/worktree state**
- **Test status** (what passes, what's known-broken)

GitHub issue #11455 proposes a standardized `.claude/handoff.md` with CLI commands (`claude handoff save/load/show/clear/history`), but this has not yet been implemented as a built-in feature. The MCP-based handoff server (BlackDogLabs) captures compressed state at ~2,000 tokens vs. 10,000+ for re-explaining context—a 5x improvement.

### When to split vs. stay in one session

**Split when**: complex multi-file changes, context approaching 40–70% capacity, phase transitions (research → planning → implementation), different specializations needed, parallel independent workstreams, or multi-day projects. **Stay in one session when**: single-file fixes, tight interactive debugging (feedback loop is essential), tasks under ~4 subtask batches (worktree setup/merge/cleanup overhead eats savings), or exploratory work where you don't yet know the scope.

<PD_Comment>This feels like a good heuristic that we should consider. We should look into how we can use it as a hard boundary for when to split a task into multiple sub-tasks.</PD_Comment>

### The inter-session communication gap

GitHub issue #24798 documents the sharp edge: running 5 parallel sessions with "no way to communicate, share state, or coordinate." One user's migration session changed the server IP while every other session still had the old IP hardcoded. The user described acting as a "message bus"—copy-pasting between sessions. Sessions died from "context bloat at 55–62 MB." The proposed solutions (inter-session messaging, shared project scratchpad as key-value store, dependency sequencing, delegation) have not yet been implemented. Claude Code Tasks (v2.1.16+) partially addresses this with shared task lists, but full inter-session state coordination remains an open problem.

### Cloud and remote sessions as a bridge

Claude Code's `--remote` flag creates cloud sessions that persist even if the laptop closes, monitorable from mobile. `--teleport` pulls cloud sessions into the terminal (one-way cloud → local handoff). Cursor's Background Agents run in isolated Ubuntu VMs on separate branches, producing PRs for review—**35% of Cursor's own internal merged PRs** are now created by background agents. These approaches decouple session lifetime from developer attention, making the multi-session split more natural.

---

## If you were rebuilding Skylark today

### 1. Make the orchestrator a deterministic state machine that never reasons

Strip all LLM reasoning out of the orchestrator. It should be a YAML-configured state machine that reads artifact file existence and YAML frontmatter status fields to determine the current pipeline position, then dispatches the appropriate subagent with a curated prompt. The orchestrator context should never exceed ~20K tokens: the state machine definition, a list of artifact file paths with their status, the current stage's skill prompt, and the risk-level routing table. All substantive reasoning (brainstorm, spec-review, develop) happens in subagents that start with a fresh context window containing only the artifacts they need. **Trade-off**: you lose the orchestrator's ability to make adaptive decisions mid-pipeline (e.g., "this spec review revealed the risk level should be elevated"), so you need explicit "re-triage" checkpoints in the state machine. **Rationale**: this eliminates the 3–6 compaction cycles entirely, because the orchestrator never accumulates enough context to trigger compaction, and each worker completes before hitting 60% utilization.

<PD_Comment>I think there's a middle ground that we can look for here, where we can have a YAML-encoded state machine that it follows through.

In this scenario, it would be handled by an orchestrator that reads that state machine and decides what to do next. That way, it has clear guardrails around what it's doing, but it also has the ability to reason about divergences from the expected norm in case there are edge cases.</PD_Comment>

### 2. Replace vocabulary routing with skill-scoped CLAUDE.md files and deferred tool loading

Your current 15–30 precise domain terms in 3–5 clusters are good prompt engineering, but they consume context in every stage even when irrelevant. Move each cluster into a path-scoped `.claude/rules/{domain}.md` file that loads only when the stage touches files matching that domain's glob pattern. Use Claude Code's deferred tool loading (`defer_loading: true`) for MCP tools so only tool stubs (names only) sit in static context; full schemas load on demand via ToolSearch. This approach was validated by Cursor's A/B test showing **46.9% token reduction** and by the Manus team's principle of keeping a stable tool set to maximize KV-cache hits. **Trade-off**: slightly higher latency on first tool use in each domain (tool schema must be fetched), but dramatically lower static context overhead. **Rationale**: every token saved in static context is a token available for substantive reasoning, and a stable prefix maximizes prompt cache reuse.

<PD_Comment>I think there is a good middle ground where we could potentially have a separate skill for pre-compiling all of those domain experts.

What we could look at is an approach where we ship Skylark with a pre-compiled set of experts that are generic. Then, for a given codebase, it can be customized. We could build a skill that scans through the codebase and identifies the major concerns covered by that specific project—such as front-end services, back-end services, databases, orchestration of infrastructure, et cetera.

The skill would find each of those domains, determine if there are specific specialties within them that would be useful, and then create a pre-compiled set of those vocabulary routes in a JSON or YAML file in advance. These would have specific scopes already identified and pre-organized so that they can just be grabbed in the pipeline later.

Additionally, the skill would allow you to regenerate that file if you are making architectural changes. For example, if you switch from one database technology to another, you could regenerate it to make sure that the database terms being used are appropriate.

That might be one approach where you can cut down on the token usage midstream while still getting the same effect. It should be quite a bit faster because you don't have to do that evaluation each time. I like that; let's look into it.</PD_Comment>

### 3. Write stage artifacts as atomic, versioned files with explicit "resumability contracts"

Each Skylark stage should produce a single artifact file (e.g., `artifacts/03-brainstorm.md`) written atomically at stage completion, with YAML frontmatter containing: `stage`, `status` (pending/complete/failed), `risk_level`, `git_commit_hash`, `predecessor_artifact`, `successor_artifact`, `decisions` (list of key decisions with rationale), and `modified_files`. The orchestrator checks for the existence and status of each artifact before dispatching a stage. If a stage's artifact already exists with `status: complete` and its `git_commit_hash` matches the current HEAD, the stage is skipped. If `status: failed`, the stage is retried with the failure context from the frontmatter's `error` field. **Trade-off**: more disk I/O and a rigid artifact schema that must be maintained as stages evolve. **Rationale**: this gives you genuine idempotency (re-running the pipeline after a crash skips completed stages), clear resumability (any session can pick up from the last completed artifact), and a permanent audit trail that doesn't depend on conversation memory. It directly implements the Anthropic "effective harnesses" pattern of `claude-progress.txt` + JSON feature list.

<PD_Comment>Yeah, this is something I want to go back and look at—the triad approach—to see what we can glean from that method. I think there was a lot of actual goodness there that we have lost along the way, so let's evaluate what that looks like.

I also want to revisit Beads now that it has matured. I want to see if it makes sense to switch to using Beads as the actual artifacts, or at least the data layer; then, the artifacts themselves can be Beads.</PD_Comment>

### 4. Split elevated/critical-risk runs at natural phase boundaries with explicit handoff hooks

For elevated/critical-risk runs (the ones that currently consume the full 1M window), split the pipeline into 3–4 separate sessions: (a) triage + prepare + brainstorm, (b) spec-review + write-plan + plan-review, (c) develop, (d) finish. Use Claude Code hooks (`SubagentStop`) to auto-generate a handoff artifact at each boundary, validated by the claude-code-session-kit pattern (hard stop at 70% context utilization). Each new session starts by reading only the prior phase's artifact file—not the full conversation history. Implement the RPI pattern's review gates: **FAR validation** after brainstorm (is the output Factual, Actionable, Relevant?) and **FACTS validation** after plan-review (is the plan Feasible, Atomic, Clear, Testable, Scoped?). For standard-risk runs where the pipeline fits in a single session, skip the split. **Trade-off**: slower wall-clock time for critical-risk runs (session startup overhead × 3–4), and human review gates add latency. **Rationale**: eliminates the auto-compaction death spiral entirely. Each session stays under 60% context utilization. The review gates catch intent drift before it propagates downstream—the exact problem of "orchestrator loses early-stage intent."

### 5. Implement a lightweight "report registry" to prevent agent amnesia

Create a `.claude/reports/` directory with subdirectories mirroring your pipeline stages. Each subagent, before starting work, must check the registry for relevant prior artifacts (the "never recreate" rule from the 26-agent ML pipeline post-mortem). On completion, each subagent writes a structured report to the registry. Add a pre-stage hook that loads the relevant reports into the subagent's prompt. This prevents the classic failure mode where a develop-stage agent overwrites a decision made during spec-review because it lacks context about why that decision was made. The registry also serves as your incremental user-visible output: a dashboard can render the registry as a pipeline progress view, showing completed stages, current status, and key decisions at each stage. **Trade-off**: additional disk overhead and a new file convention to maintain; subagents must be explicitly instructed to read from and write to the registry. **Rationale**: disk artifacts are the only context that truly persists across compaction, session boundaries, and agent crashes. The registry transforms the pipeline from a conversation-dependent chain into a filesystem-first architecture where the conversation is ephemeral scaffolding around durable artifacts.

<PD_Comment>Yeah, again, I think we should be evaluating the approach that Gastown takes with beads here and look at how we can just unify on a data structure for this.

We need to make sure that everything is using the same approach.</PD_Comment>
