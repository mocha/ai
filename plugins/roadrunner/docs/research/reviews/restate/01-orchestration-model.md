# Restate -- Orchestration Model Conformance Evaluation

**Date:** 2026-04-15
**Evaluator:** Claude (automated, from server repo source)
**Source:** `/Users/deuley/code/tools/restate/` (Restate server, Rust)
**Scope:** Evaluating Restate as a durable execution substrate for a composable AI-agent development pipeline (Skylark). This report is based solely on the server repo source code and docs; SDK-specific features (TypeScript, Python) would require separate investigation.

---

## Summary

| Verdict | Count |
|---------|-------|
| MEETS | 5 |
| PARTIAL | 4 |
| DOES NOT MEET | 1 |

**Headline:** Restate provides strong crash-safety, durable state, and parallel execution primitives, but the pipeline definition model is code-first rather than declarative, and DAG dependency tracking must be implemented in user code rather than declared as data.

---

## Per-Requirement Findings

### 1. Declarative pipeline definition

> The pipeline is expressed in a machine-readable format (YAML/TOML/equivalent) separate from any LLM prompt. Stage order, dependencies, and transitions are data, not prose.

**Verdict: DOES NOT MEET**

**Evidence:**
Restate's service definition model is code-first. Services, Virtual Objects, and Workflows are defined in SDK code (TypeScript, Python, Java, Go, Rust) and discovered at runtime via an endpoint manifest (`service-protocol/endpoint_manifest_schema.json`). The manifest declares service names, handler names, types (`SERVICE`, `VIRTUAL_OBJECT`, `WORKFLOW`), and handler metadata -- but it is auto-generated from code, not authored as a standalone pipeline definition.

The endpoint manifest schema (lines 1-302 of `endpoint_manifest_schema.json`) contains `services[].handlers[]` with fields for `name`, `ty` (handler type), input/output schemas, retry policies, and custom `metadata` -- but there is no concept of stage ordering, `blocked_by` relations, or transition rules in this schema.

**Notes:**
- You could build a declarative layer on top: define your pipeline as YAML, then generate Restate Workflow code from it. But Restate itself does not provide this.
- XState is also code-first in practice (machines defined in JS/TS), but its machine definition is a pure data structure (JSON-serializable). Restate's Workflow handlers are imperative code.
- The custom `metadata` field on handlers (`"additionalProperties": {"type": "string"}`) could carry stage metadata, but the server does not interpret it for orchestration.

---

### 2. Bounded orchestrator context

> The orchestrator's working context has a measurable ceiling (target <=20K tokens) that is invariant to pipeline length or run count.

**Verdict: PARTIAL**

**Evidence:**
Restate's execution model is inherently bounded in memory per invocation. The server maintains:
- K/V state per service instance (`crates/storage-api/src/state_table/mod.rs`) -- stored in RocksDB, not in memory
- A journal of execution steps (`crates/types/src/journal/mod.rs`, `crates/types/src/journal_v2/mod.rs`) -- persisted to Bifrost (the WAL)
- Eager state loading has explicit budget limits (`crates/invoker-impl/src/invocation_task/mod.rs:99` -- `collect_eager_state` with size limits, `INVOKER_EAGER_STATE_TRUNCATED` metric)
- Per-invocation memory pools (`InvocationStateMachine.budget: Option<LocalMemoryPool>` in `invocation_state_machine.rs:59`)

The orchestrator (your Workflow handler code running in an SDK) receives state on-demand and writes it back. It does NOT accumulate unbounded conversation history -- each step is journaled independently.

However, the "context" of the orchestrator is your Workflow handler code execution, which Restate suspends and resumes. The context ceiling depends on your implementation -- Restate provides the tools (K/V state, journal) to keep it bounded, but does not enforce a token limit. Your handler could load unbounded data if poorly written.

**Notes:**
- This is actually a strength for our use case: if we store pipeline state as K/V pairs and read only what's needed per step, context stays bounded naturally.
- The journal itself grows with each step, but replay only re-executes side effects (Run entries), not re-reads completed results -- completed steps are served from the journal.
- Compare to XState: XState's context is explicitly bounded by the machine definition (finite states, typed context). With discipline, both can achieve bounded context.

---

### 3. Typed state transitions

> Every pipeline step has a typed status (`pending`, `in_progress`, `complete`, `failed`, `needs_review`, `blocked`). Transitions are explicit; re-entry from any terminal state is supported.

**Verdict: PARTIAL**

**Evidence:**
Restate has its own typed invocation status model (`crates/storage-api/src/invocation_status_table/mod.rs:141-154`):

```rust
pub enum InvocationStatus {
    Scheduled(ScheduledInvocation),
    Inboxed(InboxedInvocation),
    Invoked(InFlightInvocationMetadata),
    Suspended { metadata, waiting_for_notifications },
    Paused(InFlightInvocationMetadata),
    Completed(CompletedInvocation),
    Free,
}
```

These are infrastructure-level states for an invocation, not pipeline-step-level states. There is no built-in concept of `needs_review` or `blocked` as pipeline states.

For Workflows specifically:
- A Workflow handler runs once per key (exactly-once semantics via `WORKFLOW_ALREADY_INVOKED_INVOCATION_ERROR` in `tests/workflow.rs:17`)
- Shared handlers can query workflow state while the workflow runs
- `restart_as_new` (`lifecycle/restart_as_new.rs`) enables re-entry from a completed state with a new invocation

Restate also tracks timestamps for each transition (`StatusTimestamps` with `inboxed_transition_time`, `scheduled_transition_time`, `running_transition_time`, `completed_transition_time`).

**Notes:**
- You would model pipeline step statuses as K/V state within a Virtual Object or Workflow, not as Restate invocation statuses. This is entirely feasible but is application-level code, not infrastructure.
- XState natively provides exactly the typed state model our requirement describes. With Restate, you build it.
- The `Paused` state and `manual_resume` lifecycle handler (`lifecycle/manual_resume.rs`) are notable -- they provide explicit human-pausable semantics.

---

### 4. Disk-first state resolution

> The orchestrator determines the current pipeline state by reading persisted artifacts, not by recalling conversation history.

**Verdict: MEETS**

**Evidence:**
This is a core Restate design principle. All state is persisted to disk:
- K/V state is stored in RocksDB via the partition store (`crates/storage-api/src/state_table/mod.rs` -- `ReadStateTable::get_user_state`, `WriteStateTable::put_user_state`)
- The execution journal is written to Bifrost (a replicated WAL) and materialized into the partition store
- On recovery, state is rebuilt from the log + snapshots (`crates/types/src/config/worker.rs:69-86` describes snapshot-based recovery)
- Promises are persisted (`crates/storage-api/src/promise_table/mod.rs` -- `ReadPromiseTable`, `WritePromiseTable`)

The `InvocationStateMachine` in `crates/invoker-impl/src/invocation_state_machine.rs` explicitly tracks what has been durably stored (`JournalTracker`) before allowing retries. The `can_retry` method (line 104) checks that all commands have been acknowledged by the partition processor before permitting a retry.

**Notes:**
- This is Restate's defining advantage over XState for our use case. XState machines live in memory; you must build your own persistence layer. Restate's entire architecture is disk-first.
- For our pipeline: step results, review decisions, and artifact paths would be K/V state entries, persisted automatically by Restate and queryable at any time.

---

### 5. DAG dependency tracking

> Steps declare `blocked_by` relations. Completion of one step automatically unblocks dependents.

**Verdict: PARTIAL**

**Evidence:**
Restate does not have a built-in DAG scheduler. However, it provides the primitives to build one:

- **Durable Promises** (`GetPromise`, `CompletePromise` in `crates/types/src/journal/entries.rs:34-36`) -- a step can await a named promise that another step completes. This is the exact "completion unblocks dependent" pattern.
- **Awakeables** (`crates/ingress-http/src/handler/awakeables.rs`) -- external systems can signal Restate invocations, enabling cross-step unblocking.
- **Signals** (`SendSignal` command in `crates/types/src/journal_v2/command.rs:66`) -- protocol v4+ supports named signals between invocations.
- **Call/OneWayCall** -- one handler can invoke another, creating implicit dependency chains.

The missing piece: there is no declarative `blocked_by` syntax. You express dependencies imperatively: `await ctx.promise("step-A-done")` in step B's handler. Restate guarantees the durability of the wait and the signal.

**Notes:**
- In the Workflow service type, you'd express the DAG as a sequence of `ctx.run()` and `ctx.call()` operations in the workflow handler, with `ctx.promise()` for cross-step synchronization.
- XState has explicit `blocked_by`-equivalent via state chart hierarchy and guard conditions -- more natural for declaring a DAG.
- Restate's approach is more flexible (arbitrary runtime logic in dependency resolution) but less inspectable (dependencies are in code, not data).

---

### 6. Bounded reasoning for edge cases

> The orchestrator follows the declarative plan for the happy path but has a constrained reasoning affordance for naming/pattern mismatches without requiring code changes to the state machine.

**Verdict: PARTIAL**

**Evidence:**
Restate is infrastructure -- it does not reason about anything. It executes handler code deterministically. The "reasoning affordance" would live entirely in your handler implementation.

However, Restate provides features that support this pattern:
- **Shared handlers** on Virtual Objects and Workflows (`WorkflowHandlerType::Shared` in `crates/types/src/invocation/mod.rs:82-96`) can be called at any time during a workflow's execution, allowing external "reasoning" queries
- **K/V state** is readable from shared handlers, so an edge-case handler could inspect state and make adjustments
- **Custom metadata** on handlers (`metadata` field in endpoint manifest) could carry classification hints

**Notes:**
- In practice, for our pipeline, the "bounded reasoning" would be a Claude Code call within a `ctx.run()` step that examines file paths and makes naming corrections. Restate would durably execute this reasoning step and journal the result.
- XState's guard conditions and dynamic transitions are a more natural fit for this requirement -- they're part of the machine definition.
- Neither Restate nor XState natively constrains reasoning to a token budget; that's application-layer logic.

---

### 7. Explicit resume semantics

> Any new orchestrator session can resume at the last terminal artifact state, without replaying prior conversation.

**Verdict: MEETS**

**Evidence:**
This is the core durable execution guarantee. From `crates/types/src/journal/mod.rs:12`:

> "To implement the Durable execution, we model the invocation state machine using a journal."

On resume after crash or restart:
1. The partition processor rebuilds state from Bifrost (the replicated log) and snapshots
2. The invoker replays the journal to the SDK -- completed steps are served from the journal without re-execution
3. The `RunEntry` result (side effect) is stored durably; on replay, the stored result is returned without re-executing the side effect
4. Suspended invocations (`InvocationStatus::Suspended` with `waiting_for_notifications`) resume exactly where they left off when the awaited notification arrives

The `invocation_state_machine.rs` explicitly manages this:
- `AttemptState::New` -> `AttemptState::InFlight` -> `AttemptState::WaitingRetry` cycle
- `JournalTracker` ensures all commands are stored before allowing retry
- `start_message_retry_count_since_last_stored_command` tracks replay state

`restart_as_new` (`crates/worker/src/partition/state_machine/lifecycle/restart_as_new.rs`) provides an even stronger form: re-invoke a completed workflow with a new invocation ID, optionally copying journal prefix.

**Notes:**
- This is Restate's strongest differentiator vs XState. With XState, you must serialize machine state to disk yourself and reload it on restart.
- The journal replay mechanism means our pipeline handler would resume mid-execution automatically after a crash -- no explicit "where was I?" logic needed.

---

### 8. Parallel fan-out

> Independent DAG branches can run concurrently; the orchestrator schedules them without serializing.

**Verdict: MEETS**

**Evidence:**
Restate supports concurrent invocations natively:

- **`Call` and `OneWayCall`** commands (`crates/types/src/journal_v2/command.rs:63-64`) allow a workflow to invoke multiple handlers concurrently
- **Service type** handlers (stateless) have no concurrency restrictions -- multiple instances run in parallel
- **Virtual Object `Shared` handlers** (`VirtualObjectHandlerType::Shared` in `invocation/mod.rs:71-74`) allow concurrent reads while exclusive handlers serialize writes
- **Workflow `Shared` handlers** similarly allow concurrent access during workflow execution

The invoker manages concurrency via:
- `ConcurrencySlot` quota system (`crates/invoker-impl/src/quota.rs`)
- `TokenBucket` for rate limiting (`crates/invoker-api/src/capacity/`)
- `JoinSet` for managing concurrent invocation tasks

For fan-out specifically:
- A workflow handler calls N sub-handlers via `ctx.call()` (or `ctx.send()` for fire-and-forget)
- Each call is a separate invocation with its own journal, retry policy, and lifecycle
- The workflow can `await` all N results (SDK-level; server delivers completions as they arrive)

**Notes:**
- The server-side fan-out is not a DataFusion-style parallel query (`storage-query-datafusion/src/node_fan_out.rs` is for internal query distribution) -- it's invocation-level concurrency.
- For our pipeline: `prepare` and `spec-review` could run in parallel as separate invocations from the workflow handler. Restate would track each independently and deliver results durably.
- XState supports parallel states natively. Restate's approach is more explicit (you issue N calls) but equally capable.

---

### 9. No substantive delegation of domain decisions

> The orchestrator never decides "is this spec approved?" or "is this code correct?" -- those are always delegated to specialized workers or to human gates.

**Verdict: MEETS**

**Evidence:**
Restate's architecture enforces this by design:

- The Restate server is a pure execution substrate. It never interprets the content of invocation payloads (`Bytes`), state values, or promise resolutions. See `crates/types/src/journal/entries.rs` -- all results are opaque `Bytes` or `EntryResult::Success(Bytes) / Failure(code, message)`.
- **Durable Promises** (`GetPromise`, `CompletePromise`) are the mechanism for human gates: a workflow suspends waiting for a named promise, and an external actor (human, review bot) completes it via the HTTP API.
- **Awakeables** (`crates/ingress-http/src/handler/awakeables.rs`) provide the same pattern for external signal injection -- the handler at `/restate/awakeables/{id}/resolve` or `.../reject` lets any external system provide the decision.
- **Signals** (v4+) extend this to named, typed signals between invocations.

The server explicitly does NOT:
- Evaluate invocation results for correctness
- Decide whether to retry based on result content (only on failure codes)
- Interpret K/V state values

**Notes:**
- This is a perfect fit for our architecture. The orchestrator workflow calls Claude Code workers (via `ctx.call()` or `ctx.run()`), and review decisions come back as completed promises from human reviewers or specialized review agents.
- The `Paused` state (`InvocationStatus::Paused`) and `manual_resume` handler provide an explicit pause-for-human-input mechanism.
- XState can also enforce this via action/guard separation, but there's no infrastructure-level guarantee -- it's a design discipline.

---

### 10. Crash-safe transitions

> A mid-transition crash leaves the pipeline in a recoverable state; no transition writes are half-applied.

**Verdict: MEETS**

**Evidence:**
Crash safety is Restate's primary architectural concern. The mechanisms:

1. **Bifrost WAL** -- All commands are written to a replicated write-ahead log before being applied. The `wal-protocol` crate (`crates/wal-protocol/src/lib.rs:137`) defines the `Command` enum for all state-mutating operations. Commands are atomically written to the log.

2. **Journal tracking** -- The `JournalTracker` in `invocation_state_machine.rs:76-131` ensures that before any retry, all previously-sent commands have been acknowledged as stored:
   ```
   fn can_retry(&self) -> bool {
       // last_acked_command >= last_proposed_command
   }
   ```

3. **Partition processor state machine** -- State transitions are applied within a single partition processor, which processes commands sequentially from the log. A crash means replay from the last checkpoint (snapshot + log tail).

4. **Exactly-once semantics** -- Idempotency keys (`IdempotencyId` in `crates/types/src/identifiers.rs`) prevent duplicate execution. Completed invocations with idempotency keys are retained for a configurable duration.

5. **RocksDB + snapshots** -- Partition state is stored in RocksDB with configurable WAL and snapshotting (`crates/types/src/config/worker.rs:76-86`). Durability modes include requiring replication to all nodes before allowing log trimming.

6. **Entry-level atomicity** -- Each journal entry is individually persisted. If a crash occurs between step N and step N+1, step N's result is durable and step N+1 has not started. The `RunEntry` (`crates/types/src/journal/entries.rs:406`) captures side effect results atomically.

**Notes:**
- This is the most significant advantage over XState. XState provides no crash safety -- if the process dies mid-transition, state is lost unless you've built your own persistence.
- For our pipeline: if the server crashes while Claude Code is writing a spec, the spec-write step's partial result is NOT committed. On restart, the step retries from scratch (or from the last committed sub-step if using `ctx.run()` within the handler).
- The `on_max_attempts` behavior (`PAUSE` or `KILL` in `endpoint_manifest_schema.json:204-209`) determines what happens when retries are exhausted -- `PAUSE` keeps the invocation in a recoverable state.

---

## Surprises

### Positive
1. **`restart_as_new` for long-running workflows** -- Restate can restart a completed workflow with a new invocation while preserving journal prefix. This is ideal for pipelines that need to re-run with modified parameters.
2. **VQueues and scheduling** -- The codebase contains a virtual queue (`vqueues`) and DRR (Deficit Round Robin) scheduler (`crates/vqueues/src/scheduler/drr.rs`), providing fair scheduling across competing invocations. This is more sophisticated than expected for our use case.
3. **Budgeted state loading** -- `get_all_user_states_budgeted` in `state_table/mod.rs` provides memory-bounded state reads with `LocalMemoryPool` tracking. This aligns well with our bounded-context requirement.
4. **SQL introspection** -- DataFusion integration (`crates/storage-query-datafusion/`) means you can query invocation state, journal entries, and K/V state via SQL. Extremely useful for pipeline observability.

### Negative
1. **No declarative pipeline format** -- The biggest gap. Every other orchestration concern has a solid answer, but you still write imperative handler code to define the pipeline flow.
2. **Heavy operational footprint** -- The server uses jemalloc, RocksDB, Bifrost (replicated log), partition management, snapshot storage (S3-compatible), and a metadata store. The `Cargo.toml` dependency tree is substantial. This is a distributed systems runtime, not a lightweight library.
3. **AI agent support is SDK-side** -- The README links to `restatedev/ai-examples` and lists "Durable AI Agents" as a use case, but the server itself has no AI-specific code. A2A protocol support, agent framework integrations, and LLM-specific patterns would all be SDK-level. We could not evaluate these from this repo.
4. **Workflow is single-execution** -- A Restate Workflow handler runs exactly once per key. If you want to re-run the same pipeline with the same key, you need `restart_as_new` or a new key. This differs from XState where you can restart a machine in-place.

---

## Comparison Notes vs XState

### Where Restate is stronger

| Concern | Restate | XState |
|---------|---------|--------|
| **Crash recovery** | Built-in, journal-based, automatic | Must build yourself (serialize to disk, reload) |
| **Exactly-once execution** | Guaranteed by infrastructure (journal replay, idempotency) | Must build yourself |
| **Distributed execution** | Native -- handlers can run on different processes/machines | Single-process library |
| **Retry/backoff** | Configurable per-handler with exponential backoff, jitter, max attempts, pause-on-exhaustion | Must implement yourself |
| **Human-in-the-loop** | Durable Promises + Awakeables + Signals -- first-class, crash-safe | Must build custom event handling |
| **Observability** | SQL queries over invocation state, OpenTelemetry tracing, CLI/UI | Must integrate your own tooling |
| **State persistence** | Automatic, RocksDB-backed, replicated | In-memory unless you persist manually |

### Where XState is stronger

| Concern | XState | Restate |
|---------|--------|---------|
| **Declarative definition** | Machine is a pure data structure (JSON-serializable), inspectable | Imperative handler code |
| **Typed state model** | States, transitions, guards, actions are first-class | Invocation status is infra-level; app states are K/V |
| **DAG as data** | State chart hierarchy naturally expresses dependencies | Dependencies are imperative code |
| **Operational overhead** | Zero -- it's an npm package | Full server: RocksDB, Bifrost, partitions, metadata store |
| **Small sharp tools** | Embeds in your process, no external dependencies | Separate server process with significant resource needs |
| **Visualization** | XState Visualizer renders machine graphs | No built-in pipeline visualization |
| **Simplicity** | ~10 LOC to define a state machine | Requires SDK, server deployment, service discovery |

### For our specific use case

Our pipeline (triage -> prepare -> spec-review -> write-plan -> plan-review -> develop -> finish) with Claude Code workers, file-based artifacts, and git worktrees:

**Restate's natural fit:**
- Crash recovery during long-running Claude Code invocations (minutes per step)
- Durable promises for human review gates (spec-review, plan-review)
- Parallel fan-out for independent develop tasks
- K/V state for artifact paths and step results
- Exactly-once guarantees for idempotent pipeline runs

**XState's natural fit:**
- Declarative pipeline definition as data (YAML -> XState machine)
- Explicit typed states matching our status model exactly
- Embeds in the orchestrator process (no external server)
- Visual pipeline debugging via XState Visualizer
- Lower operational burden for a single-developer workflow

**The fundamental tension:**
Restate gives you durable execution for free but requires you to build the pipeline abstraction on top. XState gives you the pipeline abstraction for free but requires you to build durable execution on top.

For a single-developer agent pipeline, the question is: is durable execution worth running a server? If pipeline runs are long (hours, with human gates), the answer leans yes. If pipeline runs are short and you can tolerate manual restarts on failure, XState with file-based checkpointing may be sufficient.

---

## Open Questions for Trial

1. **Latency overhead for subprocess invocation.** Our workers are Claude Code CLI processes. What is the added latency of routing through Restate (HTTP call -> Restate server -> HTTP call to handler -> subprocess -> result back) versus direct subprocess invocation?

2. **SDK workflow ergonomics.** How natural is it to express our pipeline DAG in the TypeScript or Python SDK? Can we define the stage graph as data and generate the workflow handler, or must it be hand-coded?

3. **State size limits.** If a Claude Code step produces 50KB of output, does that fit comfortably in K/V state? What are the practical limits before performance degrades?

4. **Promise-based human review.** Can we build a CLI or simple web UI that lists pending durable promises and resolves them? How does this integrate with our existing review workflow?

5. **Operational reality.** How much memory/CPU does the Restate server consume at rest? During a pipeline run? Is the resource overhead acceptable for a development laptop?

6. **AI agent SDK patterns.** The `restatedev/ai-examples` repo is referenced but lives outside this server repo. What patterns exist for LLM tool use, agent loops, and context management?

7. **Hot reload of pipeline definitions.** If we change the pipeline (add a stage, modify dependencies), can we deploy the new handler version and have in-flight runs pick it up? Or do they pin to the original deployment?

8. **Git worktree integration.** Can we store worktree paths as K/V state and have worker handlers operate within them? Are there path-length or encoding issues with Restate's Bytes-based storage?

---

## Source Index

Files and directories actually read during this evaluation:

### Top-level
- `/Users/deuley/code/tools/restate/README.md` -- Overview, use cases, installation
- `/Users/deuley/code/tools/restate/AGENTS.md` (= `CLAUDE.md`) -- Development guidelines, code style

### Service protocol
- `/Users/deuley/code/tools/restate/service-protocol/endpoint_manifest_schema.json` -- Endpoint manifest v3 schema (service/handler/type definitions)
- `/Users/deuley/code/tools/restate/crates/types/src/service_protocol.rs` -- Protocol version negotiation, protobuf conversions

### Types (core data model)
- `/Users/deuley/code/tools/restate/crates/types/src/invocation/mod.rs` -- `ServiceType` (Service/VirtualObject/Workflow), `WorkflowHandlerType`, `InvocationTargetType`
- `/Users/deuley/code/tools/restate/crates/types/src/journal/mod.rs` -- Journal model documentation
- `/Users/deuley/code/tools/restate/crates/types/src/journal/entries.rs` -- Entry types (GetState, SetState, Call, Run, Awakeable, Promise, etc.)
- `/Users/deuley/code/tools/restate/crates/types/src/journal_v2/mod.rs` -- Journal v2 entry types, command types
- `/Users/deuley/code/tools/restate/crates/types/src/journal_v2/command.rs` -- Command enum (all SDK commands: Call, Run, GetPromise, Sleep, etc.)
- `/Users/deuley/code/tools/restate/crates/types/src/retries.rs` -- RetryPolicy (FixedDelay, Exponential), RetryIter
- `/Users/deuley/code/tools/restate/crates/types/src/config/worker.rs` -- WorkerOptions, InvokerOptions, StorageOptions
- `/Users/deuley/code/tools/restate/crates/types/src/config/common.rs` -- CommonOptions, listener configuration

### Storage API
- `/Users/deuley/code/tools/restate/crates/storage-api/src/invocation_status_table/mod.rs` -- `InvocationStatus` enum (Scheduled/Inboxed/Invoked/Suspended/Paused/Completed/Free), `StatusTimestamps`
- `/Users/deuley/code/tools/restate/crates/storage-api/src/state_table/mod.rs` -- K/V state API (ReadStateTable, WriteStateTable, budgeted reads)
- `/Users/deuley/code/tools/restate/crates/storage-api/src/promise_table/mod.rs` -- Promise API (PromiseState, ReadPromiseTable, WritePromiseTable)

### Invoker
- `/Users/deuley/code/tools/restate/crates/invoker-impl/src/lib.rs` -- Invoker entry point, Notification types, InvocationTaskRunner trait
- `/Users/deuley/code/tools/restate/crates/invoker-impl/src/invocation_state_machine.rs` -- InvocationStateMachine, AttemptState (New/InFlight/WaitingRetry), JournalTracker, RetryPolicyState
- `/Users/deuley/code/tools/restate/crates/invoker-impl/src/invocation_task/mod.rs` -- InvocationTask, service protocol version headers
- `/Users/deuley/code/tools/restate/crates/invoker-impl/src/invocation_task/service_protocol_runner_v4.rs` -- V4+ protocol runner

### Worker (partition processor)
- `/Users/deuley/code/tools/restate/crates/worker/src/partition/state_machine/mod.rs` -- Partition processor state machine, command handling
- `/Users/deuley/code/tools/restate/crates/worker/src/partition/state_machine/lifecycle/suspend.rs` -- Suspend/resume logic, notification-based wakeup
- `/Users/deuley/code/tools/restate/crates/worker/src/partition/state_machine/lifecycle/purge.rs` -- Purge invocation (cleanup for workflows)
- `/Users/deuley/code/tools/restate/crates/worker/src/partition/state_machine/tests/workflow.rs` -- Workflow lifecycle tests (start, duplicate rejection, output, completion)

### Ingress HTTP
- `/Users/deuley/code/tools/restate/crates/ingress-http/src/handler/awakeables.rs` -- HTTP handler for resolving/rejecting awakeables
- `/Users/deuley/code/tools/restate/crates/ingress-http/src/handler/service_handler.rs` -- Service invocation HTTP handler
- `/Users/deuley/code/tools/restate/crates/ingress-http/src/handler/path_parsing.rs` -- URL routing (workflow attach/output, invocation targeting)

### WAL Protocol
- `/Users/deuley/code/tools/restate/crates/wal-protocol/src/lib.rs` -- Command enum (Invoke, Timer, InvokerEffect, etc.)

### Server
- `/Users/deuley/code/tools/restate/server/src/main.rs` -- Server entry point, configuration loading

### Documentation
- `/Users/deuley/code/tools/restate/docs/dev/development-guidelines.md` -- Development practices
