# XState -- Context Engineering Conformance Evaluation

**Library**: XState v5 (monorepo at `packages/core/`)
**Evaluation date**: 2026-04-15
**Evaluator context**: Assessing XState's state serialization capabilities for an AI-agent pipeline where sessions are ephemeral and canonical state must survive session boundaries.

---

## Summary

| Verdict | Count |
|---------|-------|
| MEETS | 1 |
| PARTIAL | 3 |
| DOES NOT MEET | 0 |

**Headline**: XState's persistence system (`getPersistedSnapshot()`/`restoreSnapshot()`) provides the serialization machinery for disk-canonical state and cross-session resume, but automatic persistence and structured predecessor queries require integration code. The library gives you the right building blocks without imposing a storage or query layer.

---

## Per-Requirement Findings

### 2. Disk-canonical state

**Verdict**: PARTIAL

**Evidence**: XState provides the serialization primitives to make disk the canonical source, but it does not enforce this pattern. The relevant APIs:

**Persist to disk**: `actor.getPersistedSnapshot()` produces a JSON-serializable object containing:
- `value` -- the current state value (e.g., `"specReview"` or `{ parallel: { branchA: "done", branchB: "active" } }`)
- `context` -- the full typed context object
- `status` -- one of `'active' | 'done' | 'error' | 'stopped'`
- `children` -- recursively serialized child actors with their snapshots, src references, and system IDs
- `historyValue` -- serialized history state references (StateNode IDs rather than live objects)

The serialization is thorough. Actor references within context are replaced with `{ xstate$$type: 1, id: "actorId" }` placeholders during `persistContext()`, and are revived during `restoreSnapshot()`:

```typescript
// From State.ts - persistContext()
if ('sessionId' in value && 'send' in value && 'ref' in value) {
  copy[key] = { xstate$$type: $$ACTOR_TYPE, id: (value as AnyActorRef).id };
}
```

**Restore from disk**: `createActor(machine, { snapshot: parsedJSON }).start()` rehydrates the full machine state including:
- Reconstructing state node graph from value
- Recreating child actors from persisted snapshots
- Reviving history values from serialized StateNode ID references
- Reviving actor references within context

The file-based example demonstrates the disk-canonical pattern:
```typescript
// From examples/persisted-donut-maker/main.ts
let restoredState = JSON.parse(await fs.readFile(FILENAME, 'utf8'));
const actor = createActor(donutMachine, { state: restoredState });
actor.subscribe({
  next(snapshot) {
    const persistedState = actor.getPersistedSnapshot();
    fs.writeFile(FILENAME, JSON.stringify(persistedState));
  }
});
```

**Notes**: XState treats conversation history as completely irrelevant -- it has no concept of conversation at all. This is architecturally correct for the requirement. However, the "disk-canonical" pattern is a *usage pattern*, not a built-in mode. XState's in-memory snapshot is always the live state; disk is a secondary copy maintained by your code. To truly make disk canonical, you would need to either:
1. Always read from disk before processing events (slower but safer), or
2. Trust the in-memory state and persist after every transition (the pattern shown in examples)

Neither is enforced by the library.

---

### 4. Predecessor query

**Verdict**: PARTIAL

**Evidence**: XState's persisted snapshot contains the machine's full context, which can include decisions, findings, and metadata from previous sessions. The context is a typed object that you design:

```typescript
context: {
  triageResult: { decision: 'approved', reason: 'meets criteria', timestamp: '...' },
  specReviewNotes: [{ finding: '...', reviewer: 'session-xyz' }],
  currentPhase: 'develop',
  // ... anything you want to query later
}
```

When a new session starts with `createActor(machine, { snapshot: persistedState })`, the full context is available immediately via `actor.getSnapshot().context`. There is no need to replay conversation -- the context *is* the predecessor's decisions.

The `snapshot.getMeta()` method provides access to metadata defined on state nodes:

```typescript
const meta = snapshot.getMeta();
// Returns: { 'machine.specReview': { lastReviewer: '...', decision: '...' } }
```

**Notes**: XState gives you the persistence and restoration -- but it does not provide a *query* mechanism beyond reading the context object. "What did the previous session decide about X?" is answered by reading `context.x` from the restored snapshot. This works perfectly for structured data but requires that you design your context schema to capture queryable decisions. There is no natural-language query capability, no search over past states, and no decision log beyond what you explicitly store in context. For a pipeline orchestrator this is probably sufficient -- each phase's output is stored as a context field.

---

### 9. Phase-boundary splits

**Verdict**: MEETS

**Evidence**: XState's architecture naturally supports phase-boundary splits. Each phase is a state (or compound state) in the machine. When a phase completes:

1. The machine transitions to the next phase state
2. Entry actions on the new state can read the prior phase's output from context
3. The new phase's invoked actor receives the relevant context as input

```typescript
// Pattern: phase boundary with artifact handoff
states: {
  research: {
    invoke: {
      src: 'researchWorker',
      input: ({ context }) => ({ topic: context.topic }),
      onDone: {
        target: 'planning',
        actions: assign({ researchArtifact: ({ event }) => event.output })
      }
    }
  },
  planning: {
    invoke: {
      src: 'planningWorker',
      // New phase starts fresh -- receives ONLY the prior phase's artifact
      input: ({ context }) => ({ researchArtifact: context.researchArtifact }),
      onDone: {
        target: 'implementation',
        actions: assign({ plan: ({ event }) => event.output })
      }
    }
  }
}
```

The persistence/restore cycle means each phase *can* run in a completely separate process session:

1. Session 1: Run research phase, persist state at phase boundary
2. Process dies or session ends
3. Session 2: Restore from persisted state, machine is in `planning` state, research artifact is in context

The `input` parameter on `invoke` provides the mechanism for scoping what each phase receives -- you pass only the relevant artifact, not the entire conversation history.

**Notes**: XState does not enforce session boundaries at phase transitions -- that is your orchestration decision. But the architecture supports it cleanly. The key insight is that XState's context is the "prior phase's artifact" that each new phase starts with. You control what goes into context via `assign()`, so you control the phase boundary contract.

---

### 10. Auto-persisted state

**Verdict**: PARTIAL

**Evidence**: XState does not auto-persist. It provides a subscription mechanism that fires on every state change, which is the hook point for persistence:

```typescript
// From createActor.ts - observers are notified on every state change
private update(snapshot: SnapshotFrom<TLogic>, event: EventObject): void {
  this._snapshot = snapshot;
  // ... execute deferred effects ...
  for (const observer of this.observers) {
    observer.next?.(snapshot);
  }
}
```

The inspection API provides even more granular hooks:

```typescript
const actor = createActor(machine, {
  inspect: (event) => {
    if (event.type === '@xstate.snapshot') {
      // Fires on every snapshot change -- persist here
      persistToDisk(event.snapshot);
    }
    if (event.type === '@xstate.event') {
      // Fires on every event -- log here
    }
    if (event.type === '@xstate.action') {
      // Fires on every action execution
    }
  }
});
```

Inspection events include: `@xstate.snapshot`, `@xstate.event`, `@xstate.actor`, `@xstate.microstep`, `@xstate.action`.

The MongoDB example demonstrates auto-persistence via subscription:

```typescript
actor.subscribe({
  next(snapshot) {
    taskQueue.addTask(async () => {
      const persistedState = actor.getPersistedSnapshot();
      await donutCollection.updateOne(filter, { $set: { persistedState } }, { upsert: true });
    });
  }
});
```

**Notes**: "Auto-persisted" requires a thin wrapper (~10 lines) that subscribes to state changes and writes to disk. This is not worker discipline -- it is infrastructure code that runs once at actor creation and persists on every transition automatically. However, it is not built into the library itself. The inspection API is richer and provides more lifecycle hooks than plain subscription. A production wrapper would likely use the `inspect` callback for fine-grained control over what gets persisted and when.

The gap from "fully auto-persisted" is:
- No built-in "persist on transition" mode (must subscribe)
- No built-in "persist before transition" mode (requires the pure `transition()` function + custom orchestration)
- No write-ahead log or journaling

---

## Surprises

1. **History value serialization is well-handled**: The `serializeHistoryValue()` and `reviveHistoryValue()` functions correctly round-trip history state references through JSON, converting live `StateNode` objects to `{ id: string }` references and back. This means complex machines with history states can be fully persisted.

2. **Child actor persistence is recursive**: `getPersistedSnapshot()` recursively persists all child actor states. A machine that spawns worker machines that spawn sub-workers will have its entire tree serialized. On restore, child actors are recreated with the correct `src`, `systemId`, and snapshot.

3. **Inline actors cannot be persisted**: From `State.ts`: `throw new Error('An inline child actor cannot be persisted.')` -- only actors defined via `setup({ actors: { ... } })` or `machine.provide({ actors: { ... } })` with string `src` keys can be persisted. This is important for orchestrator design -- all actors must be registered by name.

4. **Context actor references survive serialization**: If your context contains a reference to a spawned actor (`{ myWorker: spawnedActorRef }`), the persistence system replaces it with a placeholder and revives it on restore. This means context can safely hold actor references without special handling.

---

## Open Questions for Trial

1. **Persistence granularity**: Is persisting the full snapshot on every transition too expensive for a pipeline orchestrator? Should persistence happen only at phase boundaries (state entry actions) rather than on every microstep?

2. **Context size growth over pipeline lifetime**: As each phase adds its output to context, does the serialized snapshot grow unboundedly? What is the practical strategy for context pruning -- should completed phase artifacts be replaced with hashes/references?

3. **Concurrent write safety**: If two events arrive in rapid succession, the subscriber-based persistence pattern could produce out-of-order writes. The MongoDB example uses a `TaskQueue` to serialize writes -- is this sufficient, or does a more robust pattern exist?

4. **Inspection API for structured decision logging**: Can the `@xstate.action` inspection events be used to build an automatic decision log (which guards fired, which transitions were taken) without modifying the machine definition?

5. **Cross-machine predecessor queries**: If the pipeline orchestrator spawns per-task child machines, can a new session's child machine query the persisted state of a previous session's child machine? Or does the parent context need to mediate all cross-session queries?

---

## Source Index

| File | What was examined |
|------|-------------------|
| `packages/core/src/State.ts` | `getPersistedSnapshot()`, `persistContext()`, `serializeHistoryValue()`, `createMachineSnapshot()`, MachineSnapshot types |
| `packages/core/src/StateMachine.ts` | `restoreSnapshot()`, `resolveState()`, child actor rehydration, history value revival |
| `packages/core/src/createActor.ts` | `_initState()`, `update()`, observer notification, `getPersistedSnapshot()` public API |
| `packages/core/src/inspection.ts` | Inspection event types: snapshot, event, actor, microstep, action |
| `packages/core/src/types.ts` | `Snapshot<TOutput>`, `SnapshotStatus`, `ActorLogic` interface with `getPersistedSnapshot`/`restoreSnapshot` |
| `packages/core/src/actors/promise.ts` | Promise actor persistence (`getPersistedSnapshot: (snapshot) => snapshot`) |
| `packages/core/src/actors/callback.ts` | Callback actor persistence |
| `packages/core/test/rehydration.test.ts` | Full rehydration test suite: tags, actions, children, deep nesting, done/error states |
| `examples/mongodb-persisted-state/main.ts` | MongoDB persistence pattern with TaskQueue |
| `examples/persisted-donut-maker/main.ts` | File-based persistence pattern |
| `examples/workflow-monitor-job/main.ts` | Job monitoring with polling -- demonstrates phase transitions |
| `examples/workflow-credit-check/main.ts` | Guard-based routing at phase boundaries |
