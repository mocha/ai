# Layer 6 — Monitoring & Observability

## 1. Purpose

Monitoring is a cross-cutting concern that attaches to every worker session and pipeline run. It captures telemetry (token counts, costs, latencies, model parameters), stores it in a queryable backend, provides dashboards for cost tracking and pipeline health, and surfaces anomalies.

This layer does NOT do:

- **Fleet supervision.** Detecting stalled workers and killing them is the orchestrator's job (Layer 2).
- **Crash recovery.** Restarting failed tasks, retrying with different parameters, or escalating to the user is handled by context engineering (Layer 7) and the orchestrator.
- **Budget enforcement.** Token budget hooks live in Layer 7. This layer reports costs; it does not enforce limits.

Monitoring is always active. Unlike review gates and decomposition, it runs at every risk level for every task.

## 2. Components

| Component | Type | Role |
|-----------|------|------|
| OpenLLMetry (Traceloop) | Library (Python) | OTEL-native instrumentation for LLM API calls |
| Langfuse | Self-hosted service | Observability backend: trace storage, cost calculation, dashboards |
| Worker telemetry bridge | Script (~100 lines, must be built) | Bridges Claude Code CLI JSON output to Langfuse REST API |

### OpenLLMetry (Traceloop)

Auto-instruments the Anthropic Python SDK with `gen_ai.*` semantic conventions. On import, it monkey-patches `anthropic.messages.create` to emit OpenTelemetry spans containing:

- Input and output token counts
- Cache read and cache creation token counts
- Model name and parameters
- Duration
- Tool call names and counts
- Thinking block presence and token usage

Exports via standard OTLP protocol to any compatible backend (Langfuse, Jaeger, Honeycomb, etc.).

**Limitation:** OpenLLMetry instruments the Python SDK at import time. It cannot instrument Claude Code CLI processes (`claude --bare -p`), which are separate Node.js subprocesses making API calls through their own SDK. This is the instrumentation gap addressed in section 7.

### Langfuse

Self-hosted observability backend purpose-built for LLM applications. Ingests traces from OpenLLMetry via OTLP and from the worker telemetry bridge via REST API.

Key capabilities:

- **Cost calculation** with Anthropic pricing, including prompt cache tier discounts (cache read tokens at 10% of input price, cache creation tokens at 125%)
- **Trace hierarchy:** session > trace > observation (span or generation)
- **Web dashboard** with views for cost over time, latency distributions, token usage breakdowns, and per-model analytics
- **Evaluation and scoring** — attach quality scores to generations for later analysis
- **REST API** for programmatic access to all trace data
- **Prompt management** (not used by this pipeline, but available)

### Worker telemetry bridge

A lightweight script that bridges Claude Code CLI workers to Langfuse. Must be built as part of pipeline implementation.

Responsibilities:

1. Accept the parsed JSON output from Layer 5 worker execution (`--output-format json`)
2. Extract `total_cost_usd`, `duration_ms`, `num_turns`, `session_id`
3. Map pipeline concepts to Langfuse hierarchy (see section 5)
4. POST structured generation events to the Langfuse REST API
5. Write per-task telemetry to `.skylark/telemetry/TASK-NNN.json`

The bridge is invoked by the orchestrator after each worker completes. It is not a long-running process.

## 3. Inputs

### From Layer 5 (Worker) — parsed from CLI JSON output

```yaml
worker_telemetry:
  task_id: number
  session_id: string
  total_cost_usd: number
  duration_ms: number
  num_turns: number
  model: string
  pipeline_run_id: string         # correlates all tasks in one pipeline run
  stage: string                   # e.g. "develop", "spec_review"
```

| Field | Source | Description |
|-------|--------|-------------|
| `task_id` | Assigned by Layer 3 | Unique task identifier from the task DAG |
| `session_id` | Claude Code CLI output | The CLI session identifier |
| `total_cost_usd` | Claude Code CLI output | Aggregated cost for the entire CLI session |
| `duration_ms` | Claude Code CLI output | Wall-clock duration of the CLI session |
| `num_turns` | Claude Code CLI output | Number of conversation turns (tool use rounds) |
| `model` | Orchestrator config | Model used for this task (e.g. `claude-sonnet-4-20250514`) |
| `pipeline_run_id` | Orchestrator | UUID generated at pipeline start, shared across all tasks in one run |
| `stage` | Orchestrator | Pipeline stage name that dispatched this task |

### From OpenLLMetry (SDK workers only) — OTLP spans

If workers use the Anthropic Python SDK instead of the CLI (see section 7, option 2), OpenLLMetry emits standard OTLP spans:

```yaml
llm_span:
  name: "anthropic.messages.create"
  attributes:
    gen_ai.system: "anthropic"
    gen_ai.request.model: string
    gen_ai.usage.input_tokens: number
    gen_ai.usage.output_tokens: number
    gen_ai.usage.cache_read.input_tokens: number
    gen_ai.usage.cache_creation.input_tokens: number
    gen_ai.conversation.id: string   # maps to task_id
```

These spans arrive at Langfuse via OTLP export with no bridge needed. They provide per-API-call granularity, unlike the CLI bridge which only provides per-task aggregates.

## 4. Telemetry pipeline

### Path A: CLI workers (current architecture)

```
Worker (claude --bare -p --output-format json)
  │
  ▼
Layer 5 parses JSON result
  │
  ▼
Worker telemetry bridge
  ├──► POST to Langfuse REST API (generation event)
  └──► Write .skylark/telemetry/TASK-NNN.json
```

Data granularity: **per-task aggregates only.** One generation event per task execution. No visibility into individual API calls within a CLI session.

### Path B: SDK workers (future option)

```
Worker (Python SDK with OpenLLMetry instrumented)
  │
  ▼
OpenLLMetry auto-instruments every anthropic.messages.create call
  │
  ▼
OTLP exporter sends spans to Langfuse
  │
  ▼
Langfuse receives per-call spans with full token breakdowns
```

Data granularity: **per-API-call spans.** Each `messages.create` call is a separate span with input tokens, output tokens, cache tokens, duration, model, and tool calls. Spans are nested under a trace representing the task.

### Path C: Hybrid (both paths active)

If some pipeline stages use CLI workers and others use SDK workers, both paths run simultaneously. Langfuse receives generation events from the bridge and OTLP spans from OpenLLMetry. The `pipeline_run_id` and `task_id` correlate data from both sources within the same session.

## 5. Langfuse data model

### Hierarchy mapping

| Pipeline concept | Langfuse concept | Identifier |
|---|---|---|
| Pipeline run (all tasks for one spec) | Session | `pipeline_run_id` |
| Pipeline stage (e.g. "develop", "spec_review") | Trace | `{pipeline_run_id}-{stage}` |
| Individual task execution | Generation | `TASK-{task_id}` |
| Expert generation sub-agent | Child span | `TASK-{task_id}-expert` |
| Panel review sub-agent | Child span | `TASK-{task_id}-review-{n}` |

### Querying pipeline costs

**Total cost for a pipeline run:**

```
GET /api/public/sessions/{pipeline_run_id}
→ response.total_cost
```

**Per-stage breakdown:**

```
GET /api/public/traces?session_id={pipeline_run_id}
→ each trace has .total_cost, filter by trace.name to get per-stage costs
```

**Per-task breakdown:**

```
GET /api/public/observations?trace_id={trace_id}&type=GENERATION
→ each generation has .calculated_total_cost, .usage (tokens), .model
```

**Cost over time (dashboard):** Use the Langfuse web dashboard's built-in cost analytics view. Filter by session to scope to a specific pipeline run, or view aggregate cost across all runs over a time range.

## 6. Outputs

### Per-task telemetry file

Written to `.skylark/telemetry/TASK-NNN.json` by the worker telemetry bridge after each task completes.

```yaml
task_telemetry:
  task_id: number
  cost_usd: number
  duration_ms: number
  num_turns: number
  model: string
  tokens:
    input: number
    output: number
    cache_read: number
    cache_creation: number
  pipeline_run_id: string
  stage: string
  timestamp: string              # ISO 8601
```

**Note on token breakdown:** When using the CLI bridge (Path A), `tokens.input` and `tokens.output` are not available from the CLI JSON output — only `total_cost_usd` is provided. The token fields will be `null` until SDK workers (Path B) or CLI cost log parsing (section 7, option 3) are implemented.

### Dashboard views (Langfuse web UI)

| View | What it shows |
|------|---------------|
| Sessions list | All pipeline runs with total cost, duration, trace count |
| Session detail | All stages and tasks within one pipeline run, with cost and token breakdown |
| Cost over time | Aggregate spend by day/week, filterable by model and stage |
| Latency distribution | P50/P95/P99 duration per stage |
| Token usage | Input vs output vs cache token ratios across runs |
| Model comparison | Cost and latency by model (Sonnet vs Opus) |

### Anomaly data

Anomalies are surfaced in the per-task telemetry file and optionally via Langfuse scores. See section 9 for anomaly detection rules.

```yaml
pipeline_summary:
  pipeline_run_id: string
  total_cost_usd: number
  total_duration_ms: number
  per_stage_cost: { stage_name: cost_usd }
  per_task_cost: { task_id: cost_usd }
  anomalies: [{ type: string, description: string, task_id: number }]
```

The `pipeline_summary` is assembled by querying the Langfuse API after a pipeline run completes. It is not a persistent file — it is computed on demand by the orchestrator's finish stage.

## 7. The instrumentation gap

### The problem

Claude Code CLI workers (`claude --bare -p`) are Node.js subprocesses that make Anthropic API calls internally. OpenLLMetry instruments the Python SDK by monkey-patching at import time. These are different runtimes in different processes — OpenLLMetry cannot see the CLI's API calls.

This means: with CLI workers, we get per-task cost aggregates but not per-API-call telemetry.

### Bridging options

**Option 1: Worker telemetry bridge (recommended)**

Parse the `--output-format json` output from the CLI. It includes `total_cost_usd`, `duration_ms`, and `num_turns`. Post these as generation events to the Langfuse REST API.

- Effort: ~100 lines of Python or TypeScript
- Granularity: per-task aggregates (cost, duration, turns)
- Missing: per-API-call token breakdowns, individual tool call durations, cache hit rates
- Reliability: high — the CLI JSON output format is a stable public interface

**Option 2: Claude Agent SDK workers**

Replace CLI-based worker execution with the Anthropic Python SDK (or the Claude Agent SDK). Workers become Python processes that call `anthropic.messages.create` directly. OpenLLMetry instruments these calls automatically.

- Effort: significant — requires rewriting Layer 5 worker execution
- Granularity: per-API-call spans with full token breakdowns
- Missing: nothing — full observability
- Trade-off: loses Claude Code's built-in tool use (file editing, bash, etc.) unless reimplemented

**Option 3: CLI cost log parsing**

Claude Code writes per-call cost data to `~/.claude/usage-data/`. Parse these files after a worker session completes to extract per-call token counts and costs.

- Effort: moderate — need to reverse-engineer the log format
- Granularity: per-API-call data (after the fact, not real-time)
- Missing: real-time streaming; data arrives only after the session ends
- Risk: this is an internal, undocumented data format that may change between Claude Code releases

### Recommendation

Start with **Option 1** (worker telemetry bridge). It provides the cost and duration data needed for pipeline health monitoring with minimal implementation effort. Move to **Option 2** only if per-call granularity becomes necessary for debugging or optimization. Avoid **Option 3** unless the other options prove insufficient — depending on internal data formats creates maintenance burden.

## 8. Self-hosting

### Infrastructure requirements

Langfuse self-hosts with 6 containers:

| Container | Role | Resource notes |
|-----------|------|----------------|
| `langfuse-web` | Web UI and API server | Low CPU, ~256MB RAM |
| `langfuse-worker` | Background job processing (cost calculation, aggregation) | Low CPU, ~256MB RAM |
| `postgres` | Primary data store (traces, scores, projects) | Disk-bound; ~1GB for moderate usage |
| `clickhouse` | Analytics engine (fast aggregation queries) | Memory-bound; 512MB minimum |
| `redis` | Job queue and caching | ~64MB RAM |
| `minio` | Object storage (large trace payloads) | Disk-bound; minimal for this use case |

Total footprint for a single-developer pipeline: **~1.5GB RAM, ~5GB disk.** Runs comfortably on a laptop alongside development tools.

### Docker Compose setup

```yaml
# docker-compose.langfuse.yml (reference — Langfuse provides an official compose file)
services:
  langfuse-web:
    image: langfuse/langfuse:latest
    ports:
      - "3100:3000"
    environment:
      DATABASE_URL: postgresql://langfuse:langfuse@postgres:5432/langfuse
      CLICKHOUSE_URL: http://clickhouse:8123
      REDIS_CONNECTION_STRING: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY_ID: minioadmin
      S3_SECRET_ACCESS_KEY: minioadmin
      S3_BUCKET_NAME: langfuse
      NEXTAUTH_SECRET: <generate-a-random-secret>
      NEXTAUTH_URL: http://localhost:3100
      SALT: <generate-a-random-salt>

  langfuse-worker:
    image: langfuse/langfuse:latest
    command: ["node", "packages/worker/dist/index.js"]
    environment:
      # Same env vars as langfuse-web

  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: langfuse
      POSTGRES_PASSWORD: langfuse
      POSTGRES_DB: langfuse
    volumes:
      - langfuse-pg:/var/lib/postgresql/data

  clickhouse:
    image: clickhouse/clickhouse-server:latest
    volumes:
      - langfuse-ch:/var/lib/clickhouse

  redis:
    image: redis:7

  minio:
    image: minio/minio
    command: server /data
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - langfuse-minio:/data

volumes:
  langfuse-pg:
  langfuse-ch:
  langfuse-minio:
```

### Operational burden

For a single developer, the operational burden is low:

- **Startup:** `docker compose -f docker-compose.langfuse.yml up -d`
- **Shutdown:** `docker compose -f docker-compose.langfuse.yml down`
- **Upgrades:** Pull new images and restart. Langfuse handles schema migrations automatically.
- **Backup:** Back up the Postgres volume. ClickHouse data can be rebuilt from Postgres.
- **Disk growth:** Modest. A pipeline run generating 20 tasks produces ~20 trace records. Months of daily use will stay under 1GB.

The main cost is remembering to start the stack before running pipelines. If Langfuse is down when the bridge tries to POST, telemetry is lost for that run. A future improvement would be to buffer failed POSTs to disk and retry.

## 9. Anomaly detection

### Signals

| Signal | Threshold | Anomaly type | Description |
|--------|-----------|--------------|-------------|
| Task cost | > $2.00 per task | `cost_spike` | A single task exceeding $2 suggests runaway generation or an excessively broad prompt |
| Pipeline cost | > $15.00 per run | `pipeline_cost_spike` | Full pipeline exceeding $15 warrants investigation |
| Task duration | > 15 minutes | `slow_task` | CLI sessions rarely need more than 10 minutes; 15+ suggests a stall or infinite loop |
| Num turns | > 25 turns | `excessive_turns` | High turn count indicates the worker is stuck in a retry loop or receiving ambiguous instructions |
| Token burn rate | > 200k output tokens per task | `token_burn` | Abnormally high output suggests the model is generating excessive code or repeating itself |
| Cache hit ratio | < 10% on Opus tasks | `poor_caching` | Low cache utilization on expensive models means context engineering (Layer 7) is not working |
| Stage cost ratio | Any stage > 60% of pipeline cost | `stage_imbalance` | One stage dominating cost suggests misconfigured model selection or unnecessary review rounds |

### Detection implementation

Anomaly detection runs in the worker telemetry bridge after each task completes. It compares the task's metrics against the thresholds above and appends any anomalies to the telemetry file.

```python
def detect_anomalies(telemetry: dict) -> list[dict]:
    anomalies = []
    if telemetry["cost_usd"] > COST_SPIKE_THRESHOLD:
        anomalies.append({
            "type": "cost_spike",
            "description": f"Task cost ${telemetry['cost_usd']:.2f} exceeds threshold ${COST_SPIKE_THRESHOLD}",
            "task_id": telemetry["task_id"]
        })
    if telemetry["duration_ms"] > SLOW_TASK_THRESHOLD_MS:
        anomalies.append({
            "type": "slow_task",
            "description": f"Task duration {telemetry['duration_ms']/1000:.0f}s exceeds threshold",
            "task_id": telemetry["task_id"]
        })
    if telemetry["num_turns"] > EXCESSIVE_TURNS_THRESHOLD:
        anomalies.append({
            "type": "excessive_turns",
            "description": f"Task used {telemetry['num_turns']} turns (threshold: {EXCESSIVE_TURNS_THRESHOLD})",
            "task_id": telemetry["task_id"]
        })
    return anomalies
```

Anomalies are also written to Langfuse as scores attached to the generation, making them visible in the dashboard and queryable via the API.

### Response to anomalies

This layer detects and records anomalies. It does not act on them. The orchestrator (Layer 2) is responsible for consuming anomaly data and deciding whether to:

- Log a warning and continue
- Pause the pipeline and notify the user
- Skip remaining tasks in a stage

The boundary is deliberate: monitoring observes, the orchestrator decides.

## 10. Configuration

### Langfuse connection

```yaml
langfuse:
  host: "http://localhost:3100"    # Self-hosted Langfuse URL
  public_key: "pk-lf-..."         # Project public key (from Langfuse UI)
  secret_key: "sk-lf-..."         # Project secret key (from Langfuse UI)
```

Keys are stored in environment variables, not in config files:

```bash
export LANGFUSE_HOST="http://localhost:3100"
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
```

### OTLP endpoint (for OpenLLMetry)

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3100/api/public/otel"
```

OpenLLMetry reads this environment variable automatically. No additional configuration is needed in application code beyond:

```python
from traceloop.sdk import Traceloop
Traceloop.init()
```

### Anomaly thresholds

```yaml
anomaly_thresholds:
  cost_spike_usd: 2.00             # Per-task cost
  pipeline_cost_spike_usd: 15.00   # Per-pipeline-run cost
  slow_task_ms: 900000             # 15 minutes
  excessive_turns: 25
  token_burn_output: 200000        # Output tokens per task
  poor_cache_ratio: 0.10           # Minimum cache hit ratio (Opus only)
  stage_imbalance_ratio: 0.60      # Max fraction of pipeline cost in one stage
```

These live in `.skylark/config.json` under a `monitoring` key, or in environment variables prefixed with `SKYLARK_MON_`.

### Alerting

No external alerting system is configured by default. For a single developer, anomalies surface in two places:

1. **Terminal output.** The bridge prints warnings to stderr when anomalies are detected during a pipeline run.
2. **Langfuse dashboard.** Anomaly scores appear on generations and can be filtered in the UI.

Future: a webhook or Slack integration could push alerts for anomalies detected in unattended pipeline runs.

## 11. Future: supervision daemon

### The gap

Today, if a CLI worker stalls (hangs indefinitely, enters an infinite tool-use loop, or hits a rate limit and backs off forever), nothing detects it until the user notices. The orchestrator waits for the worker to complete and has no timeout mechanism. Layer 7 budget hooks can detect token exhaustion within a session but cannot detect a process that has stopped making progress.

### What a supervisor would do

A lightweight supervision daemon would:

1. **Poll active workers.** Query the orchestrator for in-flight task IDs and their start times.
2. **Detect stalls.** Flag any worker exceeding the `slow_task_ms` threshold with no new output.
3. **Escalate.** Notify the orchestrator via a `WORKER_STALLED` event, which the orchestrator handles per its existing escalation rules (pause pipeline, notify user, optionally kill the process).
4. **Detect cost runaway in real-time.** If using SDK workers (Path B), monitor the running cost of active traces and fire a `COST_ALERT` event when thresholds are crossed mid-session rather than only at completion.

### Implementation sketch

```
Supervisor daemon (runs alongside orchestrator)
  │
  ├── every 30s: poll orchestrator for active tasks + start times
  │     └── if any task exceeds slow_task_ms:
  │           emit WORKER_STALLED event to orchestrator
  │
  ├── every 60s: query Langfuse for running traces (SDK workers only)
  │     └── if any trace cost exceeds threshold:
  │           emit COST_ALERT event to orchestrator
  │
  └── on pipeline_complete: assemble pipeline_summary, detect stage-level anomalies
```

### Why this is deferred

The supervisor adds a long-running process to what is otherwise a tool-invocation pipeline. For a single developer running pipelines interactively, stalls are noticed quickly. The supervisor becomes necessary when running unattended pipelines (overnight batch processing, CI-triggered runs) or when multiple pipelines run concurrently.

Build it when unattended execution becomes a requirement. Until then, the per-task anomaly detection in section 9 covers the common cases.
