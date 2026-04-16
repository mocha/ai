# XState -- Orchestration Model Conformance Evaluation

**Library**: XState v5 (monorepo at `packages/core/`)
**Evaluation date**: 2026-04-15
**Evaluator context**: Assessing XState as a library for building a deterministic AI-agent pipeline orchestrator (triage -> prepare -> spec-review -> write-plan -> plan-review -> develop -> finish).

---

## Summary

| Verdict | Count |
|---------|-------|
| MEETS | 4 |
| PARTIAL | 4 |
| DOES NOT MEET | 2 |

**Headline**: XState provides strong primitives for declarative state machines, typed transitions, parallel fan-out, and persistence/resume -- but it has no native DAG dependency tracker, no disk-first state resolution, and no built-in crash-safe transactional writes. The library is a solid foundation that requires non-trivial integration code for several orchestration requirements.

---

## Per-Requirement Findings

### 1. Declarative pipeline definition

**Verdict**: MEETS

**Evidence**: XState machine definitions are plain JavaScript/TypeScript objects passed to `createMachine()` or `setup().createMachine()`. The config is a JSON-serializable structure with `states`, `on`, `invoke`, `initial`, `type`, `guard`, etc. XState ships a formal JSON Schema for machine definitions at `packages/core/src/machine.schema.json` that validates state node types (`atomic`, `compound`, `parallel`, `final`, `history`), transitions, invocations, and actions. The `StateMachine` class exposes a `.definition` getter and `.toJSON()` method that serialize the machine to a portable format.

```typescript
// From StateMachine.ts
public get definition(): StateMachineDefinition<TContext, TEvent> {
  return this.root.definition;
}
public toJSON() {
  return this.definition;
}
```

Stage order, transitions, and dependencies are expressed as data (the config object), not prose. The config object can be loaded from a YAML/TOML file and fed to `createMachine()` at runtime, with implementations (actions, guards, actors) injected separately via `machine.provide()`.

**Notes**: The separation between machine config (data) and implementations (code) via `setup()` and `.provide()` is architecturally clean. However, XState configs are TypeScript objects, not YAML/TOML natively -- you would need a thin loader layer to read from your preferred format and hydrate into an XState config. The `machine.schema.json` could validate configs at load time.

---

### 2. Bounded orchestrator context

**Verdict**: PARTIAL

**Evidence**: XState machine context is a typed object (`TContext`) that you define at machine creation time. It can hold arbitrary data and has no built-in size ceiling. The `getPersistedSnapshot()` method serializes the full context, state value, children, and history value. There is no native mechanism to measure or limit context size in tokens.

The `assign()` action is the only way to modify context, which gives you a single point of control:

```typescript
// From actions/assign.ts - all context mutations go through assign()
entry: assign({ count: ({ context }) => context.count + 1 })
```

**Notes**: XState does not impose or measure a token budget. You can architect a bounded context by design -- storing only IDs and metadata in the machine context while keeping artifacts on disk -- but XState itself provides no enforcement. The `getPersistedSnapshot()` output size is proportional to context size, which you control. A wrapper that measures `JSON.stringify(actor.getPersistedSnapshot()).length` against a ceiling is trivial to build but is your responsibility.

---

### 3. Typed state transitions

**Verdict**: MEETS

**Evidence**: XState v5 has a strongly typed snapshot status system defined in `types.ts`:

```typescript
export type SnapshotStatus = 'active' | 'done' | 'error' | 'stopped';
```

Machine snapshots are discriminated unions across four status types (`ActiveMachineSnapshot`, `DoneMachineSnapshot`, `ErrorMachineSnapshot`, `StoppedMachineSnapshot`) defined in `State.ts`. State values are fully typed -- `TStateValue` captures the exact union of valid state paths at the type level.

The `setup()` API provides comprehensive type inference for events, context, guards, and actions. Guards (`and()`, `or()`, `not()`, `stateIn()`) allow conditional transitions. The `always` (eventless) transitions enable routing logic. Re-entry from any state is supported via explicit transitions -- you can always define `on: { RETRY: 'someState' }` from any state.

The `snapshot.matches('stateName')` and `snapshot.hasTag('tagName')` methods provide runtime state queries. The `snapshot.can(event)` method checks if a transition is possible without executing it.

**Notes**: The built-in `SnapshotStatus` has four values (`active`/`done`/`error`/`stopped`), not the six in the requirement (`pending`/`in_progress`/`complete`/`failed`/`needs_review`/`blocked`). However, these pipeline-specific statuses would be modeled as XState *state nodes*, not snapshot statuses -- which is the correct design. Each pipeline step would be a compound state with child states for `pending`, `in_progress`, etc. This is fully natural in XState.

---

### 4. Disk-first state resolution

**Verdict**: PARTIAL

**Evidence**: XState provides the persistence primitives but does not itself read from disk. The round-trip works as follows:

1. **Persist**: `actor.getPersistedSnapshot()` produces a JSON-serializable representation of the machine's full state, including context, state value, history, and all child actor states (recursively).

2. **Restore**: `createActor(machine, { snapshot: persistedState }).start()` rehydrates from a persisted snapshot. The `restoreSnapshot()` method in `StateMachine.ts` reconstructs the state node graph, child actors, and history values from the serialized form.

3. **Resolve from value**: `machine.resolveState({ value: 'someState', context: {...} })` creates a valid snapshot from just a state value and context, without needing the full persisted form.

The MongoDB persistence example (`examples/mongodb-persisted-state/main.ts`) and file-based example (`examples/persisted-donut-maker/main.ts`) demonstrate the pattern of persisting on every transition and restoring on startup.

**Notes**: XState provides the serialize/deserialize machinery but has no opinion about *where* state lives. The "disk-first" behavior must be built: read persisted state from disk, create actor with that snapshot, then persist after each transition. The library does not "determine current state by reading artifacts" -- you build that by wiring `getPersistedSnapshot()` to your storage layer. The primitives are excellent; the integration is yours.

---

### 5. DAG dependency tracking

**Verdict**: DOES NOT MEET

**Evidence**: XState has no native concept of `blocked_by` relations or DAG dependency resolution. The library provides:

- **Parallel states** (`type: 'parallel'`) for concurrent execution of independent branches
- **`onDone` transitions** on parallel states that fire when all child regions reach a `final` state
- **Guard-based conditional transitions** for routing
- **`always` (eventless) transitions** for immediate routing based on context

However, these are state machine primitives, not a DAG scheduler. Parallel states in XState are orthogonal regions that always all activate simultaneously -- you cannot express "branch B is blocked until branch A completes" within a parallel state. You would need to model DAG dependencies as explicit state machine topology (compound states with sequential/parallel nesting) or as context-tracked metadata with guard-based unblocking.

**Notes**: Building a DAG tracker on XState requires modeling the dependency graph in context and using guards to check `blocked_by` conditions before transitions. This is feasible but is a significant design exercise. The `onDone` mechanism on parallel states handles the "join" case (all branches complete -> proceed), but partial unblocking of individual dependents requires custom logic. This is a fundamental gap between "state machine" and "workflow DAG engine."

---

### 6. Bounded reasoning for edge cases

**Verdict**: PARTIAL

**Evidence**: XState guards provide a constrained decision mechanism:

```typescript
// From guards.ts
export function evaluateGuard(guard, context, event, snapshot): boolean
```

Guards receive `{ context, event }` and return a boolean. They can inspect context and the current event to make routing decisions. The `always` transitions with guards provide a pattern for conditional routing without explicit events:

```typescript
// From workflow-credit-check example
DetermineCompletion: {
  always: [
    { guard: ({ context }) => context.creditCheck?.decision === 'Approved', target: 'StartApplication' },
    { guard: ({ context }) => context.creditCheck?.decision === 'Denied', target: 'RejectApplication' },
    { target: 'RejectApplication' }
  ]
}
```

This provides a *constrained* reasoning affordance -- guards can inspect context to handle naming/pattern mismatches -- but the reasoning is limited to what you encode in the guard functions. There is no LLM-in-the-loop reasoning primitive.

**Notes**: The `@statelyai/agent` package (LLM integration) is *not* present in the monorepo -- it lives in a separate repository. Without it, XState has no native LLM reasoning affordance. Guards provide deterministic reasoning but not the "fuzzy matching" that this requirement implies. You could implement a guard that calls an LLM for edge-case resolution, but that is entirely custom code.

---

### 7. Explicit resume semantics

**Verdict**: MEETS

**Evidence**: The persistence/rehydration round-trip is XState's primary resume mechanism:

```typescript
// From rehydration.test.ts - demonstrates full round-trip
const actorRef = createActor(machine).start();
const persistedState = actorRef.getPersistedSnapshot();
actorRef.stop();

const rehydratedActor = createActor(machine, { snapshot: persistedState }).start();
```

Key properties verified by tests in `rehydration.test.ts`:
- Actions from previous sessions are NOT replayed on resume
- Child actors are correctly rehydrated (including deep nesting)
- Done/error states are correctly restored
- Rehydrated child actors are registered in the system
- Done children do NOT re-notify parents on rehydration
- Tags, `can()`, and `matches()` work immediately after rehydration

The `resolveState()` method provides an alternative entry point that reconstructs a valid snapshot from just a state value and context, without needing the full serialized snapshot.

**Notes**: Resume requires no conversation replay. A new orchestrator process reads the persisted snapshot from disk, creates an actor with it, and continues from exactly where the previous session left off. This is a first-class, well-tested capability.

---

### 8. Parallel fan-out

**Verdict**: MEETS

**Evidence**: XState natively supports parallel states via `type: 'parallel'`:

```typescript
// From examples/workflow-parallel/main.ts
ParallelExec: {
  type: 'parallel',
  states: {
    ShortDelayBranch: {
      initial: 'active',
      states: {
        active: { invoke: { src: 'shortDelay', onDone: 'done' } },
        done: { type: 'final' }
      }
    },
    LongDelayBranch: {
      initial: 'active',
      states: {
        active: { invoke: { src: 'longDelay', onDone: 'done' } },
        done: { type: 'final' }
      }
    }
  },
  onDone: 'Success'  // fires when ALL branches reach final
}
```

Parallel state regions are simultaneously active. Each region can invoke its own actors (promises, callbacks, observables, or child machines). The `onDone` transition on a parallel state fires when every child region reaches a `final` state -- providing a natural join/barrier.

Spawned actors (`spawn()` in context initialization or `spawnChild()` action) provide dynamic fan-out beyond static parallel regions.

**Notes**: This is a direct, well-supported use case. The parallel state + `onDone` join pattern is exactly what's needed for scheduling independent DAG branches concurrently. The actual *execution* of the work (e.g., invoking Claude Code CLI) would be modeled as invoked promise or callback actors within each parallel branch.

---

### 9. No substantive delegation of domain decisions

**Verdict**: MEETS

**Evidence**: XState's architecture inherently supports this. The machine defines *topology* (what runs next), while invoked actors do the actual work. The pattern is:

1. State machine defines transitions: `specReview -> { onDone: 'evaluateApproval' }`
2. Invoked actor (promise/callback) performs the work and returns a result
3. Guard evaluates the result: `guard: ({ context }) => context.reviewResult === 'approved'`
4. Machine transitions based on the guard's boolean return

The machine never decides "is this spec approved?" -- it only routes based on the outcome reported by the worker. Domain decisions are always in the invoked actors or in external inputs (events).

**Notes**: This is a design principle, not a hard enforcement -- nothing prevents you from putting domain logic in a guard. But the architecture naturally separates orchestration (machine) from domain work (invoked actors), which aligns perfectly with the requirement.

---

### 10. Crash-safe transitions

**Verdict**: DOES NOT MEET

**Evidence**: XState transitions are synchronous, in-memory operations. The `_process` method in `createActor.ts` computes the next state and updates the internal snapshot:

```typescript
private _process(event: EventFromLogic<TLogic>) {
  let nextState;
  try {
    nextState = this.logic.transition(this._snapshot, event, this._actorScope);
  } catch (err) {
    // error handling...
  }
  this.update(nextState, event);
}
```

There is no write-ahead log, no two-phase commit, and no transactional persistence. The `Mailbox` class processes events sequentially (which prevents concurrent mutation) but does not provide crash safety. If the process crashes between computing a new state and persisting it to disk, the transition is lost.

The persistence examples (MongoDB, file-based) write state *after* the transition completes, in a subscriber callback:

```typescript
actor.subscribe({
  next(snapshot) {
    // persist AFTER transition -- not crash-safe
    const persistedState = actor.getPersistedSnapshot();
    fs.writeFile(FILENAME, JSON.stringify(persistedState));
  }
});
```

**Notes**: Crash-safe transitions require infrastructure that XState does not provide: write-ahead logging, transactional state updates, or at minimum a pre-transition persistence hook. You would need to build this wrapper. The good news is that XState's `transition()` function is pure -- you can call it without side effects via the `transition()` export, compute the next state, persist it, and only *then* update the actor. But this "persist-before-apply" pattern is not built-in and requires careful engineering.

---

## Surprises

1. **Pure transition function**: XState v5 exports a standalone `transition(logic, snapshot, event)` function that returns `[nextSnapshot, actions]` without executing anything. This is powerful for implementing persist-before-apply patterns and for testing.

2. **JSON Schema for machines**: The `machine.schema.json` file provides a formal schema for machine definitions, enabling validation of machine configs loaded from external sources.

3. **Deep child rehydration**: The persistence system handles arbitrarily nested child actors (grandchild rehydration is tested). This means a complex orchestrator with spawned worker actors can be fully serialized/deserialized.

4. **No `@statelyai/agent` in monorepo**: The LLM agent integration package lives in a separate repository. The core XState library has zero LLM-specific features.

5. **`resolveState()` for state reconstruction**: You can create a valid machine snapshot from just a state value and optional context, without having a full persisted snapshot. Useful for "jump to state" scenarios.

---

## Open Questions for Trial

1. **Persist-before-apply pattern**: Can the pure `transition()` function be reliably used to compute next state, persist it to disk, and only then apply it to the running actor? What happens to invoked actors in this flow?

2. **DAG-as-parallel-states**: If the pipeline DAG is modeled as nested parallel/compound states, how complex does the machine config become for a 7-stage pipeline with 3 review gates? Is it maintainable?

3. **Context size in practice**: For a pipeline orchestrator tracking 7 stages with metadata, what is the actual serialized size of `getPersistedSnapshot()` output? Does it stay within the 20K token budget?

4. **Dynamic parallelism**: Can `spawnChild()` be used for dynamic fan-out (e.g., "run N tasks in parallel where N is determined at runtime") and if so, how does persistence handle dynamically spawned children?

5. **Error recovery from invoked promises**: When a promise actor (e.g., Claude Code CLI call) fails and the machine transitions to an error state, what is the cleanest pattern for retry with backoff?

---

## Source Index

| File | What was examined |
|------|-------------------|
| `packages/core/src/createActor.ts` | Actor lifecycle, `getPersistedSnapshot()`, `start()`, `_process()`, mailbox integration |
| `packages/core/src/StateMachine.ts` | `resolveState()`, `restoreSnapshot()`, `getPersistedSnapshot()`, `transition()`, `provide()` |
| `packages/core/src/State.ts` | `MachineSnapshot` types, `createMachineSnapshot()`, `getPersistedSnapshot()` serialization, `persistContext()` |
| `packages/core/src/guards.ts` | `evaluateGuard()`, `and()`, `or()`, `not()`, `stateIn()` |
| `packages/core/src/system.ts` | Actor system, scheduler, `_relay()`, `_register()` |
| `packages/core/src/spawn.ts` | `createSpawner()`, dynamic actor creation |
| `packages/core/src/setup.ts` | `setup()` API for typed machine creation |
| `packages/core/src/transition.ts` | Pure `transition()`, `initialTransition()`, `getMicrosteps()` |
| `packages/core/src/Mailbox.ts` | Event processing queue, sequential execution guarantee |
| `packages/core/src/actors/promise.ts` | `fromPromise()` actor logic, persistence |
| `packages/core/src/actors/callback.ts` | `fromCallback()` actor logic |
| `packages/core/src/types.ts` | `Snapshot`, `SnapshotStatus`, `ActorLogic` interface |
| `packages/core/src/inspection.ts` | Inspection event types for observability |
| `packages/core/src/machine.schema.json` | JSON Schema for machine config validation |
| `packages/core/src/index.ts` | Public API exports |
| `packages/core/test/rehydration.test.ts` | Persistence/rehydration test suite |
| `examples/workflow-parallel/main.ts` | Parallel state execution pattern |
| `examples/workflow-monitor-job/main.ts` | Job monitoring workflow with polling/retry |
| `examples/workflow-credit-check/main.ts` | Conditional routing with guards |
| `examples/mongodb-persisted-state/main.ts` | MongoDB persistence pattern |
| `examples/persisted-donut-maker/main.ts` | File-based persistence pattern |
| `README.md` | Library overview, parallel/history/nested examples |
| `AGENTS.md` | Monorepo development instructions |
