# Langfuse -- Monitoring and Recovery Conformance Evaluation

**Date**: 2026-04-15
**Source**: Langfuse monorepo at `/Users/deuley/code/tools/langfuse/` (v3, MIT-licensed)
**Evaluator context**: Assessing Langfuse as the observability backend for a composable AI-agent development pipeline (Skylark/Mocha) with OpenLLMetry instrumentation and Claude Code CLI workers.

---

## 1. Summary

| Verdict | Count |
|---------|-------|
| MEETS | 2 |
| PARTIAL | 5 |
| DOES NOT MEET | 6 |

**Headline**: Langfuse is a strong observability and cost-tracking backend for LLM workloads, with native OTLP ingestion, granular Anthropic prompt-caching cost support, and a flexible score/evaluation system that can serve as a review-verdict data layer. However, it is an observability platform, not a supervisor or orchestrator -- fleet supervision, crash recovery, escalation routing, loop detection, and idempotent recovery are entirely out of scope and must be built as separate pipeline components that consume Langfuse data.

---

## 2. Per-Requirement Findings

### Req 1: Structured telemetry (OTEL-compatible)

**Verdict**: MEETS

**Evidence**:
- Langfuse exposes a native OTLP/HTTP endpoint at `/api/public/otel/v1/traces` that accepts both `application/json` and `application/x-protobuf` content types, including gzip encoding. See `web/src/pages/api/public/otel/v1/traces/index.ts`.
- The `OtelIngestionProcessor` class (`packages/shared/src/server/otel/OtelIngestionProcessor.ts`) converts OTEL `ResourceSpan` payloads into Langfuse's internal event model -- extracting traceId, spanId, parent relationships, session IDs, user IDs, usage details, cost details, model names, and metadata.
- OTEL span attributes are mapped to Langfuse observation types via a priority-ordered `ObservationTypeMapperRegistry` (`packages/shared/src/server/otel/ObservationTypeMapper.ts`) supporting Langfuse-native, OpenInference, GenAI semantic conventions, Vercel AI SDK, Genkit, LiveKit, and model-based fallback.
- Session IDs and user IDs are extracted from OTEL attributes (`session.id` / `user.id` or `langfuse.session.id` / `langfuse.user.id`).
- Custom Langfuse OTEL attributes are defined in `packages/shared/src/server/otel/attributes.ts` for trace-level metadata, observation-level metadata, usage/cost details, and experiment attribution.

**Notes**:
- OpenLLMetry/Traceloop is referenced in tests (`packages/shared/src/server/otel/OtelIngestionProcessor.ts` references Traceloop in test fixtures). The OTLP ingestion path is the primary way non-SDK data enters Langfuse, making it the natural integration point for our OpenLLMetry-instrumented workers.
- Authentication uses Langfuse project API keys passed via HTTP basic auth, not OTEL-native auth headers.

---

### Req 2: Classified health states

**Verdict**: DOES NOT MEET

**Evidence**: Langfuse has no concept of worker health states. Its data model tracks traces, observations (spans/generations), and scores -- all passive telemetry records. There is no health classification engine, no state machine for workers, and no concept of "working", "stalled", "zombie", or "idle" states.

**Notes**: Langfuse provides the raw data (observation timestamps, latency, error levels, session activity) from which health states could be derived externally. The `ObservationLevel` enum (`DEBUG`, `DEFAULT`, `WARNING`, `ERROR`) and `statusMessage` fields on observations could encode health signals if the emitting workers use them, but classification logic must live outside Langfuse.

---

### Req 3: Continuous fleet supervision

**Verdict**: DOES NOT MEET

**Evidence**: Langfuse has no supervisor process, no fleet management, and no automatic recovery triggers. Its worker process (`worker/`) handles background jobs (ingestion processing, eval execution, batch exports, cost calculation) -- these are Langfuse's own internal workers, not a supervisory system for external agents.

**Notes**: Langfuse's automation system (Trigger + Action + Automation models in the Prisma schema) could theoretically fire webhooks on trace events, but this is currently scoped to `prompt` events only (see `TriggerEventSource` enum in `packages/shared/src/domain/automations.ts`: only `Prompt` is defined). Even if extended, this would be event-driven notification, not continuous supervision.

---

### Req 4: Supervisor-of-supervisors

**Verdict**: DOES NOT MEET

**Evidence**: No meta-supervision capability exists in Langfuse. This is entirely outside its architectural scope as an observability backend.

**Notes**: Langfuse itself is supervised by standard container orchestration (Docker Compose health checks on all services). The self-hosted stack's health monitoring is at the infrastructure level, not at a logical supervisor level.

---

### Req 5: Severity-routed escalation

**Verdict**: DOES NOT MEET

**Evidence**: Langfuse has no escalation system. The closest features are:
- `CloudSpendAlert` model (threshold-based spend alerts, cloud-only -- `packages/shared/prisma/schema.prisma` line 1614)
- `NotificationPreference` model with `NotificationChannel` enum (currently only `EMAIL`) and `NotificationType` enum (currently only `COMMENT_MENTION`)
- Automation/webhook system supporting `WEBHOOK`, `SLACK`, and `GITHUB_DISPATCH` action types

None of these constitute severity-based escalation routing.

**Notes**: The automation system's webhook and Slack integrations could be building blocks for a custom escalation system. A custom pipeline component could query Langfuse for stuck traces (via API), classify severity, and route notifications through Langfuse's webhook/Slack actions -- but Langfuse would be the data source, not the escalation engine.

---

### Req 6: Full audit log

**Verdict**: PARTIAL

**Evidence**:
- Langfuse records every LLM generation and tool call as observations within traces, stored in ClickHouse with full attribution: `project_id`, `trace_id`, `parent_observation_id`, `type` (GENERATION, TOOL, AGENT, SPAN, etc.), input/output payloads, model, usage details, cost details, metadata, timestamps, and `session_id`/`user_id` on the parent trace.
- The `AuditLog` model in Postgres tracks administrative actions (user/API-key changes, resource CRUD) with before/after state diffs.
- All data is queryable via the public REST API (`/api/public/traces`, `/api/public/observations`, `/api/public/scores`, `/api/public/sessions`) and the web dashboard.
- The ClickHouse `observations` table stores tool definitions and tool call data (`toolDefinitions`, `toolCalls`, `toolCallNames` fields on the `ObservationSchema`).

**Notes**:
- "Worker attribution" in our pipeline sense (which Claude Code CLI process performed the action) would need to be mapped via the session ID or user ID fields, or encoded in trace metadata. Langfuse does not natively understand "worker" as a concept.
- Task-level attribution depends on how we structure traces: if each pipeline task is a trace, attribution is native. Cross-trace queries (e.g., "all tool calls for worker X across tasks") require API pagination or ClickHouse queries.
- This is partial rather than full because Langfuse logs LLM-related events, not arbitrary pipeline events like session lifecycle transitions, status changes, or decision log entries. Those would need to be emitted as custom spans/events.

---

### Req 7: Crash recovery automation

**Verdict**: DOES NOT MEET

**Evidence**: Langfuse has no crash recovery, stale-state detection, or orphan cleanup for external agents. Its own internal systems handle data consistency (ReplacingMergeTree in ClickHouse, BullMQ job queues with Redis for worker tasks), but these are for Langfuse's own operations.

**Notes**: Langfuse's trace/session data could feed a crash recovery system: querying for traces with long-running observations that never received an end_time, sessions with no recent activity, or observations stuck at ERROR level. The data is there; the recovery logic is not.

---

### Req 8: Human-visible dashboard

**Verdict**: PARTIAL

**Evidence**:
- Langfuse provides a full web dashboard (Next.js app in `web/`) with:
  - **Trace explorer**: hierarchical trace/span visualization with timing, input/output, metadata, scores
  - **Session view**: group traces by session ID, view full session timeline
  - **Cost analytics**: `ModelCostTable` component showing cost by model, `ModelUsageChart` for time-series cost/token trends, `TotalMetric` for aggregate cost display
  - **Score analytics**: charts and tables for evaluation scores over time
  - **Latency charts**: `LatencyChart` and `LatencyTables` components
  - **Custom dashboards**: `Dashboard` and `DashboardWidget` Prisma models supporting LINE_TIME_SERIES, AREA_TIME_SERIES, BAR_TIME_SERIES, HORIZONTAL_BAR, VERTICAL_BAR, PIE, NUMBER, HISTOGRAM, and PIVOT_TABLE chart types across TRACES, OBSERVATIONS, SCORES_NUMERIC, and SCORES_CATEGORICAL views
  - **Filtered views**: `TableViewPreset` model for saved filter/column configurations
  - **User-level views**: traces filterable by `user_id`

**Notes**:
- The dashboard excels at LLM observability (traces, generations, cost, latency, scores) but does not natively render "fleet state", "stuck agents", or "escalation queues" -- those are pipeline-specific concepts.
- Custom dashboards could approximate some of these views by filtering on metadata fields or score names, but the dashboard is optimized for LLM-call-centric analysis, not agent-fleet operational views.
- Verdict is PARTIAL because the dashboard is excellent for its domain but does not cover all requirements (fleet state, escalation view, stuck-agent highlighting).

---

### Req 9: Cost telemetry

**Verdict**: MEETS

**Evidence**:
- **Per-observation cost tracking**: Every observation in ClickHouse has `provided_usage_details` (Map), `usage_details` (Map), `provided_cost_details` (Map), `cost_details` (Map), and `total_cost` fields.
- **Anthropic Claude cost support**: The `default-model-prices.json` file contains pricing for all Claude models from claude-1.x through claude-opus-4-6 and claude-sonnet-4-6, including **prompt caching cost keys**: `cache_creation_input_tokens`, `input_cache_creation`, `input_cache_creation_5m`, `input_cache_creation_1h`, `cache_read_input_tokens`, `input_cache_read`. This is comprehensive Anthropic prompt caching support.
- **Pricing tiers**: The `PricingTier` model and `matchPricingTier` algorithm support conditional pricing (e.g., different rates for long-context usage), with AND-logic conditions evaluated against usage detail patterns.
- **Token tracking**: Usage details are stored as flexible key-value maps, allowing arbitrary usage keys (input tokens, output tokens, cache reads, reasoning tokens, etc.).
- **Dashboard visibility**: `ModelCostTable` aggregates cost by model, `ModelUsageChart` shows time-series cost trends, both with filtering by environment, user, and model.
- **Session-level aggregation**: Traces carry `session_id`, enabling session-level cost rollup via the API or ClickHouse queries.

**Notes**:
- "Cost per pipeline run" maps naturally to cost per trace (if pipeline run = trace) or cost per session (if pipeline run = session).
- "Cache hit rate" is not a first-class dashboard metric, but the usage details maps store `input_cache_read` and `input_cache_creation` separately, enabling cache-hit-rate calculation via custom queries or dashboard widgets.
- Anomaly detection for cost spikes is not built into Langfuse. `CloudSpendAlert` thresholds exist but are cloud-only and org-level, not per-trace or per-session.
- The `OtelIngestionProcessor.extractUsageDetails` method (lines ~2300-2450 of the processor) has sophisticated logic for normalizing usage details across different OTEL attribute schemas, including Anthropic-specific `cache_creation_input_tokens`, OpenAI cached tokens, and Gemini cached content tokens.

---

### Req 10: Idempotent recovery actions

**Verdict**: DOES NOT MEET

**Evidence**: Langfuse does not perform recovery actions. This is entirely outside its scope as an observability backend.

**Notes**: Langfuse's own ingestion pipeline does use idempotent patterns (ClickHouse's ReplacingMergeTree deduplicates on event_ts, S3 event storage with UUID-keyed files), but these are internal data integrity mechanisms, not recovery actions for external agents.

---

### Req 11: Severity-routed notifications

**Verdict**: PARTIAL

**Evidence**:
- The `NotificationPreference` model supports per-user, per-project preferences with `NotificationChannel` (currently only `EMAIL`) and `NotificationType` (currently only `COMMENT_MENTION`).
- The `Automation` system supports `WEBHOOK`, `SLACK`, and `GITHUB_DISPATCH` action types, executed via `AutomationExecution` records with status tracking (PENDING, COMPLETED, ERROR, CANCELLED).
- `SlackIntegration` model stores workspace-level Slack connections per project.
- `CloudSpendAlert` provides threshold-based spend notifications (cloud-only).

**Notes**:
- The notification system exists but is minimal: only comment mentions via email. The automation system is more capable (webhook/Slack/GitHub) but currently only triggers on `prompt` events, not on trace-level signals that would be needed for agent health alerts.
- Severity routing (different channels for different severity levels) would need to be implemented in a pipeline component that consumes Langfuse data and dispatches through the appropriate channel.
- Verdict is PARTIAL because the infrastructure (Slack, webhook, email) exists but severity-based routing logic and trace-event triggers do not.

---

### Req 12: Predecessor-session discovery

**Verdict**: PARTIAL

**Evidence**:
- Langfuse's `TraceSession` model groups traces by `session_id`. The public API endpoint `GET /api/public/sessions/{sessionId}` returns session details and all associated traces.
- Traces within a session are queryable by session ID, with full trace data (including input/output, metadata, scores).
- The `session_id` is a string field on traces, set by the instrumenting client. Sessions can be listed and filtered.
- ClickHouse queries in `packages/shared/src/server/repositories/traces.ts` support filtering traces by `session_id` and aggregating session-level metrics.

**Notes**:
- A restarted worker could query predecessor sessions if it knows the session ID (or a naming convention that encodes task/worker identity). Langfuse does not provide "find the previous session for this worker" semantics natively -- that requires the pipeline to define session ID conventions.
- Cross-session discovery (e.g., "find all sessions for pipeline run X") would require encoding pipeline-run identity in session IDs, trace metadata, or tags, then querying via the API.
- Verdict is PARTIAL because the data access patterns exist but the discovery logic (knowing which predecessor to look for) must be implemented externally.

---

### Req 13: Loop detection

**Verdict**: DOES NOT MEET

**Evidence**: Langfuse has no loop detection, pattern recognition, or anomaly detection for trace sequences. There is no concept of "doom loops", "infinite revision loops", or repeated execution patterns.

**Notes**: The data to detect loops exists in Langfuse: repeated trace names within a session, observations with identical inputs across multiple traces, cost growth patterns. A custom component could query Langfuse's API to detect these patterns, but Langfuse itself does not perform this analysis. The evaluation/scoring system (see Data Model section) could store loop-detection results as scores attached to traces or sessions.

---

## 3. Data Model Deep-Dive

### Core Entities

| Langfuse Entity | Schema Location | Storage | Description |
|----------------|----------------|---------|-------------|
| **Trace** | `traces` table (ClickHouse), `TraceDomain` (Zod) | ClickHouse (primary), Postgres (legacy) | Top-level unit of work. Has `id`, `name`, `session_id`, `user_id`, `tags`, `metadata`, `input`, `output`, `release`, `version`, `environment` |
| **Observation** | `observations` table (ClickHouse), `ObservationSchema` (Zod) | ClickHouse (primary), Postgres (legacy) | A span within a trace. Types: SPAN, GENERATION, EVENT, AGENT, TOOL, CHAIN, RETRIEVER, EVALUATOR, EMBEDDING, GUARDRAIL. Has `trace_id`, `parent_observation_id` (tree structure), `start_time`, `end_time`, `model`, `usage_details`, `cost_details`, `level`, `metadata` |
| **Score** | `scores` table (ClickHouse), `ScoreSchema` (Zod) | ClickHouse (primary), Postgres (legacy) | An evaluation attached to a trace, observation, session, or dataset run. Sources: API, EVAL, ANNOTATION. Data types: NUMERIC, CATEGORICAL, BOOLEAN, TEXT, CORRECTION |
| **TraceSession** | `trace_sessions` table (Postgres) | Postgres | Groups traces by `session_id`. Minimal schema: `id`, `project_id`, `bookmarked`, `public`, `environment` |
| **EvalTemplate** | `eval_templates` table (Postgres) | Postgres | LLM-as-judge evaluation template: `prompt`, `model`, `provider`, `vars`, `outputDefinition` |
| **JobConfiguration** | `job_configurations` table (Postgres) | Postgres | Configures automated evaluations: `evalTemplateId`, `scoreName`, `filter`, `targetObject`, `variableMapping`, `sampling`, `delay` |
| **Prompt** | `prompts` table (Postgres) | Postgres | Versioned prompt management: `name`, `version`, `prompt`, `labels`, `tags`, `config` |
| **Model** | `models` table (Postgres) | Postgres | Model pricing definitions: `modelName`, `matchPattern`, `inputPrice`, `outputPrice`, plus `PricingTier` and `Price` for conditional pricing |

### Pipeline Concept Mapping

| Pipeline Concept | Langfuse Mapping | Notes |
|-----------------|------------------|-------|
| **Pipeline run** | `TraceSession` (session) | A session groups all traces for one pipeline execution. Session ID set by client. |
| **Stage** | Top-level `Trace` within a session | Each pipeline stage (e.g., research, draft, review) becomes a separate trace in the session. |
| **Task** | `Trace` or `Observation` (AGENT/SPAN) | If a task is a discrete unit within a stage, it maps to either a trace (if independent) or a top-level observation within a stage trace. |
| **Worker session** | `Trace` with metadata encoding worker identity | The `user_id` field or custom metadata can identify which Claude Code CLI process generated the trace. |
| **LLM call** | `Observation` of type GENERATION | Each Claude API call becomes a generation observation with full token/cost tracking. |
| **Tool call** | `Observation` of type TOOL | Tool invocations are first-class observation types with tool definitions and call data. |
| **Review verdict** | `Score` (CATEGORICAL or BOOLEAN) | Scores can be attached to traces or observations with source=EVAL (automated) or source=API (programmatic). The `ScoreConfig` model defines valid categories and ranges. |

### Key Data Model Strengths

1. **Flexible usage/cost maps**: `usage_details` and `cost_details` are `Map(String, Number)` in ClickHouse, allowing arbitrary keys (input, output, cache_read, cache_creation_5m, reasoning tokens, etc.) without schema changes.
2. **Hierarchical observations**: `parent_observation_id` creates a tree within each trace, naturally representing agent-tool-call hierarchies.
3. **Multi-target scores**: Scores can reference a `traceId`, `observationId`, `sessionId`, or `datasetRunId`, enabling review verdicts at any level of the pipeline hierarchy.
4. **Environment tagging**: The `environment` field on traces, observations, and sessions supports multi-environment deployment (dev, staging, production).

---

## 4. Self-Hosting Assessment

### Infrastructure Requirements

Per `docker-compose.yml`, the self-hosted stack requires five containers:

| Service | Image | Resource Notes |
|---------|-------|---------------|
| `langfuse-web` | `langfuse/langfuse:3` | Next.js app, serves UI + REST API |
| `langfuse-worker` | `langfuse/langfuse-worker:3` | BullMQ consumers for ingestion, evals, exports |
| `postgres` | `postgres:17` | Metadata, auth, config, eval templates, prompts |
| `clickhouse` | `clickhouse/clickhouse-server` | Primary data store for traces, observations, scores |
| `redis` | `redis:7` | Queue backbone (BullMQ), caching |
| `minio` | `cgr.dev/chainguard/minio` | S3-compatible blob storage for event payloads, media, batch exports |

**Total**: 6 containers (5 services + MinIO).

### Single-Developer Feasibility

- **Disk**: ClickHouse is the primary growth concern. For a single-developer pipeline, volumes should remain manageable (< 10GB for months of moderate use). ReplacingMergeTree with monthly partitioning is efficient.
- **Memory**: The full stack likely needs 4-6GB RAM minimum (ClickHouse alone recommends 2GB+). Viable on a 16GB development machine.
- **Operational burden**: Moderate. The `docker compose up` deployment is genuinely simple. However:
  - ClickHouse and Postgres both need persistent volumes and backup strategies.
  - Redis is configured with `noeviction` policy, so memory growth must be monitored.
  - No built-in log rotation or monitoring for the Langfuse services themselves.
  - Schema migrations are handled by the application (Prisma for Postgres, custom SQL for ClickHouse).
- **Upgrade path**: Langfuse uses tagged Docker images (`langfuse/langfuse:3`), so upgrades are straightforward docker pull + restart, with automatic migrations.

### Verdict

Reasonable for a single-developer setup. The operational burden is comparable to running any multi-container stateful application. The main risk is ClickHouse's resource appetite on constrained machines.

---

## 5. Integration Surface

### How Data Gets Into Langfuse

There are three ingestion paths:

1. **OTLP/HTTP endpoint** (`POST /api/public/otel/v1/traces`): Accepts standard OTLP trace payloads (JSON or Protobuf). This is the path for OpenLLMetry-instrumented workers. The `OtelIngestionProcessor` handles conversion.

2. **Langfuse REST API** (`POST /api/public/ingestion`): Native Langfuse event format for trace-create, observation-create, score-create, etc. Used by official Langfuse SDKs.

3. **Langfuse SDKs** (Python, JS/TS): High-level wrappers around the REST API with automatic batching, context management, and framework integrations.

### Claude Code Instrumentation Path

Claude Code CLI does not emit OTLP or Langfuse telemetry natively. The instrumentation path would be:

1. **Wrapper approach**: A pipeline orchestrator wraps Claude Code CLI invocations, capturing start/end times, inputs/outputs, and emitting traces via the Langfuse SDK or REST API.

2. **OpenLLMetry approach**: If Claude Code uses the Anthropic Python SDK internally, OpenLLMetry's Anthropic instrumentor can auto-instrument the SDK calls. The OTEL exporter would send spans to Langfuse's OTLP endpoint. However, Claude Code is a standalone CLI binary, so hooking OpenLLMetry into its process is non-trivial.

3. **Sidecar/proxy approach**: Route Claude API calls through a LiteLLM proxy that emits Langfuse telemetry. LiteLLM has native Langfuse integration.

4. **Post-hoc approach**: Claude Code logs its activity; a separate process parses logs and emits Langfuse events via the REST API.

The most practical path for our architecture is likely (1) or (3): the pipeline orchestrator creates traces for each task, and either instruments the underlying API calls or routes them through a proxy.

---

## 6. Complementary Analysis: Langfuse + OpenLLMetry

### What OpenLLMetry Provides

- Auto-instrumentation of LLM provider SDKs (Anthropic, OpenAI, etc.) at the Python/JS level
- OTEL-standard span creation with GenAI semantic conventions
- Automatic capture of prompts, completions, token counts, model parameters
- Framework integrations (LangChain, LlamaIndex, etc.)

### What Langfuse Provides

- Persistent storage and indexing of traces (ClickHouse backend)
- Cost calculation with model-specific pricing (including prompt caching)
- Web dashboard for trace exploration, cost analytics, latency analysis
- Evaluation system (LLM-as-judge, annotation queues, programmatic scores)
- Prompt management with versioning and labels
- Session grouping and user attribution
- Public API for programmatic access to all data

### How They Compose

OpenLLMetry generates OTEL spans; Langfuse's OTLP endpoint ingests them. Langfuse's `ObservationTypeMapperRegistry` handles the semantic convention translation (GenAI operation names, OpenInference span kinds, etc.).

**Gap 1**: OpenLLMetry auto-instruments SDK calls but not pipeline-level orchestration. Custom spans for session lifecycle, task assignments, and status transitions must be emitted manually via OTEL SDK or Langfuse SDK.

**Gap 2**: OpenLLMetry does not emit cost data -- it emits token counts. Langfuse's model pricing engine calculates costs from token counts + model name matching, which is the correct division of responsibility.

**Gap 3**: Neither tool provides fleet-level operational monitoring. OpenLLMetry instruments individual calls; Langfuse aggregates them into traces. Neither watches for stalled workers or escalates failures.

### Composition Quality

High. The OTLP integration is well-tested and the attribute mapping is comprehensive. The two tools have clear, complementary roles with minimal overlap.

---

## 7. Surprises

### Positive Surprises

1. **Anthropic prompt caching cost granularity**: Langfuse supports `input_cache_creation_5m`, `input_cache_creation_1h`, and `input_cache_read` as distinct pricing keys, matching Anthropic's tiered cache-creation pricing (5-minute vs. 1-hour TTL). This level of detail was unexpected and is directly relevant for our Claude-heavy pipeline.

2. **Observation type richness**: The `ObservationType` enum includes AGENT, TOOL, CHAIN, RETRIEVER, EVALUATOR, EMBEDDING, and GUARDRAIL as first-class types beyond just SPAN/GENERATION. This maps well to agentic pipeline components.

3. **Custom dashboards**: The `Dashboard`/`DashboardWidget` system supports fully custom charts (8 chart types) over traces, observations, and scores with arbitrary filters. This could approximate pipeline-operational views without modifying Langfuse code.

4. **Scoring flexibility**: Scores can be attached to sessions (not just traces/observations), which enables session-level quality metrics directly. The CORRECTION data type for output corrections is also notable.

5. **Enterprise edition is minimal**: The `ee/` directory contains only a license check (`isEeAvailable` based on env vars). Nearly all functionality is in the MIT-licensed open-source code. The only EE-gated features visible in the schema are SSO (`SsoConfig`) and SCIM.

### Negative Surprises

1. **Automation triggers are prompt-only**: The `TriggerEventSource` enum has only one value: `Prompt`. Despite the Automation/Trigger/Action infrastructure being general-purpose (webhook, Slack, GitHub dispatch), it currently only fires on prompt version events. Trace-level or observation-level triggers (which would enable alert-on-error or alert-on-cost-spike) are not implemented.

2. **No OTLP metrics endpoint**: `web/src/pages/api/public/otel/v1/metrics/index.ts` exists but is separate from the traces endpoint. The primary ingestion path is trace spans only -- if our pipeline emits OTEL metrics (e.g., custom gauges for queue depth), they may not be well-supported.

3. **Session model is thin**: `TraceSession` in Postgres stores only `id`, `projectId`, `bookmarked`, `public`, `environment`, and timestamps. There is no session-level metadata, tags, or computed metrics stored on the session record itself. Session-level analytics require joining through traces.

4. **Six containers for self-hosting**: The addition of MinIO (S3-compatible storage) as a required component beyond Postgres + ClickHouse + Redis brings the total to six containers, which is heavier than expected for a "run in 5 minutes" setup.

---

## 8. Open Questions for Trial

1. **OTLP ingestion latency**: How quickly do OTEL spans appear in the Langfuse dashboard after emission? The current architecture uploads to S3 first, then processes via a BullMQ queue. What is the end-to-end delay?

2. **ClickHouse resource consumption**: What is the actual memory/CPU footprint of ClickHouse with a moderate trace volume (1000 traces/day, 20 observations each)? Is it viable on a 16GB development machine alongside other workloads?

3. **Custom dashboard coverage**: Can the custom dashboard system create a "pipeline fleet status" view using trace metadata, or are the filter/dimension options too limited for non-standard use cases?

4. **Score API throughput**: If the pipeline writes review verdicts as scores via the API, what is the achievable throughput? Is there batching support for score creation?

5. **Session-level cost aggregation**: How performant is session-level cost rollup via ClickHouse? Is there a pre-computed session-cost view, or must it be aggregated on every query from observations?

6. **OTEL attribute limits**: Are there size limits on OTEL span attributes that would affect storing large metadata payloads (e.g., full task specs or decision logs)?

7. **Eval template for review verdicts**: Can Langfuse's LLM-as-judge eval system (EvalTemplate + JobConfiguration) be configured to run our pipeline's review logic, or should we implement reviews externally and push scores via the API?

8. **Multi-project isolation**: Should different pipeline environments (dev/staging/prod) use separate Langfuse projects, or rely on the `environment` field? What are the query performance implications?

---

## 9. Source Index

Files and directories actually read or searched during this evaluation:

### Top-level
- `/Users/deuley/code/tools/langfuse/README.md` -- project overview
- `/Users/deuley/code/tools/langfuse/CLAUDE.md` (symlink to AGENTS.md) -- agent guidelines, project structure
- `/Users/deuley/code/tools/langfuse/docker-compose.yml` -- self-hosting architecture

### Data Model
- `/Users/deuley/code/tools/langfuse/packages/shared/prisma/schema.prisma` -- full Postgres schema (Trace, Observation, Score, Session, EvalTemplate, JobConfiguration, Automation, Dashboard, etc.)
- `/Users/deuley/code/tools/langfuse/packages/shared/clickhouse/migrations/unclustered/0001_traces.up.sql` -- ClickHouse traces table
- `/Users/deuley/code/tools/langfuse/packages/shared/clickhouse/migrations/unclustered/0002_observations.up.sql` -- ClickHouse observations table
- `/Users/deuley/code/tools/langfuse/packages/shared/clickhouse/migrations/unclustered/0003_scores.up.sql` -- ClickHouse scores table

### Domain Models
- `/Users/deuley/code/tools/langfuse/packages/shared/src/domain/traces.ts` -- TraceDomain Zod schema
- `/Users/deuley/code/tools/langfuse/packages/shared/src/domain/observations.ts` -- ObservationSchema, ObservationType enum
- `/Users/deuley/code/tools/langfuse/packages/shared/src/domain/scores.ts` -- ScoreSchema, ScoreSource, ScoreDataType
- `/Users/deuley/code/tools/langfuse/packages/shared/src/domain/automations.ts` -- Automation, Trigger, Action types
- `/Users/deuley/code/tools/langfuse/packages/shared/src/domain/webhooks.ts` -- Webhook outbound schemas

### OTEL Ingestion
- `/Users/deuley/code/tools/langfuse/packages/shared/src/server/otel/OtelIngestionProcessor.ts` -- core OTLP-to-Langfuse conversion
- `/Users/deuley/code/tools/langfuse/packages/shared/src/server/otel/attributes.ts` -- Langfuse OTEL span attribute definitions
- `/Users/deuley/code/tools/langfuse/packages/shared/src/server/otel/ObservationTypeMapper.ts` -- OTEL-to-ObservationType mapping registry
- `/Users/deuley/code/tools/langfuse/web/src/pages/api/public/otel/v1/traces/index.ts` -- OTLP HTTP endpoint

### Pricing and Cost
- `/Users/deuley/code/tools/langfuse/worker/src/constants/default-model-prices.json` -- model pricing (including all Claude models with cache pricing)
- `/Users/deuley/code/tools/langfuse/packages/shared/src/server/pricing-tiers/matcher.ts` -- pricing tier matching algorithm
- `/Users/deuley/code/tools/langfuse/packages/shared/src/server/pricing-tiers/types.ts` -- pricing tier types
- `/Users/deuley/code/tools/langfuse/.agents/skills/add-model-price/references/provider-sources-and-price-keys.md` -- pricing key documentation

### Dashboard and UI
- `/Users/deuley/code/tools/langfuse/web/src/features/dashboard/components/ModelCostTable.tsx` -- cost table component
- `/Users/deuley/code/tools/langfuse/web/src/features/dashboard/components/ModelUsageChart.tsx` -- usage chart component
- `/Users/deuley/code/tools/langfuse/web/src/features/dashboard/components/TotalMetric.tsx` -- metric display component

### API Surface
- `/Users/deuley/code/tools/langfuse/web/src/pages/api/public/scores/index.ts` -- score CRUD endpoint
- `/Users/deuley/code/tools/langfuse/web/src/pages/api/public/sessions/[sessionId].ts` -- session detail endpoint

### Repositories
- `/Users/deuley/code/tools/langfuse/packages/shared/src/server/repositories/trace-sessions.ts` -- session queries
- `/Users/deuley/code/tools/langfuse/packages/shared/src/server/repositories/` -- repository index (traces, observations, scores, etc.)

### Enterprise Edition
- `/Users/deuley/code/tools/langfuse/ee/src/ee-license-check/index.ts` -- EE license gate (minimal)

### Queue and Ingestion
- `/Users/deuley/code/tools/langfuse/packages/shared/src/server/queues.ts` -- queue schemas and event types
- `/Users/deuley/code/tools/langfuse/packages/shared/src/server/ingestion/types.ts` -- ingestion event type definitions
