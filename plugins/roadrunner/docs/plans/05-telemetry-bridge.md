# Domain 5: Telemetry Bridge -- Implementation Plan

Bridges Claude Code CLI worker output to structured telemetry storage
and (optionally) Langfuse. Implements Layer 6 of the Skylark pipeline
as specified in `docs/spec/06-monitoring.md`.

---

## Scope boundary

This domain covers **Path A only** (CLI worker telemetry bridge). It
does NOT cover OpenLLMetry/OTLP instrumentation (Path B), the
supervision daemon (spec section 11), or real-time cost alerting.
Those are future work gated on the move to SDK workers or unattended
pipeline execution.

The domain produces value in two phases:

1. **Local-only** (tasks 1-4): Per-task and per-pipeline telemetry
   written to `.skylark/telemetry/`. No external dependencies. Works
   immediately after Domain 3 (Worker Dispatch) is functional.

2. **Langfuse integration** (tasks 5-7): Posts telemetry to Langfuse
   REST API. Requires a running Langfuse instance but degrades
   gracefully to local-only when Langfuse is unavailable.

---

## Prerequisites

| Dependency | What it provides | Hard/soft |
|---|---|---|
| Domain 1 (Orchestrator) | `pipeline_run_id` for correlation, `stage` context | Hard |
| Domain 3 (Worker Dispatch) | `.skylark/results/TASK-NNN.json` files with CLI output fields | Hard |
| Langfuse (self-hosted) | REST API endpoint for trace ingestion | Soft -- local JSON works without it |

---

## Tasks

### Task 1: Telemetry record schema and writer

**Description**

Define the canonical per-task telemetry record schema as a TypeScript
interface and implement a writer that reads a worker result file,
extracts telemetry fields, and writes a structured record to
`.skylark/telemetry/TASK-NNN.json`.

The writer is a pure function: result JSON in, telemetry JSON out.
No network calls, no side effects beyond the file write.

**Files to create**

- `src/telemetry/types.ts` -- `TaskTelemetry`, `PipelineSummary`,
  `AnomalyRecord`, `TelemetryConfig` interfaces
- `src/telemetry/writer.ts` -- `writeTaskTelemetry(resultPath, meta)` function
- `src/telemetry/writer.test.ts` -- unit tests

**Schema** (from spec section 6, with additions):

```typescript
interface TaskTelemetry {
  task_id: number;
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
  model: string;
  tokens: {
    input: number | null;    // null for CLI workers (Path A)
    output: number | null;
    cache_read: number | null;
    cache_creation: number | null;
  };
  pipeline_run_id: string;
  stage: string;
  session_id: string;
  status: string;            // worker exit status (DONE, BLOCKED, etc.)
  round: number;             // review round (1-indexed)
  anomalies: AnomalyRecord[];
  timestamp: string;         // ISO 8601
}
```

The `meta` argument supplies `pipeline_run_id`, `stage`, and `model`
-- fields the orchestrator knows but the result file does not contain.

**Acceptance criteria**

- Given a `.skylark/results/TASK-042.json` fixture matching the
  Layer 5 output schema, `writeTaskTelemetry` produces
  `.skylark/telemetry/TASK-042.json` with all fields populated.
- Token fields are `null` (CLI Path A has no per-call token data).
- Anomalies array is empty when no thresholds are exceeded.
- Writer creates the `.skylark/telemetry/` directory if it does not exist.
- Writer is idempotent -- calling it twice for the same task overwrites
  cleanly.
- Unit tests cover: normal result, error result (`is_error: true`),
  missing fields with sensible defaults, directory creation.

**Dependencies:** None (uses fixture data).

**Estimated scope:** Small. ~120 lines of implementation + ~100 lines of tests.

---

### Task 2: Anomaly detection

**Description**

Implement threshold-based anomaly detection that runs against each
task's telemetry record. Returns an array of `AnomalyRecord` objects
appended to the telemetry file.

Thresholds are configurable via `TelemetryConfig` with defaults from
spec section 9. Detection runs synchronously as part of the telemetry
writer (task 1 calls into this module).

**Files to create**

- `src/telemetry/anomalies.ts` -- `detectAnomalies(telemetry, config)` function
- `src/telemetry/anomalies.test.ts` -- unit tests

**Anomaly types** (from spec section 9):

| Signal | Default threshold | Type key |
|---|---|---|
| Per-task cost | > $2.00 | `cost_spike` |
| Per-task duration | > 900,000 ms (15 min) | `slow_task` |
| Per-task turns | > 25 | `excessive_turns` |

Pipeline-level anomalies (`pipeline_cost_spike`, `stage_imbalance`)
are detected in task 3 (pipeline rollup), not here.

**Acceptance criteria**

- `detectAnomalies` returns an empty array when all metrics are
  below thresholds.
- Returns the correct anomaly type and a human-readable description
  when a threshold is exceeded.
- Multiple anomalies can fire simultaneously (e.g., a task that is
  both expensive and slow).
- Thresholds are configurable -- passing a custom `TelemetryConfig`
  overrides defaults.
- Unit tests cover: no anomalies, single anomaly, multiple anomalies,
  custom thresholds, edge cases (exactly at threshold = no anomaly).

**Dependencies:** Task 1 (types).

**Estimated scope:** Small. ~60 lines of implementation + ~80 lines of tests.

---

### Task 3: Pipeline cost rollup

**Description**

After all tasks in a pipeline run complete, aggregate per-task
telemetry into a `PipelineSummary`. The rollup reads all
`.skylark/telemetry/TASK-*.json` files for the current
`pipeline_run_id`, computes totals and per-stage breakdowns, runs
pipeline-level anomaly detection, and writes the summary to
`.skylark/telemetry/summary-{pipeline_run_id}.json`.

This function is called by the orchestrator's `finish` stage.

**Files to create**

- `src/telemetry/rollup.ts` -- `buildPipelineSummary(pipelineRunId, config)` function
- `src/telemetry/rollup.test.ts` -- unit tests

**Schema:**

```typescript
interface PipelineSummary {
  pipeline_run_id: string;
  total_cost_usd: number;
  total_duration_ms: number;
  task_count: number;
  per_stage_cost: Record<string, number>;
  per_stage_duration: Record<string, number>;
  per_task: Array<{
    task_id: number;
    cost_usd: number;
    duration_ms: number;
    stage: string;
    model: string;
  }>;
  anomalies: AnomalyRecord[];
  timestamp: string;
}
```

**Pipeline-level anomaly checks:**

| Signal | Default threshold | Type key |
|---|---|---|
| Pipeline total cost | > $15.00 | `pipeline_cost_spike` |
| Stage cost fraction | Any stage > 60% of total | `stage_imbalance` |

**Acceptance criteria**

- Given 5 task telemetry fixtures across 2 stages,
  `buildPipelineSummary` produces correct totals and per-stage
  breakdowns.
- Pipeline-level anomalies are detected (e.g., total cost > $15).
- Stage imbalance anomaly fires when one stage exceeds 60% of total
  cost.
- Filters telemetry files by `pipeline_run_id` -- ignores files from
  other runs.
- Returns a valid summary even with zero tasks (edge case: pipeline
  aborted before any worker ran).
- Unit tests cover: multi-stage rollup, single-task pipeline,
  anomaly detection, filtering by run ID.

**Dependencies:** Tasks 1 and 2.

**Estimated scope:** Medium. ~150 lines of implementation + ~120 lines of tests.

---

### Task 4: Orchestrator integration hook

**Description**

Wire the telemetry writer into the orchestrator's event flow. The
integration point is the `WORKER_COMPLETE` event handler: after storing
the worker result, the orchestrator calls `writeTaskTelemetry` with
the result path and pipeline metadata.

The pipeline rollup is called from the `finish` stage action
(`dispatchFinish`), which assembles and prints the cost summary.

This task also adds the anomaly warning output: when per-task
anomalies are detected, emit a warning to stderr so the user sees
it during the pipeline run (not just in the JSON file).

**Files to create/modify**

- `src/telemetry/index.ts` -- barrel export for the telemetry module
- Modify orchestrator action `storeWorkerResult` to call
  `writeTaskTelemetry` (exact file depends on Domain 1 implementation)
- Modify orchestrator action `dispatchFinish` / `emitPipelineSummary`
  to call `buildPipelineSummary` and print the cost table

**Acceptance criteria**

- After a worker completes, a telemetry file appears at
  `.skylark/telemetry/TASK-NNN.json` without manual intervention.
- Anomaly warnings print to stderr with `[TELEMETRY]` prefix when
  thresholds are exceeded.
- The `finish` stage prints a cost summary table to stdout:
  ```
  Pipeline cost summary (run abc-123):
    Total: $3.42 across 5 tasks
    develop:    $2.80 (4 tasks)
    spec_review: $0.62 (1 task)
    Anomalies: none
  ```
- If `writeTaskTelemetry` throws (e.g., disk full), the orchestrator
  logs the error and continues -- telemetry failure never blocks the
  pipeline.
- Integration is testable via a mock orchestrator that emits
  `WORKER_COMPLETE` events.

**Dependencies:** Tasks 1-3, Domain 1 (Orchestrator actions exist).

**Estimated scope:** Small. ~80 lines of integration code + ~60 lines of tests.

---

### Task 5: Langfuse REST client

**Description**

Implement a lightweight HTTP client for the Langfuse public ingestion
API (`POST /api/public/ingestion`). The client handles authentication
(Basic auth with public/secret key), request batching, and graceful
failure when Langfuse is unavailable.

This is a standalone module with no dependency on the rest of the
telemetry pipeline -- it just knows how to POST trace events to
Langfuse.

**Files to create**

- `src/telemetry/langfuse-client.ts` -- `LangfuseClient` class
- `src/telemetry/langfuse-client.test.ts` -- unit tests with mocked HTTP

**Client API:**

```typescript
class LangfuseClient {
  constructor(config: { host: string; publicKey: string; secretKey: string });
  async ingestGeneration(event: LangfuseGenerationEvent): Promise<boolean>;
  async ingestTrace(event: LangfuseTraceEvent): Promise<boolean>;
  async ingestScore(event: LangfuseScoreEvent): Promise<boolean>;
  isConfigured(): boolean;  // true if host + keys are set
}
```

Uses `fetch()` (Node 18+ built-in). No additional HTTP dependencies.
Returns `true` on success, `false` on failure (never throws -- caller
decides whether to retry or ignore).

**Authentication:** HTTP Basic auth with `publicKey:secretKey`
base64-encoded, per Langfuse API docs.

**Acceptance criteria**

- `ingestGeneration` sends a correctly shaped POST request to
  `/api/public/ingestion` with the batch format Langfuse expects.
- Returns `false` and logs a warning when the server is unreachable
  (connection refused, timeout).
- Returns `false` and logs a warning on 4xx/5xx responses.
- `isConfigured()` returns `false` when env vars are missing,
  allowing callers to skip Langfuse calls entirely.
- Unit tests use a mock HTTP server or `fetch` mock to verify request
  shape, auth header, and error handling.

**Dependencies:** None (standalone module).

**Estimated scope:** Medium. ~130 lines of implementation + ~100 lines of tests.

---

### Task 6: Langfuse trace mapping

**Description**

Map Skylark pipeline concepts to the Langfuse data hierarchy as
defined in spec section 5:

| Pipeline concept | Langfuse concept | Identifier |
|---|---|---|
| Pipeline run | Session | `pipeline_run_id` |
| Pipeline stage | Trace | `{pipeline_run_id}-{stage}` |
| Task execution | Generation | `TASK-{task_id}` |

Implement a mapper that converts `TaskTelemetry` records into
Langfuse API event payloads. The mapper also converts anomalies into
Langfuse score objects attached to the generation.

**Files to create**

- `src/telemetry/langfuse-mapper.ts` -- `mapToLangfuseEvents(telemetry)` function
- `src/telemetry/langfuse-mapper.test.ts` -- unit tests

**Mapper output:**

```typescript
interface LangfuseGenerationEvent {
  id: string;           // TASK-{task_id}
  traceId: string;      // {pipeline_run_id}-{stage}
  name: string;         // task title or "TASK-{task_id}"
  model: string;
  startTime: string;    // ISO 8601
  endTime: string;      // startTime + duration_ms
  metadata: {
    pipeline_run_id: string;
    stage: string;
    round: number;
    session_id: string;
    status: string;
    num_turns: number;
  };
  usage: {
    input: number | undefined;
    output: number | undefined;
    total: number | undefined;
  };
  calculatedTotalCost: number;
}

interface LangfuseTraceEvent {
  id: string;           // {pipeline_run_id}-{stage}
  sessionId: string;    // pipeline_run_id
  name: string;         // stage name
  metadata: { risk: string; model: string };
}

interface LangfuseScoreEvent {
  traceId: string;
  observationId: string;  // TASK-{task_id}
  name: string;           // anomaly type
  value: number;          // 0 = anomaly detected
  comment: string;        // anomaly description
}
```

**Acceptance criteria**

- Given a `TaskTelemetry` record, `mapToLangfuseEvents` returns a
  trace event, a generation event, and zero or more score events.
- Trace IDs are deterministic and consistent: the same `pipeline_run_id`
  + `stage` always produces the same trace ID.
- Cost is passed as `calculatedTotalCost` (Langfuse uses this for
  cost dashboards when token counts are unavailable).
- Anomalies map to scores with `value: 0` (Langfuse convention for
  binary failure scores).
- Unit tests cover: normal mapping, mapping with anomalies, null token
  fields, edge cases (zero cost, zero duration).

**Dependencies:** Task 1 (types), task 5 (Langfuse event interfaces).

**Estimated scope:** Small. ~100 lines of implementation + ~80 lines of tests.

---

### Task 7: Langfuse bridge integration

**Description**

Wire the Langfuse client and mapper into the telemetry writer. After
writing the local telemetry file (task 1), the writer checks if
Langfuse is configured. If so, it maps the telemetry record to
Langfuse events and posts them via the client.

Similarly, wire the pipeline rollup (task 3) to post the summary as
trace-level metadata when the pipeline finishes.

All Langfuse calls are fire-and-forget: failures are logged but never
block the pipeline.

**Files to modify**

- `src/telemetry/writer.ts` -- add optional Langfuse posting after
  local file write
- `src/telemetry/rollup.ts` -- add optional Langfuse session metadata
  update after rollup
- `src/telemetry/index.ts` -- export `createTelemetryBridge(config)`
  factory that wires everything together

**Factory function:**

```typescript
function createTelemetryBridge(config: TelemetryConfig): TelemetryBridge {
  // Reads LANGFUSE_HOST, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
  // from env. If any are missing, Langfuse posting is disabled.
  // Returns an object with recordTask() and buildSummary() methods.
}
```

**Acceptance criteria**

- When `LANGFUSE_HOST` is set and reachable, telemetry events appear
  in Langfuse after each task completes.
- When `LANGFUSE_HOST` is unset, the bridge writes local files only
  and logs no errors (clean degradation).
- When Langfuse is set but unreachable (e.g., Docker not running),
  the bridge logs a single warning per failed POST and continues.
- The bridge does not retry failed POSTs (no queue, no buffer --
  simplicity over completeness for v1).
- Integration test: mock Langfuse endpoint, run bridge, verify
  correct events arrive.

**Dependencies:** Tasks 1, 3, 5, 6.

**Estimated scope:** Medium. ~100 lines of integration code + ~80 lines of tests.

---

### Task 8: Langfuse Docker Compose setup

**Description**

Provide a Docker Compose file for self-hosting Langfuse alongside the
development environment. This is a convenience -- not a runtime
dependency. The pipeline works without it.

**Files to create**

- `docker/docker-compose.langfuse.yml` -- full Langfuse stack
  (web, worker, Postgres, ClickHouse, Redis, MinIO)
- `docker/langfuse.env.example` -- example environment file with
  placeholder secrets

**Compose structure** (from spec section 8):

Six services: `langfuse-web` (port 3100), `langfuse-worker`, `postgres`,
`clickhouse`, `redis`, `minio`. Three named volumes for persistence.

The env example includes instructions for generating `NEXTAUTH_SECRET`
and `SALT` values.

**Acceptance criteria**

- `docker compose -f docker/docker-compose.langfuse.yml up -d` starts
  all six containers and Langfuse web UI is accessible at
  `http://localhost:3100`.
- `docker compose -f docker/docker-compose.langfuse.yml down` stops
  cleanly.
- Volumes persist data across restarts.
- The env example documents every required variable with a comment
  explaining its purpose.
- Instructions in the env example explain how to generate secrets:
  `openssl rand -base64 32`.

**Dependencies:** None (standalone infrastructure).

**Estimated scope:** Small. ~80 lines of YAML + ~30 lines of env example.

---

## Dependency graph

```
Task 1 (schema + writer)
  │
  ├──► Task 2 (anomaly detection)
  │       │
  │       ├──► Task 3 (pipeline rollup)
  │       │       │
  │       │       └──► Task 4 (orchestrator integration)
  │       │               │
  │       │               └──► Task 7 (Langfuse bridge integration)
  │       │                       ▲
  │       └─────────────────────┐ │
  │                             │ │
  └──► Task 5 (Langfuse client) ─┤
          │                       │
          └──► Task 6 (mapper) ───┘

Task 8 (Docker Compose) -- independent, can be done at any time
```

**Critical path:** 1 -> 2 -> 3 -> 4 (local telemetry, no Langfuse).
This is the minimum viable domain.

**Parallel work:** Task 5 can start alongside tasks 2-3. Task 8 can
start at any time.

---

## Implementation order

| Phase | Tasks | Outcome |
|---|---|---|
| Phase 1: Local telemetry | 1, 2, 3, 4 | Per-task and per-pipeline cost tracking via local JSON files. Anomaly warnings in terminal. Cost summary at pipeline finish. |
| Phase 2: Langfuse bridge | 5, 6, 7, 8 | Telemetry posted to Langfuse for dashboards, cost analytics, and historical queries. Graceful degradation when Langfuse is down. |

Phase 1 is the priority. It delivers cost visibility with zero external
dependencies. Phase 2 adds the observability platform but is not
required for the pipeline to function.

---

## Configuration summary

All configuration lives in `.skylark/config.json` under a `monitoring`
key, with environment variable overrides:

```jsonc
{
  "monitoring": {
    "anomaly_thresholds": {
      "cost_spike_usd": 2.00,
      "pipeline_cost_spike_usd": 15.00,
      "slow_task_ms": 900000,
      "excessive_turns": 25,
      "stage_imbalance_ratio": 0.60
    }
  }
}
```

Langfuse connection is env-only (secrets must not be in config files):

```
LANGFUSE_HOST=http://localhost:3100
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

---

## What this plan does NOT cover

- **OpenLLMetry / OTLP instrumentation** (Path B) -- requires SDK
  workers, which are a Domain 3 future upgrade.
- **Supervision daemon** (spec section 11) -- deferred until
  unattended pipeline execution is a requirement.
- **Real-time cost alerting** -- requires either SDK workers or a
  polling loop against Langfuse. Not needed for interactive use.
- **Retry queue for failed Langfuse POSTs** -- v1 is fire-and-forget.
  If Langfuse is down, telemetry for that run is local-only.
- **Token-level breakdown for CLI workers** -- the CLI JSON output
  provides `total_cost_usd` but not per-call token counts. Token
  fields are `null` until SDK workers are implemented.
