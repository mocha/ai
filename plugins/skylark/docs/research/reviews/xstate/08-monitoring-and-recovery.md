# XState -- Monitoring and Recovery Conformance Evaluation

**Library**: XState v5 (monorepo at `packages/core/`)
**Evaluation date**: 2026-04-15
**Evaluator context**: Assessing XState's capabilities for crash recovery, idempotent retries, predecessor session discovery, and loop detection in an AI-agent pipeline orchestrator.

---

## Summary

| Verdict | Count |
|---------|-------|
| MEETS | 0 |
| PARTIAL | 3 |
| DOES NOT MEET | 1 |

**Headline**: XState provides foundational primitives for recovery (snapshot persistence, error states, event-driven transitions) but has no built-in crash recovery automation, loop detection, or predecessor session discovery. These are runtime infrastructure concerns that sit above the state machine library layer. The library gives you the state model to *represent* recovery states; building the actual recovery automation is your responsibility.

---

## Per-Requirement Findings

### 7. Crash recovery automation

**Verdict**: PARTIAL

**Evidence**: XState provides the building blocks for crash recovery but does not automate it.

**What XState provides**:

1. **Error state handling**: The `SnapshotStatus` type includes `'error'` as a first-class status. When an invoked actor (promise, callback, etc.) fails, the machine can transition to an error-handling state:

```typescript
invoke: {
  src: 'workerTask',
  onError: {
    target: 'handleFailure',
    actions: assign({ lastError: ({ event }) => event.error })
  }
}
```

2. **Snapshot restoration**: `createActor(machine, { snapshot: persistedState }).start()` can resume from any persisted state, including error states. Tests in `rehydration.test.ts` confirm that error states are correctly restored and error observers are notified on rehydration.

3. **Stale state detection via status**: A restored snapshot with `status: 'active'` but no running process is detectable -- the orchestrator wrapper can check the snapshot status and the presence of a running actor.

4. **Child actor lifecycle**: The `Actor._stopProcedure()` cancels all scheduled events for the actor and clears its mailbox. However, there is a known gap noted in the source code:

```typescript
// From createActor.ts - comment on _stopProcedure()
// TODO: atm children don't belong entirely to the actor so
// in a way - it's not even super aware of them
// so we can't stop them from here but we really should!
// right now, they are being stopped within the machine's transition
// but that could throw and leave us with "orphaned" active actors
```

5. **Delayed retry pattern**: The `after` (delayed transitions) mechanism supports retry-with-backoff patterns:

```typescript
// Retry pattern from workflow-monitor-job example
WaitForCompletion: {
  after: { 5000: 'GetJobStatus' }  // poll every 5 seconds
}
```

**What XState does NOT provide**:

- No automatic detection of stale/orphaned states on startup
- No process-level health checking or heartbeat
- No automatic cleanup of half-complete transitions (the in-memory snapshot and persisted snapshot may diverge if a crash occurs between transition and persistence)
- No watchdog or supervisor pattern beyond the parent-child actor relationship

**Notes**: To build crash recovery, you would need a wrapper that: (a) reads persisted state on startup, (b) checks for states that indicate a crash (e.g., `in_progress` status with no running process), (c) transitions the machine to a recovery state, and (d) re-invokes the failed step. XState's state machine model is well-suited to *representing* recovery flows (error states, retry transitions, escalation paths), but detecting and initiating recovery is external infrastructure.

---

### 10. Idempotent recovery actions

**Verdict**: PARTIAL

**Evidence**: XState provides architectural support for idempotent patterns but does not enforce idempotency.

**What XState provides**:

1. **Pure transition function**: The standalone `transition(logic, snapshot, event)` function computes the next state without executing side effects. This enables a "compute-then-persist-then-apply" pattern that is naturally idempotent with respect to state:

```typescript
// From transition.ts
export function transition<T extends AnyActorLogic>(
  logic: T, snapshot: SnapshotFrom<T>, event: EventFromLogic<T>
): [nextSnapshot: SnapshotFrom<T>, actions: ExecutableActionsFrom<T>[]] {
  const executableActions = [] as ExecutableActionsFrom<T>[];
  const actorScope = createInertActorScope(logic);
  actorScope.actionExecutor = (action) => {
    executableActions.push(action as ExecutableActionsFrom<T>);
  };
  const nextSnapshot = logic.transition(snapshot, event, actorScope);
  return [nextSnapshot, executableActions];
}
```

2. **Deterministic state resolution**: Given the same snapshot and event, `transition()` always produces the same next snapshot. Replaying the same event on the same state is deterministic, which means re-applying a recovery action that has already been applied is a no-op if the state has already advanced.

3. **`snapshot.can(event)` for safe retries**: Before sending a recovery event, you can check if the machine will accept it:

```typescript
if (actor.getSnapshot().can({ type: 'RETRY' })) {
  actor.send({ type: 'RETRY' });
}
// If already recovered, RETRY may not be a valid event -> no-op
```

4. **Guard-based idempotency**: Guards can check if a recovery action has already been applied:

```typescript
on: {
  RETRY: {
    guard: ({ context }) => context.retryCount < context.maxRetries,
    target: 'retrying',
    actions: assign({ retryCount: ({ context }) => context.retryCount + 1 })
  }
}
```

**What XState does NOT provide**:

- No built-in idempotency keys or deduplication
- No transactional guarantee that a recovery action is applied exactly once
- The `Mailbox` processes events sequentially, preventing concurrent mutation, but if the same recovery event is sent twice, it will be processed twice (unless guarded)

**Notes**: Idempotent recovery is achievable by design but requires careful machine authoring. The key pattern is: use guards to check if recovery has already occurred before allowing the transition. The deterministic nature of state machine transitions means that the *state* side is naturally idempotent (same state + same event = same result), but *actions* (side effects) are not -- an action that sends an email will send it again on retry unless you guard against it.

---

### 12. Predecessor-session discovery

**Verdict**: DOES NOT MEET

**Evidence**: XState has no concept of sessions, session IDs (beyond actor `sessionId` which is an in-memory identifier), or cross-session discovery. The `sessionId` on an actor is generated fresh by `system._bookId()` on every `createActor()` call:

```typescript
// From createActor.ts
this.sessionId = this.system._bookId();
```

```typescript
// From system.ts
let idCounter = 0;
_bookId: () => `x:${idCounter++}`,
```

The `systemId` property is a user-assigned identifier for looking up actors within a running system via `system.get(systemId)`, but it does not persist across process restarts -- it is re-registered during `restoreSnapshot()` only for the current process.

**What XState provides**:

- **Persisted child actors**: When a machine is restored, its child actors are recreated with their original `src` and `systemId`, and their snapshots are restored. This means a new session inherits the *state* of predecessor children.
- **Context as predecessor state**: The restored context contains all data from the predecessor session, which can include session metadata if you explicitly store it.

**What XState does NOT provide**:

- No session registry or session history
- No mechanism to discover which sessions have run a particular machine
- No way for a worker to query "what sessions have worked on task X before me"
- No cross-actor-system communication (each `createActor()` call creates a new system)

**Notes**: Predecessor discovery is an infrastructure concern that sits entirely outside XState. You would need to build a session registry (e.g., a database table mapping session IDs to persisted snapshots) and a query interface. XState's contribution is that each session's state is fully serializable via `getPersistedSnapshot()`, so the *data* for predecessor queries exists -- but the *discovery* mechanism does not.

---

### 13. Loop detection

**Verdict**: PARTIAL

**Evidence**: XState has no built-in loop detection, but provides mechanisms that can be composed into loop detection.

**What XState provides**:

1. **Context-based loop counting**: You can track transition counts or revision rounds in context:

```typescript
DetermineCompletion: {
  always: [
    {
      guard: ({ context }) => context.revisionCount >= 3,
      target: 'escalate'  // break the loop
    },
    {
      guard: ({ context }) => context.status === 'needsRevision',
      target: 'revise',
      actions: assign({ revisionCount: ({ context }) => context.revisionCount + 1 })
    }
  ]
}
```

2. **`after` (delayed transitions) for timeout-based loop breaking**: If a polling or retry loop runs too long, a timeout can force escalation:

```typescript
monitoring: {
  invoke: { src: 'checkStatus', onDone: 'evaluate' },
  after: { 300000: 'timeout' }  // 5-minute deadline
}
```

3. **Inspection API for external monitoring**: An external monitor can observe all events and snapshots via the `inspect` callback:

```typescript
const actor = createActor(machine, {
  inspect: (event) => {
    if (event.type === '@xstate.snapshot') {
      // Track state transitions -- detect if the same state is visited too many times
    }
    if (event.type === '@xstate.event') {
      // Track events -- detect repeated patterns
    }
  }
});
```

4. **Eventless transition guards prevent infinite always-loops**: XState evaluates `always` transitions and stops when no guard passes or a transition leads to a state without `always` transitions. However, this is a compile-time constraint on the machine definition, not runtime loop detection.

**What XState does NOT provide**:

- No automatic detection of doom loops (same state visited N times)
- No automatic detection of infinite revision loops
- No built-in escalation mechanism for detected loops
- No transition history tracking (you would need to build this in context or via the inspection API)
- The source code contains `// TODO: throw on cycles (depth check should be enough)` in `guards.ts`, indicating that even guard cycle detection is incomplete

**Notes**: Loop detection requires either (a) encoding loop limits in the machine definition via context counters and guards, or (b) building an external monitor using the inspection API. Pattern (a) is more robust because it makes loop limits part of the machine's formal behavior. The inspection API approach is better for detecting unexpected loops that the machine author did not anticipate.

For the AI-agent pipeline, the recommended pattern is: every review/revision cycle increments a counter in context, and a guard breaks the loop when the counter exceeds a threshold, transitioning to an escalation state. This is straightforward to implement but must be done explicitly for every potential loop in the machine.

---

## Surprises

1. **Known orphaned actor gap**: The source code explicitly acknowledges that child actors may become orphaned if the parent's transition throws during stop: "we can't stop them from here but we really should!" This is a real concern for crash recovery.

2. **Sequential event processing**: The `Mailbox` class ensures events are processed one at a time via a linked-list queue. This prevents concurrent state mutations and simplifies reasoning about recovery, but it means the actor cannot process events while a long-running action executes.

3. **Error state propagation**: When a child actor errors, it sends `createErrorActorEvent(this.id, err)` to its parent via `system._relay()`. The parent machine can handle this with `onError` on the invoke definition. This error propagation is reliable and well-tested.

4. **Inspection API is system-level**: The `inspect` callback is set on the root actor and observes ALL actors in the system, including spawned children. This means a single inspection point can monitor the entire actor tree for loop detection or anomaly detection.

5. **No heartbeat mechanism**: There is no way for an actor to signal "I am still alive" or for the system to detect that an actor has become unresponsive. The scheduler handles delayed events but not health monitoring.

---

## Open Questions for Trial

1. **Orphaned actor recovery**: If the process crashes while a parallel state has invoked promise actors, and the machine is restored from a persisted snapshot, what happens to the in-flight promises? Are they re-invoked (potentially causing duplicate work), or do they need manual re-triggering?

2. **Inspection API overhead**: What is the performance cost of using the inspection API for loop detection? If the orchestrator processes thousands of events, does the inspection callback become a bottleneck?

3. **Error state to retry pattern**: What is the cleanest way to model "invoke worker -> worker fails -> wait with backoff -> retry worker -> max retries exceeded -> escalate"? Is this a compound state with nested retry logic, or a flat state machine with context-tracked retry counts?

4. **Concurrent recovery safety**: If two instances of the orchestrator start simultaneously and both read the same persisted state, can XState's deterministic transitions prevent conflicting state updates? Or does this require external locking?

5. **`transition()` for dry-run validation**: Can the pure `transition()` function be used to validate that a recovery event will produce the expected outcome before actually sending it to the running actor?

---

## Source Index

| File | What was examined |
|------|-------------------|
| `packages/core/src/createActor.ts` | `_process()` error handling, `_stopProcedure()` with orphaned actor TODO, `_error()` propagation, `_send()` stopped-actor handling |
| `packages/core/src/Mailbox.ts` | Sequential event processing, `clear()`, `flush()` -- no concurrent mutation |
| `packages/core/src/system.ts` | Scheduler (delayed events), `_relay()` for inter-actor communication, `_bookId()` session ID generation |
| `packages/core/src/transition.ts` | Pure `transition()` function for side-effect-free state computation |
| `packages/core/src/guards.ts` | `evaluateGuard()`, cycle detection TODO comment |
| `packages/core/src/inspection.ts` | `InspectionEvent` types: snapshot, event, actor, microstep, action |
| `packages/core/src/actors/promise.ts` | Promise actor error handling (`XSTATE_PROMISE_REJECT`), `AbortController` integration |
| `packages/core/src/State.ts` | `ErrorMachineSnapshot` type, `SnapshotStatus` |
| `packages/core/src/types.ts` | `Snapshot<TOutput>` discriminated union with error variant |
| `packages/core/test/rehydration.test.ts` | Error state rehydration, done-child handling, no re-notification on restore |
| `examples/workflow-monitor-job/main.ts` | Polling/retry pattern with `after` delays and `always` routing |
| `examples/workflow-credit-check/main.ts` | Timeout pattern with `after: { PT15M: 'Timeout' }` |
| `examples/mongodb-persisted-state/main.ts` | Persistence with async TaskQueue for ordered writes |
