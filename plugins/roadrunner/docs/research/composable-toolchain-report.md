# Composable tools for AI-agent development pipelines

**A Unix-philosophy toolkit for Claude Code workflows exists today — but you must assemble it yourself.** No single project delivers the full 8-stage pipeline as composable, small-focused tools. However, the ecosystem has matured enough that each stage can be served by at least one production-quality open-source tool or battle-tested pattern, with file-based structured handoffs between them. The most critical finding: the filesystem remains the universal integration layer, and tools that embrace Markdown/JSON/YAML files in git consistently compose better than those relying on proprietary APIs or in-memory state.

The landscape breaks into three tiers: **production-ready primitives** (Claude Code CLI, XState, Langfuse, Plane, Taskmaster AI), **emerging-but-sound patterns** (RPI workflow, Amp-style handoff, session-kit hooks, structured review verdicts), and **significant gaps** where no tool exists yet (pre-dispatch context estimation, typed ship/revise/rethink gating, agent-aware merge queues, cross-session ID standards). This report catalogs every relevant tool and pattern found across all 8 stages, assesses composability for each, and maps the remaining gaps.

---

## Stage 1: Problem exploration and definition

This stage transforms raw ideas and bugs into structured specs with acceptance criteria that an agent can execute against. The tools here are surprisingly mature.

### GitHub Spec Kit
- **Link**: https://github.com/github/spec-kit
- **Stages**: 1 (primary), feeds into 2
- **What it does**: CLI + Markdown templates implementing a 4-phase workflow: Specify → Plan → Tasks → Implement. Slash commands (`/specify`, `/plan`, `/tasks`, `/implement`) drive the agent through phases. Includes a `constitution.md` for non-negotiable project principles. Agent-agnostic — works with Claude Code, Copilot, Gemini CLI, Cursor.
- **Interface**: Python CLI (`uvx` install), slash commands, file artifacts (`spec.md`, `plan.md`, `tasks.md` in `/specs/`). Bash/PowerShell helpers.
- **Maturity**: Production-ready (MIT, actively maintained by GitHub, LinkedIn Learning course exists).
- **Composability**: **Excellent**. Outputs are plain Markdown files. Each phase is a separate file that can be piped to any agent. The CLI is thin. Artifacts version-controlled in git.
- **Gaps**: No structured JSON/YAML output — everything is Markdown. No built-in task sizing heuristics. Single-repo only.

### OpenSpec (Fission-AI)
- **Link**: https://github.com/Fission-AI/OpenSpec
- **Stages**: 1
- **What it does**: Lighter-weight alternative to Spec Kit. Artifact-guided workflow creating `proposal.md`, `specs/`, `design.md`, `tasks.md` per change in `openspec/changes/`. Fluid iteration — not phase-gated. Supports 25+ AI tools via slash commands.
- **Interface**: Node.js CLI, slash commands, per-change Markdown directories.
- **Maturity**: Alpha/beta. Active development, newer than Spec Kit.
- **Composability**: **Excellent**. File-based, per-change directory structure is clean.
- **Gaps**: Smaller community, less documentation. No structured data formats.

### RPI pattern (Research → Plan → Implement)
- **Link**: https://github.com/patrob/rpi-strategy, https://microsoft.github.io/hve-core/docs/rpi/
- **Stages**: 1 and 2
- **What it does**: A 3-phase structured convention. **Research**: agent investigates codebase, produces a research doc validated against the FAR scale (Factual, Actionable, Relevant). **Plan**: creates an implementation plan with atomic tasks validated against FACTS (Feasible, Atomic, Clear, Testable, Scoped). **Implement**: executes tasks mechanically with checkbox tracking. **Each phase runs in a fresh context window** — this is the key design principle. Evolved into CRISPY (7-stage) by HumanLayer after finding RPI produced 1,000-line plans.
- **Interface**: Pure convention. Markdown files. Goose has built-in commands; Microsoft's HVE-Core provides `/task-research`, `/task-plan`, `/task-implement`, `/task-review` as custom agents.
- **Maturity**: Well-documented convention (2024–2026). Implemented by HumanLayer, Block/Goose, Kilo.ai, and Microsoft HVE-Core.
- **Composability**: **Maximum**. It's a pattern, not a tool — pure files + conventions. Can be composed with any agent.
- **Gaps**: No tooling to enforce the pattern automatically. FAR/FACTS validation is manual. No automated task sizing.

### Addy Osmani's spec framework
- **Link**: https://addyosmani.com/blog/good-spec/
- **Stages**: 1
- **What it does**: Framework (not a tool) for writing AI agent specs based on GitHub's analysis of **2,500+ agent config files**. Identifies 6 core areas: Commands, Testing, Project Structure, Code Style, Git Workflow, Boundaries. Advocates modular specs, TODO-driven micro-specs, and plan-first workflows.
- **Interface**: Guidelines applicable to CLAUDE.md and any spec file.
- **Maturity**: Well-established convention (published by O'Reilly).
- **Composability**: N/A — directly applicable to any agent's configuration.

---

## Stage 2: Work tracking and decomposition

Breaking specs into atomic tasks sized for a single agent session (**<500 LOC, fitting one context window**) is where the ecosystem has the most options but no single dominant tool.

### Taskmaster AI (claude-task-master)
- **Link**: https://github.com/eyaltoledano/claude-task-master (~25.3K stars)
- **Stages**: 2 (primary), touches 1 and 4
- **What it does**: AI-powered task management bridging planning and implementation. Parses PRD documents into structured `tasks.json` with dependencies. Provides complexity analysis to identify tasks needing further decomposition, dependency-aware sequencing, and built-in research for fresh information. Works with Claude Code, Cursor, Codex CLI, Gemini CLI.
- **Interface**: CLI + MCP server (36 tools, configurable: "all" at 36, "core" at 7 with ~70% token reduction). Tasks stored as JSON files, git-friendly.
- **Maturity**: **Production-ready** (25K+ stars, 72 contributors, 90+ releases).
- **Composability**: **Excellent**. MCP server consumable by any MCP client. JSON files are the persistence layer. Platform-agnostic CLI.
- **Gaps**: Does not handle actual code execution. No context-window estimation. No CI/CD integration.

### TASKS.md specification
- **Link**: https://github.com/tasksmd/tasks.md
- **Stages**: 2
- **What it does**: Vendor-neutral spec for AI agent task queues. Tasks organized under priority headings (P0–P3). Agents claim tasks, work them, scout for new work, complete and remove. Supports multi-repo roaming. Includes a 5-tier audit cascade when queues empty. Companion to AGENTS.md.
- **Interface**: Pure Markdown file. Zero setup. npm CLI tooling. Git auto-merges deletions on non-adjacent lines, reducing conflicts.
- **Maturity**: Early/alpha. Active community discussion.
- **Composability**: **Maximum** — it's just a file. Any tool/agent reads and writes it.
- **Gaps**: Markdown parsing is fragile. No built-in dependency management or task sizing.

### agent-tasks (keshrath)
- **Link**: https://github.com/keshrath/agent-tasks
- **Stages**: 2
- **What it does**: Pipeline-driven task management for AI agents. Configurable pipeline stages (backlog → spec → plan → implement → test → review → done). **DAG-based dependencies** with cycle detection. Approval workflows with stage gates. Multi-agent collaboration with roles and claiming. **Three transport layers**: MCP (stdio), REST API (HTTP), WebSocket. TodoWrite bridge for Claude Code integration.
- **Interface**: MCP server (8 tools), REST API, WebSocket, web dashboard (localhost:3422). SQLite-backed.
- **Maturity**: Early/alpha (very new, 355 tests).
- **Composability**: **Excellent**. Triple interface means any tool can integrate.
- **Gaps**: Very new, low adoption. Single developer. No task sizing heuristics.

### Plane (open-source project management)
- **Link**: https://github.com/makeplane/plane (46K+ stars)
- **Stages**: 2
- **What it does**: Open-source Jira/Linear alternative. Self-hostable (Docker, K8s, air-gapped). REST API with OAuth 2.0, HMAC webhooks, typed SDKs (Node.js, Python). **Native MCP server** with agent framework — @mention support, full Agent Run lifecycle tracking. AGPL-3.0.
- **Interface**: REST API, webhooks, MCP server, YAML project config.
- **Maturity**: **Production-ready** (46K stars, Fortune 50 deployments, 1M+ Docker pulls).
- **Composability**: **Excellent** for a tracking tool. Self-hostable. Agent-native.
- **Gaps**: Some agent features are Commercial Edition only. No task decomposition.

### APM (Agentic Project Management)
- **Link**: https://github.com/sdi2200262/agentic-project-management
- **Stages**: 1 and 2
- **What it does**: Three specialized agent types: **Planner** (creates spec, plan, rules), **Manager** (coordinates execution, assigns tasks), **Workers** (execute with tightly scoped context). Agent-agnostic (Claude Code, Codex CLI, Cursor, Copilot, Gemini CLI). **APM Auto** variant replaces user mediation with autonomous subagent dispatch.
- **Interface**: CLI, slash commands, skills (Markdown files in `.claude/skills/`). File-based artifacts.
- **Maturity**: Beta (active development).
- **Composability**: **Good**. Agent-agnostic, file-based. Skills are just Markdown.
- **Gaps**: User mediation is tedious for small tasks. APM Auto is Claude Code-only.

### Task sizing heuristics (synthesized findings)

No dedicated tool exists for pre-dispatch context estimation, but research yields concrete numbers. **~18 tokens per line of code** (Python/JS), so 500 LOC ≈ 9,000 tokens of code, leaving ~150K+ tokens for context and tool calls in a 200K window. JetBrains research shows agent performance drops sharply past **32K tokens of context**. The RPI FACTS validation requires each task to be a "single, focused unit" — one command call or file edit. Claude Code's CLAUDE.md consumes tokens every turn; keeping it under **50 instructions** is critical since frontier models can follow roughly 150–200 total instructions.

---

## Stage 3: Task dispatch and orchestration

The user wants a deterministic state machine that routes tasks to workers, tracks status, and handles retries/escalation. This stage has the richest set of options.

### XState v5 (and @statelyai/agent)
- **Link**: https://github.com/statelyai/xstate (production), https://github.com/statelyai/agent (experimental)
- **Stages**: 3
- **What it does**: Zero-dependency, MIT-licensed JavaScript/TypeScript state management based on statecharts and the **actor model**. Actors communicate via messages. **`getPersistedSnapshot()`** serializes machine state to JSON; **`resolveState()`** deserializes it — the exact round-trip needed for checkpointing agent workflows. Guards, nested states, parallel states, and invoked actors (machines, promises, observables) map directly to agent routing. The `@statelyai/agent` package integrates XState with LLMs — `agent.decide()` asks the LLM which transition to fire, constrained by valid transitions from the current state.
- **Interface**: JavaScript/TypeScript API. Machine configs are pure JSON (serializable). Trivially wrappable as CLI.
- **Maturity**: XState v5 is **production-grade**. @statelyai/agent is experimental.
- **Composability**: **Maximum**. Pure library, zero opinions about what actors do. JSON-serializable state.
- **Gaps**: No built-in persistence layer or retry policies — you implement via machine logic.

An influential blog post ("Deterministic Core, Agentic Shell," blog.davemo.com, Feb 2026) articulates the exact architecture this pipeline needs: XState as the deterministic core where the LLM's available tools and system prompt are **constrained by the current machine state**. Tool calls from the LLM become events dispatched to the machine.

### Python state machines: pytransitions and python-statemachine
- **Links**: https://github.com/pytransitions/transitions (5.9K stars), python-statemachine (PyPI)
- **Stages**: 3
- **What they do**: pytransitions is a lightweight, object-oriented FSM with callbacks, guards, `TimeoutState`, hierarchical states, async support, and Mermaid/Graphviz diagram generation. python-statemachine v3 adds full statechart support with compound/parallel states, guards, and error handling.
- **Interface**: Python API. Machine config is list-of-dicts (JSON-serializable).
- **Maturity**: Both stable and actively maintained.
- **Composability**: **Excellent**. Pure libraries, easy to embed.
- **Gaps**: No actor model. No distributed execution. You build dispatch and spawning yourself.

### Restate
- **Link**: https://github.com/restatedev/restate
- **Stages**: 3 and 4
- **What it does**: Lightweight durable execution engine. **Single binary** (Rust), no database dependency. Sits in front of services like a reverse proxy. Durable steps at **~10ms p50**. Built-in K/V state per entity. Framework-agnostic AI agent support wrapping OpenAI Agent SDK, Vercel AI SDK, Google ADK, Pydantic AI. Durable promises enable human-in-the-loop (pause/resume across crashes). **A2A protocol support**.
- **Interface**: SDK-based (TypeScript, Java/Kotlin, Python, Go, Rust). HTTP invocations. CLI (`restatectl`).
- **Maturity**: **Production-ready**. Built by creators of Apache Flink.
- **Composability**: **Excellent**. "Agentic workflows are just code." Single binary deployment. Framework-agnostic.
- **Gaps**: Newer than Temporal. Server-side Public License for the server (SDKs are Apache 2.0).

### Temporal.io
- **Link**: https://github.com/temporalio
- **Stages**: 3 and 4
- **What it does**: Durable workflow execution engine. Workflows are code (Python, Go, Java, TypeScript). Deterministic Workflow functions orchestrate non-deterministic Activities (LLM calls, tool invocations). **OpenAI's Codex and Replit's Agent 3 are built on Temporal.** Automatic state persistence, retries, timeouts, replay on failure. Signals for human-in-the-loop. Temporal Nexus for cross-namespace communication.
- **Interface**: Multi-language SDKs, CLI, REST/gRPC API, JSON event histories.
- **Maturity**: **Battle-tested at massive scale** (Snap, Coinbase, NVIDIA, OpenAI).
- **Composability**: **Good**. Workflows/Activities are just functions. But requires running a Temporal Server.
- **Gaps**: Operational overhead of the server. Overkill for simple orchestration.

### Inngest (with AgentKit)
- **Link**: https://github.com/inngest/inngest, https://agentkit.inngest.com
- **Stages**: 3
- **What it does**: Event-driven workflow orchestration with durable step functions. **AgentKit** composes agents into Networks with Routers and shared state. `step.ai.infer()` proxies LLM requests through Inngest for observability. Concurrency controls and rate limiting are critical for LLM API management. Human-in-the-loop via `step.waitForEvent()`.
- **Interface**: TypeScript/Python SDK. Event-driven. Self-hostable (SSPL + DOSP license).
- **Maturity**: Tens of thousands of developers, 100M+ daily runs. AgentKit is newer.
- **Composability**: **Good**. Event-driven architecture maps to agent communication. Opinionated platform model.
- **Gaps**: AgentKit is TypeScript-only currently. SSPL license.

### Kitaru (by ZenML)
- **Link**: https://github.com/zenml-io/kitaru
- **Stages**: 3 and 4
- **What it does**: Durable execution for Python agents with **only 8 primitives**: `@flow`, `@checkpoint`, `wait()`, replay, artifacts. Crash at step 9, resume from step 9. `wait()` pauses for human/agent/webhook input. **MCP server included** — Claude Code can start flows, browse artifacts, resume waiting agents.
- **Interface**: Python decorators. CLI. MCP server. Dashboard UI.
- **Maturity**: Very new (2026), Apache 2.0. Built by experienced ZenML team.
- **Composability**: **Excellent**. "Not a framework, an orchestration layer." Pure decorators over existing code.
- **Gaps**: Very early. Python-only. Small community.

### Petri nets: not practical today

Petri net implementations for agent orchestration are sparse. Academic projects exist (Paose framework, PIPE2) but no production-ready, modern, composable implementation exists. XState's statecharts subsume basic Petri net capabilities via parallel states and hierarchical composition, making them the practical choice.

---

## Stage 4: Worker execution with Claude Code

Isolated agent sessions that receive a task, execute it, and return a structured result. This stage is well-served by Claude Code's CLI.

### Claude Code CLI (headless mode)
- **Link**: https://code.claude.com/docs/en/headless
- **Stages**: 4
- **What it does**: `claude -p "prompt"` runs non-interactively — processes the prompt, executes tools, outputs to stdout, then exits. The **canonical automation interface** combines `-p` + `--output-format json` + `--bare`.
- **Interface**: Structured JSON output containing `{type, subtype, result, session_id, total_cost_usd, duration_ms, num_turns}`. Key flags: `--allowedTools`, `--disallowedTools`, `--permission-mode dontAsk` (CI lockdown), `--max-turns N`, `--system-prompt`, `--session-id`, `--resume SESSION_ID`. `--bare` skips all config, OAuth, MCP for pure scripted mode.
- **Maturity**: **Production-ready**. Official Anthropic interface.
- **Composability**: **Maximum**. Standard Unix primitives — files, pipes, exit codes, JSON. Session chaining via `--resume`.
- **Gaps**: No built-in task validation or context estimation before execution.

The recommended worker isolation pattern combines Claude Code with git worktrees:
```bash
git worktree add /tmp/worker-$TASK_ID -b task-$TASK_ID
cd /tmp/worker-$TASK_ID
claude --bare -p "{task_prompt}" \
  --output-format json \
  --allowedTools "Read,Edit,Bash" \
  --max-turns 20 > result.json
```

### Claude Agent SDK
- **Link**: https://github.com/anthropics/claude-agent-sdk-python (~6.3K stars)
- **Stages**: 3 and 4
- **What it does**: High-level Python/TypeScript framework bundling Claude Code CLI inside the package. Supports subagents with isolated contexts, structured outputs via JSON Schema, custom tools via `@tool` decorator, in-process MCP servers, session persistence, and per-session cost tracking via `get_context_usage()`.
- **Interface**: `query()` returns `AsyncIterator` of typed messages. `ClaudeSDKClient` for bidirectional conversations.
- **Maturity**: Officially supported by Anthropic. Rapidly evolving.
- **Composability**: **Excellent**. Pure library. Your code controls the agent loop.
- **Gaps**: Only works with Anthropic models. Lifecycle management is programmatic, not declarative. Licensed under Anthropic's commercial terms, not MIT/Apache.

### ComposioHQ/agent-orchestrator
- **Link**: https://github.com/ComposioHQ/agent-orchestrator
- **Stages**: 3 and 4
- **What it does**: Manages fleets of AI coding agents in parallel. Each agent gets its own **git worktree, branch, and PR**. Agent-agnostic (Claude Code, Codex, Aider), runtime-agnostic (tmux, Docker), tracker-agnostic (GitHub, Linear). YAML config. **Reactions system**: CI fails → agent gets logs and fixes; reviewer requests changes → agent addresses them.
- **Interface**: CLI (`ao start`), YAML config, web dashboard.
- **Maturity**: Newer project, practical but experimental.
- **Composability**: **Good**. Agent-agnostic plugin system.
- **Gaps**: Focused on coding agent fleets, not general-purpose orchestration.

---

## Stage 5: Review and gating

**No existing tool implements the exact ship/revise/rethink typed verdict taxonomy.** This is the largest single gap in the ecosystem. Here's what comes closest.

### Qodo PR-Agent
- **Link**: https://github.com/qodo-ai/pr-agent
- **Stages**: 5
- **What it does**: Open-source AI PR reviewer. Single LLM call per tool command (`/review`, `/improve`, `/ask`). **JSON-based output** matching `pr_reviewer_prompts.toml` structure. PR Compression handles both short and long diffs.
- **Interface**: CLI (`pr-agent --pr_url <url> review`), GitHub Actions, GitLab webhooks, `.pr_agent.toml` config. JSON output.
- **Maturity**: **Production-grade**. Widely adopted.
- **Composability**: **Excellent**. CLI-first, JSON output, TOML config. Can pipe output downstream.
- **Gaps**: No ship/revise/rethink verdict. No bounded review rounds. Self-hosted LLM integration has known bugs (Issues #2098, #2083).

### OpenAI Codex structured review pattern
- **Link**: https://developers.openai.com/cookbook/examples/codex/build_code_review_with_codex_sdk
- **Stages**: 5
- **What it does**: Uses a **JSON output schema** (`codex-output-schema.json`) to produce typed reviews with overall correctness verdict, confidence score (0–1), and line-level findings with file citations.
- **Interface**: CLI with JSON schema file → JSON output file. GitHub Actions integration.
- **Maturity**: Reference implementation/cookbook.
- **Composability**: **Excellent**. The **best existing example of a structured review verdict schema**. Confidence scores enable programmatic gating.
- **Gaps**: Binary verdict only (correct/incorrect). Must be custom-extended for three-way verdicts. Tied to OpenAI.

### Calimero AI Code Reviewer
- **Link**: https://github.com/calimero-network/ai-code-reviewer
- **Stages**: 5
- **What it does**: Multi-agent code review orchestrating 2–5+ LLM agents in parallel. **Consensus-based scoring** weights findings by inter-agent agreement, reducing false positives. **Delta tracking** detects new/fixed/open findings across pushes with convergence detection (stops reviewing when findings stabilize).
- **Interface**: CLI, YAML config, output as GitHub comments, JSON, or Markdown.
- **Maturity**: Very early (brand new, MIT).
- **Composability**: **Good**. Convergence detection is the closest primitive to bounded review rounds.
- **Gaps**: Immature. No typed verdict system.

### Qodo Command (CLI agent chaining)
- **Link**: https://www.qodo.ai/blog/introducing-qodo-gen-cli-build-run-and-automate-agents-anywhere-in-your-sdlc/
- **Stages**: 5 (and others)
- **What it does**: CLI where agents are defined in `.toml` files. **Pipe chaining** (`|`) passes structured JSON between agents; context chaining (`>`) passes summaries. Agents defined as TOML with structured output schemas.
- **Interface**: CLI (`qodo chain "review | review_ranked"`), TOML config, JSON I/O between agents.
- **Maturity**: Alpha/early.
- **Composability**: **Excellent**. Purpose-built for agent chaining with contract-defined interfaces.
- **Gaps**: No built-in verdict taxonomy. You build ship/revise/rethink logic yourself.

### The missing gating primitive

The recommended approach is a thin composable gate that takes PR URL as input, invokes PR-Agent or Codex structured review via CLI, parses JSON output against an extended verdict schema (mapping severity + confidence to ship/revise/rethink), enforces max rounds via a counter file in the PR branch, and returns exit codes (0=ship, 1=revise, 2=rethink). This is perhaps **50 lines of shell script** wrapping existing tools.

---

## Stage 6: Integration and merge

**No actively maintained, feature-rich, open-source merge queue exists**, and **no merge queue tool differentiates agent PRs from human PRs**. The space has consolidated around SaaS offerings.

### Bors-ng (deprecated)
- **Link**: https://github.com/bors-ng/bors-ng
- **Stages**: 6
- **What it does**: GitHub App. Comment `bors r+` to add to queue. Merges into `staging`, runs CI, fast-forwards `main` if green. **Tests in batches; bisects on failure**. Was used by Rust project and Kubernetes.
- **Interface**: GitHub PR comments, `bors.toml` config.
- **Maturity**: **Deprecated**. Recommends GitHub's built-in merge queue.
- **Composability**: Comment-based interface is composable (any bot can post `bors r+`). But deprecated.

### Mergify
- **Link**: https://mergify.com
- **Stages**: 6
- **What it does**: Speculative parallel execution, batching with bisect-on-failure, two-step CI, priority queues, scoped queues (frontend/backend/infra), auto-retry. **Autoqueue** feature auto-adds matching PRs by label pattern — useful for agent PRs.
- **Interface**: `.mergify.yml` config (version-controlled). GitHub App.
- **Maturity**: Production. **Closed-source, SaaS-only** since 2022.
- **Composability**: YAML config is composable. No CLI, no self-hosting.
- **Gaps**: Not open-source. No agent-specific differentiation.

### Aviator
- **Link**: https://www.aviator.co, CLI: https://github.com/aviator-co/av
- **Stages**: 6
- **What it does**: Merge queue SaaS + **open-source CLI** (`av`) for stacked PRs. Sequential, parallel, and fast-forward modes. Stack-aware merging. Dynamic parallel queues via Bazel integration. Priority merging.
- **Interface**: Open-source Go CLI (`av stack sync`, `av pr --queue`). Label/comment/CLI triggers for merge queue.
- **Maturity**: Production-grade. SOC2 Type II.
- **Composability**: **The open-source `av` CLI is the best composable merge tool available**. But the queue service itself is SaaS.

### GitHub native merge queue
- **Link**: https://docs.github.com/en/repositories/configuring-branches-and-merges-for-your-repository/configuring-pull-request-merges/managing-a-merge-queue
- **Stages**: 6
- **What it does**: Built-in merge queue. PRs enter queue, tested against latest main + queued PRs. Supports `merge_group` workflow trigger.
- **Maturity**: GA for Enterprise Cloud and public repos.
- **Composability**: Free, native, zero external dependency. Limited: no batching, no multiple queues, no priority.
- **Gaps**: No agent-aware features. Cannot run different checks for agent vs. human PRs without label workarounds.

### Agent-aware merge patterns (emerging)

The Kilo-Org/cloud project implements **agent-dispatched conflict resolution**: PR polling detects `mergeable: false`, dispatches a Claude Code agent with a focused prompt to resolve conflicts, runs quality gates, and calls `gt_escalate` if too complex. A metadata flag `conflict_resolution_in_progress: true` prevents re-dispatch. This pattern is the most promising approach to agent-aware merging found.

Research from the **AgenticFlict dataset** (arXiv:2604.03551) documents 336K+ conflict regions in AI agent PRs on GitHub, confirming that agent-aware merge tooling is an urgent need.

---

## Stage 7: Monitoring and observability

This stage is the most mature, with multiple self-hostable open-source options.

### Langfuse (top recommendation for self-hosted)
- **Link**: https://github.com/langfuse/langfuse
- **Stages**: 7
- **What it does**: Open-source LLM engineering platform. Tracing, **cost tracking**, latency monitoring, prompt management, evaluations (LLM-as-judge), datasets/experiments. Tracks token usage, model parameters, per-trace costs. Accepts OpenTelemetry data natively (v3 SDK).
- **Interface**: Python/JS SDKs with `@observe()` decorator; OTel ingestion; integrations with LiteLLM, LangChain, LlamaIndex, OpenAI SDK, CrewAI. REST API.
- **Self-hosting**: **Fully self-hostable**. MIT license. Docker Compose or Kubernetes. Zero feature gates.
- **Maturity**: **High** (YC W23, thousands of production deployments).
- **Composability**: **Excellent**. Sessions/traces/user tracking. Custom dashboards. Export via API.
- **Gaps**: Requires Postgres + ClickHouse + Redis infrastructure. No built-in stall detection.

### OpenLLMetry (by Traceloop)
- **Link**: https://github.com/traceloop/openllmetry
- **Stages**: 7
- **What it does**: OpenTelemetry extension with auto-instrumentation for OpenAI, Anthropic, Cohere, LangChain, LlamaIndex, and vector DBs. Wraps API calls in spans with `gen_ai.*` attributes automatically.
- **Interface**: Standard OTLP output. `Traceloop.init()` + `@workflow`/`@task` decorators. Apache 2.0.
- **Maturity**: Production-grade for Python.
- **Composability**: **Maximum**. Pure OTel — connect to Langfuse, Jaeger, Grafana, or any OTLP endpoint.
- **Gaps**: No built-in dashboard. Go/Ruby still early.

### Helicone
- **Link**: https://github.com/Helicone/helicone
- **Stages**: 7
- **What it does**: LLM observability via AI Gateway proxy. Change your base URL, get instant cost/latency/token tracking. Session tracing for multi-step agents. Supports 100+ providers. Custom headers for **per-task/per-stage cost attribution**.
- **Self-hosting**: Docker Compose. Uses ClickHouse + Kafka.
- **Maturity**: **High** (YC W23, 2B+ interactions).
- **Composability**: Gateway approach means zero-code integration but adds ~50–80ms latency. Custom properties enable structured cost attribution.
- **Gaps**: Proxy dependency. Less deep tracing than Langfuse for complex chains.

### Phoenix by Arize
- **Link**: https://github.com/Arize-ai/phoenix
- **Stages**: 7
- **What it does**: Open-source AI observability. OTel-based tracing via OpenInference, evaluation (LLM-as-judge), datasets, experiments, prompt management. Auto-instrumentation for Claude Agent SDK, OpenAI, LangChain, CrewAI, Google ADK.
- **Self-hosting**: `pip install arize-phoenix` for local, Docker for production. **Elastic License 2.0** (restricts competing hosted service).
- **Maturity**: **High**. Strong on evaluation.
- **Composability**: OTel-compatible. Complements Langfuse (stronger on eval, weaker on operational monitoring).

### LiteLLM (complementary gateway)
- **Link**: https://docs.litellm.ai
- **Stages**: 7
- **What it does**: Open-source Python proxy normalizing LLM requests into OpenAI-compatible format. **Per-virtual-key budget enforcement** with automatic cutoff. Ships logs to Langfuse, Phoenix, Helicone, Prometheus.
- **Composability**: **Excellent gateway complement**. Unified API for 100+ providers.

### Stall detection patterns

No purpose-built open-source stall detection daemon exists. The recommended DIY approach combines several signals:

- **Loop detection**: Track `(tool_name, parameters_hash)` tuples; alert on 3+ repeats
- **Step count monitoring**: Set max iterations at 10–15 steps; alert if >5% of runs hit limit
- **Token burn rate anomaly**: Prometheus alert when `rate(agent_tokens_total[5m]) > 3 * avg_over_time(agent_tokens_total[24h])`
- **Pipeline stall**: Tasks in "doing" status >30 min get rolled back; retry limit 3x, then mark failed
- **Boucle Framework** (https://github.com/Bande-a-Bonnot/Boucle-framework): Diagnostic tool classifying loop iterations as productive/stagnating/stuck/failing/recovering. Reads `signals.jsonl`. Python. Early stage.

---

## Stage 8: Context engineering and session handoffs

### Amp's handoff pattern (key architectural insight)
- **Link**: https://ampcode.com/news/handoff
- **Stages**: 8
- **What it does**: Sourcegraph retired `/compact` in Amp, replacing it with `/handoff` — a fundamentally different approach. Instead of lossy summarization, handoff creates a **new thread** by analyzing the current one, generating a draft prompt + relevant file list, and letting the user review before sending. The original thread stays untouched. OpenAI's Codex team confirmed that recursive summaries caused gradual performance decline.
- **Key insight**: Treat context exhaustion as a **coordination problem, not a compression problem**.
- **Composability**: The pattern is highly portable. Any agent system can implement: analyze context → extract relevant state + files → generate structured prompt → human reviews → new session starts.

### context-mode (MCP server)
- **Link**: https://github.com/mksglu/context-mode
- **Stages**: 8
- **What it does**: Addresses three problems simultaneously. **Context saving**: sandboxes tool output (98% reduction — 315KB → 5.4KB). **Session continuity**: captures every edit, git op, task, error, decision in SQLite; on compaction, indexes events via FTS5 and retrieves relevant ones via BM25 search. **Think in code**: LLM writes scripts to analyze data instead of reading it into context.
- **Interface**: MCP plugin. 4 hooks (PreToolUse, PostToolUse, PreCompact, SessionStart). 6 sandbox tools. Per-project SQLite. PreCompact builds priority-tiered XML snapshot (≤2KB).
- **Maturity**: **Growing rapidly** — 66,000+ developers across 12 platforms.
- **Composability**: **Excellent**. MCP-based, SQLite state is portable and inspectable.
- **Gaps**: Hook support varies by platform. No standardized schema.

### claude-code-session-kit
- **Link**: https://github.com/shihchengwei-lab/claude-code-session-kit
- **Stages**: 8
- **What it does**: Four lifecycle hooks: **context-monitor.sh** (40% → wrap up, 60% → save, 70% → STOP), **pre-compact-reminder.sh** (save state before compression), **session-startup.sh** (auto-load previous `session-state.md`), **handoff-check.sh** (validate handoff: commit hash present? summary written? next steps documented?).
- **Interface**: Shell hooks + `session-state.md` Markdown artifact.
- **Maturity**: Early. Developed across 92 real sessions.
- **Composability**: **Maximum**. Pure shell scripts + markdown. No dependencies.
- **Gaps**: No structured schema. Single developer.

### superharness
- **Link**: https://github.com/celstnblacc/superharness
- **Stages**: 8
- **What it does**: Multi-agent session handoff framework. Queue-based task delegation with YAML-based contract system:
  ```
  .superharness/
  ├── contract.yaml      # tasks, decisions, failures
  ├── handoffs/           # session handoff state
  ├── ledger.md           # append-only event log
  ├── decisions.yaml      # cross-agent ADRs
  ├── failures.yaml       # failure memory
  └── inbox.yaml          # dispatch queue
  ```
- **Interface**: YAML/Markdown files, CLI. Works with Claude Code and Codex CLI.
- **Maturity**: Beta (PyPI 1.11.0).
- **Composability**: **Good**. File-based, git-friendly.

### Claude Code native context management

Claude Code provides several composability-relevant primitives. `/compact [instruction]` performs focused summarization. `/clear` wipes history entirely. Auto-compaction triggers at ~95% capacity (configurable via `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`). Subagents (Task tool) spawn work in separate context windows with only summaries returning. `--continue`/`--resume` carry full context state. The hooks system (PreCompact, SessionStart, PreToolUse, PostToolUse) is the integration point for all context engineering tools.

---

## Tools spanning multiple stages

### Tightly coupled multi-stage tools

**Goose** (https://github.com/aaif-goose/goose, 27K+ stars, Apache 2.0): Open-source AI agent with built-in RPI commands, 70+ MCP extensions, YAML "recipes" for portable workflows. Covers stages 1, 2, and 4. Now under Linux Foundation. Coupling is **moderate** — YAML recipes are portable, but RPI commands are built-in rather than standalone.

**Kiro** (kiro.dev): AWS's agentic IDE generating `requirements.md`, `design.md`, `tasks.md` through spec-driven workflow. Covers stages 1 and 2. Coupling is **tight** — generation is tied to the Kiro IDE/CLI. Not open-source.

### Loosely coupled multi-stage tools

**Taskmaster AI** (25K+ stars): Bridges stages 1–2 via MCP + JSON files. **Loose coupling** — works as an MCP server consumable by any client, with tasks as plain JSON.

**Claude Agent SDK**: Spans stages 3 and 4. **Loose coupling** — pure library where your code controls the loop. MCP for tool integration.

**Restate**: Spans stages 3 and 4. **Loose coupling** — single binary, framework-agnostic, durable execution without opinions about agent implementation.

**mcp-agent** (https://github.com/lastmile-ai/mcp-agent, ~8K stars, Apache 2.0): Implements every pattern from Anthropic's "Building Effective Agents" blog post. MCP for tool integration, composable workflow patterns (routers, parallel pipelines, orchestrators), durable agents via Temporal. **Loosely coupled** — MCP as universal interface, code-as-workflow.

**ComposioHQ/agent-orchestrator**: Spans stages 3, 4, and touches 6. Git worktrees + branches + PRs per agent. Reactions system for CI failures and review comments. **Moderately coupled** — agent-agnostic but opinionated about the worktree-per-agent model.

---

## Projects attempting the composable agent toolchain approach

**Turbo/Superpowers** (obra): 60+ skills for Claude Code packaged as modular Markdown-encoded workflows. `/finalize` chains tests → polish → commit → PR. `/audit` fans out to analysis skills. Each skill is self-contained but composable. This is the closest existing project to "Unix-style tools for agents."

**Agent Skills ecosystem** (https://github.com/skillmatic-ai/awesome-agent-skills): Emerging standard for modular `SKILL.md` packages — runtime knowledge and workflows loaded on demand. Supported by Claude Code, Codex CLI, Gemini CLI, Copilot, Cursor. This is the composable tool equivalent of packages on `$PATH`.

**GitHub Spec Kit**: Explicitly designed as composable phases with file-based handoffs. Each phase outputs a Markdown file consumed by the next.

A January 2026 arXiv paper ("From Everything-is-a-File to Files-Are-All-You-Need") argues that Unix's uniform read/write interface maps directly onto how agents interact with their environment. Supporting evidence: GitHub reduced Copilot's tool count from 40+ to 13 core tools and SWE-bench scores **improved 2–5 percentage points**. Vercel deleted 80% of their specialized tools, replacing them with one capability. Anthropic's own guidance: "The most successful implementations weren't using complex frameworks... they were building with simple, composable patterns."

---

## Emerging interface standards between pipeline stages

| Standard | Scope | Status | Governance | Interface |
|----------|-------|--------|------------|-----------|
| **MCP** | Agent ↔ Tool/Data | De facto standard | Linux Foundation | JSON-RPC 2.0 over stdio/HTTP |
| **A2A** | Agent ↔ Agent | Active (v0.3, 150+ orgs) | Linux Foundation | HTTP + SSE + JSON-RPC, gRPC |
| **AGENTS.md** | Agent ↔ Project config | Emerging convention | Community | Markdown files |
| **SKILL.md** | Agent ↔ Capability | Emerging convention | Community | Markdown packages |
| **Agent Protocol** (E2B) | Agent ↔ Runner | **Stalled** | agi-inc | REST/OpenAPI |

**MCP** is the dominant tool-integration standard but carries significant token overhead — independent benchmarks show MCP server integrations are **10–32x more expensive in tokens** vs. equivalent CLI commands. For Unix-philosophy pipelines, CLI tools remain more efficient; MCP is best for dynamic discovery and cross-platform compatibility.

**A2A** (Agent-to-Agent Protocol) by Google defines Agent Cards at `/.well-known/agent.json`, task management with lifecycle states, and artifact exchange. V0.3 adds gRPC. Complementary to MCP: A2A handles agent↔agent, MCP handles agent↔tool. Most relevant for cross-vendor multi-agent scenarios. May be over-engineered for single-developer Unix-style workflows.

**Agent Protocol** (originally E2B) defined two REST routes for task creation and step execution. Effectively **superseded by A2A and MCP**. E2B pivoted to sandboxed execution infrastructure.

---

## Benchmarks comparing monolithic vs. composed approaches

Direct head-to-head benchmarks are scarce, but several data points emerge.

**SWE-bench architecture findings**: The "Agentless" approach (Xia et al., 2024) — simple localization-repair with no complex framework — achieved **competitive SWE-bench performance**, challenging the assumption that framework complexity helps. Anthropic claims their custom harness gives a **10 percentage-point improvement** over minimal harness, suggesting scaffold design matters but doesn't require monolithic frameworks. Multi-agent architectures outpace single-agent for long-horizon tasks as of 2025 per the SWE-EVO paper.

**Framework benchmark** (AIMultiple, 2026, 2,000 runs): LangGraph showed fastest latency. LangChain had highest overall token usage but best per-task efficiency. CrewAI was heaviest. These are all monolithic frameworks — no composed-toolchain comparison was included.

**Composable vs. monolithic analysis** (Tribe AI, 2025): "Composable agents shine in complex, multimodal, or tool-integrated tasks — but for simple Q&A or retrieval, monolithic chains are faster, cheaper, and easier to debug." The acknowledged gaps in composable approaches — orchestration complexity, security, evaluation, state management — are precisely what the 8-stage pipeline addresses.

**Terminal-Bench** (Stanford/Laude Institute, May 2025) and **SWE-Bench Pro** (Scale, 2025) provide more realistic evaluation environments but don't yet compare architectural approaches directly.

---

## Conclusion: the composable stack today and what's still missing

The viable composable pipeline assembles as follows: **Spec Kit or RPI pattern** (stage 1) → **Taskmaster AI** for decomposition with **Plane** for tracking (stage 2) → **XState** or **Restate** for dispatch (stage 3) → **Claude Code CLI** `--bare -p --output-format json` with git worktree isolation (stage 4) → **PR-Agent** with a custom verdict wrapper (stage 5) → **GitHub merge queue** or **Mergify** with label-based agent routing (stage 6) → **OpenLLMetry + Langfuse** (stage 7) → **session-kit hooks + context-mode** (stage 8).

Five critical gaps remain unsolved. First, **no pre-dispatch context estimator** exists — a simple tool counting `file_LOC × 18 + base_overhead` against the context window would be high-value and perhaps 100 lines of code. Second, **typed review verdicts** (ship/revise/rethink) need a standard JSON schema and a thin gating script; the Codex structured review cookbook provides the starting template. Third, **no open-source feature-rich merge queue** survives — bors-ng is deprecated, and the space is SaaS-dominated. Fourth, **cross-session trace IDs** have no standard — Langfuse, Helicone, and Claude Code each define their own session concept. Fifth, **the handoff document schema** is ad-hoc Markdown across all tools; a formal JSON/YAML schema for `session-state` would enable true tool interoperability across stages.

The deepest architectural lesson across all findings: **the filesystem is the universal agent integration layer**. Tools that store state as JSON/YAML/Markdown files in git compose naturally. Tools that hold state in memory, databases, or proprietary APIs create integration friction. The Unix philosophy isn't just an aesthetic preference for agent pipelines — it's the architecture that empirically produces the most composable, debuggable, and resilient multi-agent systems.