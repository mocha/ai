# OpenLLMetry -- Monitoring and Recovery Conformance Evaluation

**Date:** 2026-04-15
**Reviewer:** deuley@ionq.co (automated via source code analysis)
**Source repo:** `/Users/deuley/code/tools/openllmetry/` (Python monorepo, v0.59.1 Anthropic instrumentation)
**Scope:** 13 monitoring-and-recovery requirements for the Skylark AI-agent pipeline

---

## Summary

| Verdict | Count | Requirements |
|---------|-------|-------------|
| MEETS | 2 | #1 (structured telemetry), #6 (audit log) |
| PARTIAL | 3 | #8 (dashboard), #9 (cost telemetry), #12 (predecessor-session discovery) |
| DOES NOT MEET | 8 | #2, #3, #4, #5, #7, #10, #11, #13 |

**Headline:** OpenLLMetry is a high-quality OTEL-native instrumentation library with strong Anthropic/Claude support (token counting, prompt caching, thinking/reasoning, tool use, streaming). It captures the raw telemetry data a backend needs for monitoring, but it is exclusively an instrumentation layer -- it provides zero runtime supervision, recovery, escalation, loop detection, or dashboard capabilities. Those 8 requirements must be satisfied entirely by the backend stack (Langfuse, Jaeger, custom supervisor).

---

## Per-Requirement Findings

### 1. Structured telemetry (OTEL-compatible)

**Verdict:** MEETS

**Evidence:**
- The Anthropic instrumentation (`AnthropicInstrumentor`) is a standard `BaseInstrumentor` subclass that emits OTEL spans via `opentelemetry.trace`, OTEL metrics via `opentelemetry.metrics`, and OTEL log events via `opentelemetry._logs`.
- Every LLM call produces a `SpanKind.CLIENT` span with `gen_ai.provider.name`, `gen_ai.operation.name`, request/response model, token counts, finish reasons, input/output messages, tool definitions, and system instructions.
- Four metric instruments are created per instrumentation: `gen_ai.client.token.usage` (histogram), `gen_ai.client.generation.choices` (counter), `gen_ai.client.operation.duration` (histogram), `llm.anthropic.completion.exceptions` (counter).
- Event-based logging (non-legacy mode with `use_legacy_attributes=False`) emits `gen_ai.user.message`, `gen_ai.system.message`, and `gen_ai.choice` log events via OTEL LogRecord.
- The Traceloop SDK's `@workflow`, `@task`, `@agent`, `@tool` decorators create structured hierarchy spans with `traceloop.span.kind`, `traceloop.entity.name`, `traceloop.entity.input`, `traceloop.entity.output`.
- Standard OTLP export via HTTP (`OTLPSpanExporter`) or gRPC (`GRPCExporter`). Compatible with any OTLP backend.
- Source: `__init__.py` lines 456-480 (metrics creation), lines 527-653 (span lifecycle), `span_utils.py` (attribute population), `event_emitter.py` (log events).

**Notes:**
- Session lifecycle and status transition events are not emitted by OpenLLMetry itself -- those would be custom spans from our pipeline orchestrator using the SDK decorators.
- Decision log entries are not a built-in concept; they would need to be modeled as custom span events or attributes.

---

### 2. Classified health states

**Verdict:** DOES NOT MEET

**Evidence:** No code in the repository models worker health states (working, stalled, GUPP-violation, zombie, idle). OpenLLMetry is purely a data-collection library; it does not analyze or classify operational state.

**Notes:** However, the telemetry it emits (span durations, error rates, exception counters, token usage patterns) provides the raw signals from which a supervisor process could derive health classifications. The `gen_ai.client.operation.duration` histogram and `llm.anthropic.completion.exceptions` counter are particularly useful inputs.

---

### 3. Continuous fleet supervision

**Verdict:** DOES NOT MEET

**Evidence:** No supervisor process, watchdog, or monitoring loop exists anywhere in the codebase. The SDK initializes once (`Traceloop.init()`) and then passively instruments library calls.

**Notes:** Out of scope for an instrumentation library. A backend like Langfuse or a custom supervisor process would consume the OTLP data and implement fleet monitoring.

---

### 4. Supervisor-of-supervisors

**Verdict:** DOES NOT MEET

**Evidence:** No concept of supervisor hierarchy.

**Notes:** Same as #3 -- entirely a backend/orchestration concern. OpenLLMetry's own health can be monitored via standard OTEL self-diagnostics (exporter failures, dropped spans).

---

### 5. Severity-routed escalation

**Verdict:** DOES NOT MEET

**Evidence:** No escalation logic, severity classification, or routing mechanism.

**Notes:** The `dont_throw` decorator (in `utils.py`) suppresses instrumentation errors to avoid crashing the host application, but this is defensive programming, not escalation. Exception events are recorded on spans and counted in metrics, which a backend could use to trigger escalation rules.

---

### 6. Full audit log

**Verdict:** MEETS

**Evidence:**
- Every Anthropic API call (both `messages.create` and `completions.create`, sync and async, streaming and non-streaming) is captured as a span with:
  - `gen_ai.input.messages` -- full prompt content (JSON array with role, parts, tool calls, tool results, reasoning blocks)
  - `gen_ai.output.messages` -- full response content (text, tool calls, reasoning)
  - `gen_ai.system_instructions` -- system prompt
  - `gen_ai.tool.definitions` -- tool schemas
  - `gen_ai.response.id` -- Anthropic message ID
  - `gen_ai.response.model` -- actual model used
  - `gen_ai.response.finish_reasons` -- mapped stop reasons
- The `@task`, `@workflow`, `@agent`, `@tool` decorators capture `traceloop.entity.input` and `traceloop.entity.output` (JSON-serialized function arguments and return values).
- Association properties enable attaching `session_id`, `user_id`, `customer_id` to spans via `Traceloop.set_association_properties()` or the `Associations` class.
- Conversation ID support via `@conversation(conversation_id=...)` decorator or `set_conversation_id()`, which sets `gen_ai.conversation.id` on all spans in context.
- Source: `span_utils.py` (aset_input_attributes, set_response_attributes), `associations.py`, `tracing.py` lines 257-269.
- Content tracing can be disabled via `TRACELOOP_TRACE_CONTENT=false` for privacy; even then, metadata (model, tokens, duration, finish reason) is still captured.

**Notes:** The audit log is complete for direct Anthropic SDK calls. Queryability depends on the backend (Langfuse, Jaeger, Datadog, etc.) All tool calls made via MCP are also instrumented with input/output capture (see MCP instrumentation).

---

### 7. Crash recovery automation

**Verdict:** DOES NOT MEET

**Evidence:** No crash detection, stale state handling, or orphaned process recovery. The `dont_throw` decorator is purely about swallowing instrumentation errors, not recovering from application crashes.

**Notes:** The `AnthropicStream` and `AnthropicAsyncStream` classes do have `_instrumentation_completed` flags to prevent double-completion, but this is span lifecycle management, not crash recovery. A supervisor process would need to implement recovery using span data (e.g., detecting incomplete spans without end timestamps).

---

### 8. Human-visible dashboard

**Verdict:** PARTIAL

**Evidence:**
- OpenLLMetry does not include any dashboard, TUI, or visualization.
- However, it exports standard OTLP data to 25+ tested destinations (listed in README.md), including Datadog, Grafana, Honeycomb, New Relic, Splunk, and others that provide dashboarding.
- The `gen_ai.client.token.usage`, `gen_ai.client.operation.duration`, and `gen_ai.client.generation.choices` metrics are designed to feed metric dashboards.
- For debugging, `ConsoleSpanExporter` can dump all spans to stdout (documented in CLAUDE.md).

**Notes:** Rated PARTIAL because while OpenLLMetry itself provides no dashboard, it is specifically designed to feed dashboard-capable backends, and the metric names follow OTEL GenAI semantic conventions that these backends increasingly have pre-built dashboards for.

---

### 9. Cost telemetry

**Verdict:** PARTIAL

**Evidence:**
- **Tokens per call:** Fully captured. Every span includes `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.total_tokens`. These come from the Anthropic API response's `usage` object when available, or are estimated via `anthropic.count_tokens()` as fallback.
- **Prompt caching tokens:** Fully captured. `gen_ai.usage.cache_read.input_tokens` and `gen_ai.usage.cache_creation.input_tokens` are separate span attributes. Tests in `test_prompt_caching.py` verify exact token counts for both cache creation and cache read scenarios.
- **Cache hit rate:** Derivable from the cache_read vs cache_creation token attributes, but not computed as a pre-built metric.
- **Streaming token usage:** Captured via `message_start` (input tokens) and `message_delta` (output tokens) events during stream processing. The `_process_response_item` function in `streaming.py` accumulates these.
- **Thinking/reasoning tokens:** The response content is captured with `type: "reasoning"` parts, but there is no separate `gen_ai.usage.reasoning_tokens` attribute set by the Anthropic instrumentation. The semantic conventions define `gen_ai.usage.reasoning_tokens` but it is not populated.
- **Dollar cost:** NOT captured. There is no pricing model, cost calculation, or `gen_ai.usage.cost` attribute anywhere in the codebase. A `grep` for "cost" and "price" across the entire repo returns zero hits in instrumentation code.
- **Token histogram metric:** `gen_ai.client.token.usage` is recorded with `gen_ai.token.type` = "input" or "output" and `gen_ai.response.model` attributes, enabling per-model token dashboards.

**Notes:** Token counting is solid and includes Anthropic-specific features (prompt caching). Dollar cost would need to be computed by the backend using a pricing table keyed on `gen_ai.response.model` and token counts. This is a common pattern -- Langfuse, for example, has built-in cost calculation from token counts. Thinking tokens are a gap: Anthropic returns them in `usage` but the instrumentation does not extract them as a separate attribute.

---

### 10. Idempotent recovery actions

**Verdict:** DOES NOT MEET

**Evidence:** No recovery actions exist to evaluate for idempotency.

**Notes:** The `_instrumentation_completed` flag in streaming wrappers (`AnthropicStream`, `AnthropicAsyncStream`) prevents double-completion of spans, which is a form of idempotency in the instrumentation layer. But this is not recovery.

---

### 11. Severity-routed notifications

**Verdict:** DOES NOT MEET

**Evidence:** No notification system, alerting, or severity routing.

**Notes:** The telemetry data (especially the exception counter `llm.anthropic.completion.exceptions` and error spans) can feed alerting rules in a backend. The `error.type` attribute on exception metrics enables filtering by exception class.

---

### 12. Predecessor-session discovery

**Verdict:** PARTIAL

**Evidence:**
- The `@conversation(conversation_id=...)` decorator and `set_conversation_id()` function set `gen_ai.conversation.id` on all spans in the current context. This enables querying all spans from a conversation across sessions.
- `Traceloop.set_association_properties()` supports `session_id`, `user_id`, and arbitrary key-value pairs that are stored as `traceloop.association.properties` on spans.
- MCP client instrumentation creates session-level spans (`mcp.client.session`) with `traceloop.span.kind: "session"`.
- Trace context propagation across MCP boundaries is implemented (via `TraceContextTextMapPropagator` injection/extraction on MCP `_meta`).
- Source: `associations.py`, `tracing.py` lines 257-269, `mcp/instrumentation.py` lines 213-267.

**Notes:** A restarted worker could query the backend for spans matching a `conversation_id` or `session_id` to discover predecessor sessions. However, OpenLLMetry provides no built-in mechanism for this discovery -- it only ensures the correlation data is present in the telemetry. The actual query would be a backend API call (e.g., Langfuse's trace search).

---

### 13. Loop detection

**Verdict:** DOES NOT MEET

**Evidence:** No loop detection, pattern matching, or doom-loop prevention logic anywhere in the codebase.

**Notes:** The telemetry data (repeated identical input messages, high token consumption without progress, repeated tool call patterns) could be analyzed by a backend or supervisor to detect loops. The `gen_ai.input.messages` and `gen_ai.output.messages` span attributes provide the raw data needed for pattern matching. But this analysis is entirely outside OpenLLMetry's scope.

---

## Instrumentation Deep-Dive: Anthropic/Claude

### Wrapped Methods

The Anthropic instrumentation wraps all variants of the Messages and Completions APIs:

| Package | Class | Method | Span Name |
|---------|-------|--------|-----------|
| `anthropic.resources.messages` | `Messages` | `create` | `anthropic.chat` |
| `anthropic.resources.messages` | `Messages` | `stream` | `anthropic.chat` |
| `anthropic.resources.messages` | `AsyncMessages` | `create` | `anthropic.chat` |
| `anthropic.resources.messages` | `AsyncMessages` | `stream` | `anthropic.chat` |
| `anthropic.resources.completions` | `Completions` | `create` | `anthropic.completion` |
| `anthropic.resources.completions` | `AsyncCompletions` | `create` | `anthropic.completion` |
| `anthropic.resources.beta.messages.messages` | `Messages` / `AsyncMessages` | `create` / `stream` | `anthropic.chat` |
| `anthropic.lib.bedrock._beta_messages` | `Messages` / `AsyncMessages` | `create` / `stream` | `anthropic.chat` |

### Span Attributes Emitted

**Always set:**
- `gen_ai.provider.name` = `"anthropic"` (from `GenAiSystemValues.ANTHROPIC`)
- `gen_ai.operation.name` = `"chat"` or `"text_completion"`

**Request attributes (from kwargs):**
- `gen_ai.request.model` -- requested model name
- `gen_ai.request.max_tokens` -- max_tokens or max_tokens_to_sample
- `gen_ai.request.temperature`
- `gen_ai.request.top_p`
- `gen_ai.request.frequency_penalty`
- `gen_ai.request.presence_penalty`
- `gen_ai.is_streaming` -- boolean

**Response attributes:**
- `gen_ai.response.model` -- actual model used
- `gen_ai.response.id` -- Anthropic message ID (e.g., `msg_01EF3r8z...`)
- `gen_ai.response.finish_reasons` -- array of mapped finish reasons (see mapping below)
- `gen_ai.usage.input_tokens` -- includes base + cache_read + cache_creation
- `gen_ai.usage.output_tokens`
- `gen_ai.usage.total_tokens` (custom, not in OTEL spec)
- `gen_ai.usage.cache_read.input_tokens` (custom, Anthropic-specific)
- `gen_ai.usage.cache_creation.input_tokens` (custom, Anthropic-specific)

**Content attributes (when `TRACELOOP_TRACE_CONTENT=true`, the default):**
- `gen_ai.input.messages` -- JSON array of `{role, parts: [{type, content}]}` structures
- `gen_ai.output.messages` -- JSON array of `{role, parts: [...], finish_reason}` structures
- `gen_ai.system_instructions` -- JSON array of system message parts
- `gen_ai.tool.definitions` -- JSON array of `{name, description, input_schema}` objects

### Content Block Types

| Anthropic Block Type | OTEL Parts Type | Fields |
|---------------------|-----------------|--------|
| `text` | `text` | `{type: "text", content: "..."}` |
| `thinking` | `reasoning` | `{type: "reasoning", content: "..."}` |
| `redacted_thinking` | (skipped) | Not included in output |
| `tool_use` | `tool_call` | `{type: "tool_call", id, name, arguments}` |
| `tool_result` (input) | `tool_call_response` | `{type: "tool_call_response", id, response}` |
| `image` (base64) | `blob` | `{type: "blob", modality: "image", mime_type, content}` |
| `image` (URL) | `uri` | `{type: "uri", modality: "image", uri}` |

### Finish Reason Mapping

| Anthropic `stop_reason` | OTEL `finish_reason` |
|------------------------|---------------------|
| `end_turn` | `stop` |
| `tool_use` | `tool_call` |
| `max_tokens` | `length` |
| `stop_sequence` | `stop` |

### Metrics Emitted

| Metric Name | Type | Dimensions |
|------------|------|-----------|
| `gen_ai.client.token.usage` | Histogram | `gen_ai.token.type` (input/output), `gen_ai.response.model`, `gen_ai.provider.name` |
| `gen_ai.client.generation.choices` | Counter | `gen_ai.response.model`, `gen_ai.response.finish_reason`, `gen_ai.provider.name` |
| `gen_ai.client.operation.duration` | Histogram (seconds) | `gen_ai.response.model`, `gen_ai.provider.name` |
| `llm.anthropic.completion.exceptions` | Counter | `error.type`, `gen_ai.provider.name` |

### What Is Missing

1. **Dollar cost attributes** -- no `gen_ai.usage.cost` or pricing calculation.
2. **Thinking/reasoning token count** -- the `gen_ai.usage.reasoning_tokens` attribute is defined in `SpanAttributes` but never set by the Anthropic instrumentation. The Anthropic API does not currently break out thinking tokens separately in `usage` (they are included in `output_tokens`), so this would require content-length estimation.
3. **Image/tool token counting** -- the `count_prompt_tokens_from_request` fallback path has a TODO comment: `# TODO: handle image and tool tokens`. Only text content tokens are counted in the fallback path.
4. **Extended thinking budget** -- the `thinking.budget_tokens` parameter from the request is not captured as a span attribute.
5. **`gen_ai.request.stop_sequences`** -- not captured despite being a common Anthropic parameter.
6. **Latency breakdown** -- only total operation duration is captured; there is no time-to-first-token metric for streaming.

---

## Integration Surface

### Direct Anthropic SDK Instrumentation

For Python processes that use the `anthropic` SDK directly:

```python
from traceloop.sdk import Traceloop
Traceloop.init(app_name="skylark-worker", exporter=your_otlp_exporter)
```

Or without the SDK wrapper:

```python
from opentelemetry.instrumentation.anthropic import AnthropicInstrumentor
AnthropicInstrumentor().instrument()
```

This monkey-patches the Anthropic SDK's `Messages.create`, `Messages.stream`, etc. All subsequent API calls are automatically instrumented. No code changes needed in the application.

### Claude Code CLI Workers (`claude --bare -p`)

**Critical limitation: OpenLLMetry cannot instrument Claude Code CLI processes.**

Claude Code is a standalone binary (or Node.js application) that manages its own Anthropic API calls internally. OpenLLMetry works by monkey-patching the Python `anthropic` SDK at import time via `wrapt.wrap_function_wrapper`. Since Claude Code:

1. Is not a Python process (it is a Node.js/TypeScript binary)
2. Does not use the Python `anthropic` SDK
3. Does not expose its internal API calls for external instrumentation

...there is no mechanism for OpenLLMetry (Python) to intercept Claude Code's API calls. The JS/TS variant ([OpenLLMetry-JS](https://github.com/traceloop/openllmetry-js)) could potentially instrument the Node.js internals, but Claude Code does not expose a plugin or instrumentation hook.

**Workaround options:**
1. **Wrap the subprocess:** Create a Python orchestrator that spawns `claude --bare -p` and captures its stdout/stderr as span events. Token usage and cost would need to be parsed from Claude Code's output (if it reports them) or obtained from the Anthropic API usage dashboard.
2. **Use the Anthropic API directly:** Instead of shelling out to `claude --bare -p`, have workers call the Anthropic Messages API via the Python SDK, which OpenLLMetry can fully instrument.
3. **OTEL collector sidecar:** If Claude Code emits any OTLP data natively (it does not currently), a collector could forward it. This is speculative.

### MCP Instrumentation

For agents that use MCP (Model Context Protocol) for tool calling, the `McpInstrumentor` instruments both client and server sides:
- MCP `tools/call` creates `{tool_name}.tool` spans with `traceloop.span.kind: "tool"`
- MCP client sessions create `mcp.client.session` spans
- Trace context propagates across MCP boundaries via the `_meta.traceparent` field

This is relevant if our pipeline agents use MCP servers for tool execution.

### Hierarchical Trace Structure

Using the SDK decorators, a pipeline can be structured as:

```
pipeline_run.workflow
  +-- stage_1.task
  |     +-- anthropic.chat (auto-instrumented)
  +-- stage_2.agent
        +-- tool_call.tool
        +-- anthropic.chat (auto-instrumented)
```

Each level inherits the trace context, enabling per-stage cost attribution by summing token usage spans within each task/workflow span.

---

## Surprises

1. **Bedrock support is baked in.** The Anthropic instrumentation also wraps `anthropic.lib.bedrock._beta_messages`, so if we route through AWS Bedrock, instrumentation still works without additional packages.

2. **Image upload callback.** The `AnthropicInstrumentor` accepts an `upload_base64_image` callback that can upload base64 images from prompts to external storage and replace them with URIs in the span data. This is a thoughtful touch for keeping span payloads manageable.

3. **Legacy vs. event-based modes.** The instrumentation has two modes controlled by `use_legacy_attributes`. Legacy mode (default, `True`) stores everything as span attributes. Event mode (`False`) emits `gen_ai.user.message`, `gen_ai.choice`, etc. as OTEL LogRecords. The event mode is closer to the OTEL GenAI spec direction, but the legacy mode is more widely compatible with backends today.

4. **`dont_throw` pervasive.** Almost every instrumentation function is wrapped in `@dont_throw`, which catches all exceptions and logs them at DEBUG level. This means instrumentation failures are completely silent at default log levels -- good for production stability, but debugging instrumentation issues requires setting `PYTHONLOGGING=DEBUG`.

5. **Thread-based async fallback.** The `run_async` utility (in `utils.py`) handles the case where an async method needs to run in a sync context by spawning a thread with its own event loop. This is a pragmatic but fragile approach that could cause issues in heavily threaded applications.

6. **Semantic conventions are upstream.** The README notes that OpenLLMetry's semantic conventions are now part of the official OpenTelemetry spec. This means the `gen_ai.*` attribute names are standardized and will be recognized by backends that implement the OTEL GenAI semconv.

7. **No cost calculation by design.** The complete absence of pricing/cost logic appears intentional -- keeping the instrumentation library focused on observable facts (tokens counted by the API) rather than derived values (dollar costs that depend on contract pricing, volume discounts, etc.).

---

## Open Questions for Trial

1. **Streaming token accuracy.** The streaming path accumulates `output_tokens` from `message_delta` events. Does this match the final token count from a non-streaming call for the same prompt? The test cassettes suggest yes, but a live trial should verify.

2. **Thinking token attribution.** When extended thinking is enabled, Anthropic includes thinking tokens in `output_tokens`. Can we distinguish thinking cost from response cost in practice? The semantic convention `gen_ai.usage.reasoning_tokens` exists but is not populated.

3. **Prompt caching across workers.** If multiple workers share the same Anthropic organization, prompt caching is cross-session. Do the `cache_read.input_tokens` attributes accurately reflect cross-worker cache hits?

4. **Performance overhead.** The `aset_input_attributes` function JSON-serializes the entire prompt for every call. For large prompts (100K+ tokens), what is the serialization overhead? Does it block the event loop?

5. **OTLP payload size.** With `TRACELOOP_TRACE_CONTENT=true`, span attributes can be enormous (full prompt + response text). Does this cause issues with OTLP exporters that have payload size limits?

6. **Claude Code telemetry.** Does the Claude Code CLI emit any structured telemetry (OTLP or otherwise) that could be collected? Check `claude --help` for tracing/telemetry flags.

7. **Langfuse compatibility.** Langfuse has native OpenLLMetry integration. Does it correctly parse the `gen_ai.usage.cache_read.input_tokens` and `gen_ai.usage.cache_creation.input_tokens` attributes for Anthropic-specific cost calculation?

8. **Guardrail telemetry.** The Traceloop SDK includes a `@guardrail` decorator. Does it emit spans/events when guards fail? This could be useful for detecting content policy violations.

9. **Multi-process trace correlation.** If our pipeline spawns subprocess workers, can trace context be propagated via environment variables or CLI arguments? The SDK uses `TraceContextTextMapPropagator` for MCP but there is no built-in subprocess propagation.

---

## Source Index

Files read during this evaluation (all paths relative to `/Users/deuley/code/tools/openllmetry/`):

**Core instrumentation:**
- `packages/opentelemetry-instrumentation-anthropic/opentelemetry/instrumentation/anthropic/__init__.py` -- main instrumentor, span lifecycle, wrapped methods
- `packages/opentelemetry-instrumentation-anthropic/opentelemetry/instrumentation/anthropic/span_utils.py` -- attribute population, content-to-parts conversion, finish reason mapping
- `packages/opentelemetry-instrumentation-anthropic/opentelemetry/instrumentation/anthropic/utils.py` -- token counting, error handling, metrics helpers
- `packages/opentelemetry-instrumentation-anthropic/opentelemetry/instrumentation/anthropic/streaming.py` -- stream wrappers, streaming token accumulation
- `packages/opentelemetry-instrumentation-anthropic/opentelemetry/instrumentation/anthropic/event_emitter.py` -- OTEL log event emission
- `packages/opentelemetry-instrumentation-anthropic/opentelemetry/instrumentation/anthropic/event_models.py` -- event dataclass definitions
- `packages/opentelemetry-instrumentation-anthropic/opentelemetry/instrumentation/anthropic/config.py` -- configuration class
- `packages/opentelemetry-instrumentation-anthropic/pyproject.toml` -- dependencies, version

**Semantic conventions:**
- `packages/opentelemetry-semantic-conventions-ai/opentelemetry/semconv_ai/__init__.py` -- SpanAttributes, Meters, GenAISystem enums
- `packages/opentelemetry-semantic-conventions-ai/opentelemetry/semconv_ai/_testing.py` -- compliance test suite

**Traceloop SDK:**
- `packages/traceloop-sdk/traceloop/sdk/__init__.py` -- SDK init, export configuration
- `packages/traceloop-sdk/traceloop/sdk/decorators/__init__.py` -- @workflow, @task, @agent, @tool decorators
- `packages/traceloop-sdk/traceloop/sdk/decorators/base.py` -- decorator implementation, span setup
- `packages/traceloop-sdk/traceloop/sdk/instruments.py` -- Instruments enum
- `packages/traceloop-sdk/traceloop/sdk/associations/associations.py` -- session/user/customer association
- `packages/traceloop-sdk/traceloop/sdk/tracing/tracing.py` -- TracerWrapper, conversation_id, OTLP export setup
- `packages/traceloop-sdk/traceloop/sdk/tracing/context_manager.py` -- tracer context manager

**MCP instrumentation:**
- `packages/opentelemetry-instrumentation-mcp/opentelemetry/instrumentation/mcp/instrumentation.py` -- MCP client/server instrumentation, trace propagation

**Tests (verification of behavior):**
- `packages/opentelemetry-instrumentation-anthropic/tests/test_thinking.py` -- thinking/reasoning block handling
- `packages/opentelemetry-instrumentation-anthropic/tests/test_prompt_caching.py` -- cache token attributes
- `packages/opentelemetry-instrumentation-anthropic/tests/test_semconv_span_attrs.py` -- OTEL GenAI spec compliance
- `packages/opentelemetry-instrumentation-anthropic/tests/test_semconv_compliance.py` -- shared compliance tests
- `packages/opentelemetry-instrumentation-anthropic/tests/utils.py` -- metric verification helpers

**Repository-level:**
- `CLAUDE.md` -- repo structure, debugging guidance
- `README.md` -- overview, supported destinations, instrumented libraries
