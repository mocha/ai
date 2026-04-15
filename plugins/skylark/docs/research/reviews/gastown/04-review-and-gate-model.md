# Gas Town — Review and Gate Model Conformance Evaluation

## Summary

- Conformance at a glance: 3 MEETS, 5 PARTIAL, 5 MISSING, 0 N/A (out of 13)
- Headline: Gas Town has a real review primitive (convoy-style parallel review formulas with synthesis) and a real severity-routed escalation protocol, but it lacks explicit typed gate verdicts, bounded revision loops, recurring-findings automation, and a documented human-override path for gates.

## Per-Requirement Findings

### Req 1: Stage gates are explicit. Stage completion does not imply stage-passed. Every stage has a gate artifact (verdict + evidence) separate from the work artifact.

- Verdict: PARTIAL
- Evidence:
  - `internal/formula/formulas/gate-bead-instructions.md:23-29`: "This is a verification gate for plan **{{plan_title}}** (`{{plan_bead}}`). You are a gate polecat. Your job is to execute the review steps listed below against the implementation work that was done under this plan."
  - `gate-bead-instructions.md:32-35`: "This bead is blocked by all implementation tasks under the plan. When you receive this bead, all implementation is complete. Execute each review step below in order. If ALL steps pass cleanly, close this gate bead (signals plan is ready)."
  - `internal/formula/formulas/mol-plan-review.formula.toml` writes a separate `plan-review.md` synthesis artifact into `.plan-reviews/{{.review_id}}/` that is distinct from the plan itself.
  - `internal/formula/formulas/code-review.formula.toml:132`: `synthesis = "review-summary.md"` — review output is a separate artifact from the code under review.
- Notes: A "gate bead" primitive exists (distinct bead, blocked by implementation work). However, gates-as-blocking-beads only appear in the `mol-decompose-with-gates` template path; most molecule formulas (e.g. `shiny.formula.toml`) encode "review" as a step with an `acceptance` string rather than a separate gate artifact. Formulas like `mol-plan-review` produce a verdict file but are not uniformly wired as blocking gate beads.

### Req 2: Typed verdicts. Gates emit one of `approve`, `revise`, `reject`, `escalate`. No ambiguous "looks good" prose-only outcomes.

- Verdict: PARTIAL
- Evidence:
  - `mol-plan-review.formula.toml`: leg verdict vocabulary is `"PASS / PASS WITH NOTES / FAIL — one sentence rationale"`; synthesis verdict is `"**GO / GO WITH FIXES / NO-GO** — one paragraph rationale"`.
  - `gate-bead-instructions.md:103-113`: binary outcome — `bd close {{gate_id}} --reason="Gate passed: all review steps clean"` for clean pass, otherwise "file one fix bead per issue found" and re-dispatch.
  - `code-review.formula.toml` synthesis structure: `"Executive Summary - Overall assessment, merge recommendation"` (prose).
  - `gt escalate -s <MEDIUM|HIGH|CRITICAL>` exists as its own CLI primitive but is orthogonal to review verdicts.
- Notes: Verdict vocabularies exist per formula (PASS/FAIL, GO/NO-GO) but they are not a unified framework-wide typed enum, and not all review legs produce typed verdicts — several code-review synthesis fields are explicit prose ("merge recommendation", "executive summary"). No canonical `approve/revise/reject/escalate` enum.

### Req 3: Multi-reviewer panels for high-risk stages. Elevated+ risk stages support parallel independent review by multiple domain experts, followed by synthesis.

- Verdict: MEETS
- Evidence:
  - `code-review.formula.toml` description: `"Comprehensive code review via parallel specialized reviewers. Each leg examines the code from a different perspective. Findings are collected and synthesized into a prioritized, actionable review."`
  - Legs enumerated (`code-review.formula.toml`): `correctness`, `performance`, `security`, `elegance`, `resilience`, `style`, `smells`, `wiring`, `commit-discipline`, `test-quality`.
  - `type = "convoy"` with `[synthesis]` section and `depends_on = [<all legs>]` at line 458.
  - `mol-plan-review.formula.toml` legs: `completeness`, `sequencing`, `risk`, `scope-creep`, `testability`, with a synthesis step.
  - `mol-prd-review.formula.toml` legs: `requirements`, `gaps`, `ambiguity`, `feasibility`, `scope`, `stakeholders`.
- Notes: This is a first-class mechanism. Parallelism is via convoy legs spawning polecats; synthesis is a dedicated step.

### Req 4: Panel reviewers generated per-domain at dispatch time. Reviewers are not a fixed roster — they are generated or selected based on the stage's domain, matching the Worker Model requirement for per-task prompt generation.

- Verdict: PARTIAL
- Evidence:
  - `code-review.formula.toml` defines `[presets]`: `gate` (`legs = ["wiring", "security", "smells", "test-quality"]`), `full`, `secure`, `refactor`. Legs can also be selected `via --legs flag`.
  - Leg prompts are populated at runtime via Go text/template: `[prompts] base = """... Your focus: {{.leg.focus}} ..."""` with per-leg `focus` and `description`.
  - Each leg is a named static entry in the TOML (`[[legs]] id = "correctness"`…). The roster is a fixed set in the formula file; what varies is which subset of legs fires (via preset or `--legs`).
- Notes: Per-task prompts are templated, but the reviewer roster itself is a fixed, declaratively enumerated list per formula. No evidence of runtime-generated reviewer specs based on analyzing the artifact's domain.

### Req 5: Bounded revision loops. Max N rounds (default 2) before escalation to human or higher-tier review. Loops do not run unbounded.

- Verdict: MISSING
- Evidence:
  - `gate-bead-instructions.md:76-103` ("Retry Loop Protocol") describes: file fix beads → add them as blocking deps on the gate bead → exit. "When ALL fix beads close, this gate bead becomes unblocked again. The stranded-bead scan re-dispatches this gate bead to a fresh polecat within 30 seconds of becoming unblocked. The fresh polecat re-runs all review steps from the top."
  - No max-round counter, no N-rounds-then-escalate in this protocol, no round tracking label.
  - Escalation config caps re-escalations (`escalation.json: "max_reescalations": 2`), but this bounds severity bumps, not review-gate revision rounds.
  - No evidence found in `internal/formula/formulas/*.toml`, `docs/design/escalation.md`, `docs/design/polecat-lifecycle-patrol.md`.
- Notes: The gate retry loop, as documented, can re-fire indefinitely. The only boundedness is the Witness/Deacon crash-loop escalation ("Crash loop (3+ crashes) … Witness escalates to mayor" — `polecat-lifecycle-patrol.md:313`), which is infrastructure health, not review revision rounds.

### Req 6: Gate criteria defined in the spec. Each stage's gate references a checklist or criteria document — reviewers do not invent criteria on the fly.

- Verdict: MEETS
- Evidence:
  - Every leg in `code-review.formula.toml` has an enumerated `**Look for:**` checklist and `**Questions to answer:**` section. Example (security leg): `"Input validation gaps / Authentication/authorization bypasses / Injection vulnerabilities (SQL, XSS, command, LDAP) / ... / OWASP Top 10 concerns"`.
  - `mol-plan-review.formula.toml` legs each carry explicit `**Look for:**` lists (completeness, sequencing, risk, scope-creep, testability).
  - `gate-bead-instructions.md:47-55`: gate bead description includes rendered `### <step.name> / <step.description> / **Instructions:** / <step.instructions>` per step from `.gates.toml`.
- Notes: Criteria are in the formula TOML and surface into the reviewer's prompt at dispatch.

### Req 7: Recurring findings become automation. Any pattern that surfaces across >2 reviews is converted to a lint rule, CI check, or pre-dispatch validator. The review layer does not keep rediscovering the same class of bug.

- Verdict: MISSING
- Evidence: No mentions of recurring-finding detection, cross-review aggregation, lint-rule generation, or pre-dispatch validators found in `docs/design/`, `internal/formula/formulas/`, or CLI help. `gt escalate` tracks escalations but not review-finding patterns. No evidence of meta-analysis across review outputs.
- Notes: Individual review synthesis deduplicates findings _within a single review_ (`code-review.formula.toml`: "Deduplicate issues found by multiple legs"), but there is no mechanism across reviews.

### Req 8: Evidenced approvals. Approval records include reviewer identity, timestamp, criteria reference, and findings. Stored in the artifact substrate, not ephemeral chat.

- Verdict: PARTIAL
- Evidence:
  - Review outputs are filesystem artifacts: `code-review.formula.toml [output] directory = ".reviews/{{.review_id}}" / leg_pattern = "{{.leg.id}}-findings.md" / synthesis = "review-summary.md"`. Each leg is a file.
  - Gate bead closure writes an explicit reason: `bd close {{gate_id}} --reason="Gate passed: all review steps clean"` (`gate-bead-instructions.md:105`).
  - Beads carry timestamps and identity fields as part of their schema (per `docs/design/escalation.md` label schema and general Beads usage).
  - No explicit evidence that the per-leg output file records the reviewer polecat identity or the exact criteria-file version; the synthesis template does not require reviewer identity or criteria reference.
- Notes: Evidence is persisted (files, beads) rather than chat, but the approval record schema does not enforce reviewer identity or criteria reference. Findings and verdicts are captured; identity/timestamp are implicit via filesystem/bead metadata, not explicit fields in the review artifact template.

### Req 9: Severity-routed escalation. Escalation from a failed gate routes by severity and target audience — peer review, senior reviewer, human operator, external approver.

- Verdict: MEETS
- Evidence:
  - `docs/design/escalation.md:13-19` severity table: CRITICAL (P0) → bead + mail + email + SMS; HIGH (P1) → bead + mail + email; MEDIUM (P2) → bead + mail mayor.
  - Tiered flow (`escalation.md:23-33`): `Agent → gt escalate → [Deacon receives] → forwards to Mayor → forwards to Overseer`.
  - `~/gt/settings/escalation.json` defines per-severity routes:
    ```json
    "routes": {
      "medium": ["bead", "mail:mayor"],
      "high":   ["bead", "mail:mayor", "email:human"],
      "critical": ["bead", "mail:mayor", "email:human", "sms:human"]
    }
    ```
  - `gt escalate --help`: `--severity string   Severity level: critical, high, medium, low (default "medium")`.
  - Stale detection bumps severity: `gt escalate stale` "Re-escalates stale (unacked past `stale_threshold`) escalations. Bumps severity (MEDIUM→HIGH→CRITICAL), re-executes route, respects `max_reescalations`."
- Notes: Escalation is a general-purpose primitive; gate failures can invoke it (e.g., `"gate_timeout"` category is explicitly listed in `escalation.md:95`), but gate retry protocol in `gate-bead-instructions.md` does not itself invoke `gt escalate` — it re-queues. Severity routing is fully implemented for the escalation primitive.

### Req 10: Lightweight and heavyweight variants. Trivial risk gets a single-reviewer conformance check; elevated/critical gets a full panel. Gate shape is a function of risk level.

- Verdict: PARTIAL
- Evidence:
  - `code-review.formula.toml [presets]`:
    - `gate` preset: `legs = ["wiring", "security", "smells", "test-quality"]` — description: "Light review for automatic flow"
    - `full` preset: all 10 legs
    - `secure` preset: `["security", "resilience", "correctness", "wiring"]`
    - `refactor` preset: `["elegance", "smells", "style", "commit-discipline"]`
  - No evidence of risk-level→preset auto-selection. Preset is chosen at dispatch time by the caller.
  - `shiny.formula.toml` is a single-step "review" with an `acceptance` string — the lightweight form.
- Notes: Lightweight and heavyweight preset shapes exist, but there is no framework-level risk-tier taxonomy that maps to presets. Caller must explicitly choose.

### Req 11: Plan-vs-reality validation. Before any implementation worker is dispatched, a gate checks the plan's signatures/paths/assumptions against current code and blocks on drift.

- Verdict: MISSING
- Evidence: No mention of plan-vs-code drift validation, signature checking, or pre-dispatch code-reality verification found in `docs/design/`, any formula TOML, or CLI help. `mol-plan-review.formula.toml` reviews the plan document against a PRD, not against the current codebase. The `wiring` leg in `code-review.formula.toml` checks "dependencies added but not used" in already-implemented code, not plan-to-code drift before dispatch.
- Notes: No pre-dispatch drift gate exists.

### Req 12: Human override. A human operator can always override a gate — approve a rejected artifact, or reject an approved one — with an auditable record of the override.

- Verdict: MISSING
- Evidence:
  - `bd close` can close any bead with `--reason "..."` (general beads mechanic), which would close a gate bead. But nothing documented as a gate-override primitive.
  - `gt escalate ack/close` acknowledge or close escalations, not gates.
  - No command like `gt gate override`, no documented override audit-record schema, no mention in `gate-bead-instructions.md` of a human override path.
  - Grep for "override" in gastown docs returned only config/env-variable overrides (`mayor.go:43-128`: rig/role/town-root env overrides) and no gate override.
- Notes: A human could manually `bd close` a gate bead, but this is not a documented, audited override mechanism.

### Req 13: Gates are composable primitives. Specific stages (spec review, plan review, implementation review) compose a shared gate primitive rather than each re-implementing review logic.

- Verdict: PARTIAL
- Evidence:
  - Shared convoy/leg mechanism: `mol-prd-review`, `mol-plan-review`, and `code-review` all use `type = "convoy"`, `[prompts] base`, `[[legs]]`, `[synthesis]`. Same shape, different legs.
  - `gate-bead-instructions.md` is a shared template for gate beads, consumed by a `mol-decompose-with-gates` formula (referenced in the template header).
  - Each review formula duplicates the leg/synthesis structure in its own TOML (no import/include across formulas); the prompt template is per-formula.
- Notes: Convoy is a single engine/formula-type the reviews share, and the gate bead template is genuinely shared. But each review formula re-declares its own legs and synthesis inline, so there is partial composition at the engine level and no composition at the configuration level.

## Surprises

- Review outputs are written to filesystem under `.reviews/<review-id>/` and `.plan-reviews/<review-id>/` per formula `[output]` config (`code-review.formula.toml:131-133`; `mol-plan-review.formula.toml:107-110`). This sits alongside Beads as the ledger — reviews are file artifacts, escalations are beads, gate beads are the bridge.
- The gate retry protocol in `gate-bead-instructions.md:76-103` uses the Beads dependency graph as the loop mechanism: fix beads block the gate, closing fix beads unblocks it, a "stranded-bead scan" re-dispatches the gate within 30 seconds. There is no explicit round counter; re-runs are implicit in the blocker resolution.
- `gt refinery` (the Bors-style merge queue) is adjacent to but not the review gate: its validation is "tests, builds, checks" and conflict handling spawns a fresh polecat to re-implement. No review-panel involvement in Refinery per `gt refinery --help`.
- `escalation.md:95` names `gate_timeout` as a future escalation category ("Category Routing (future)... Not yet implemented as CLI flags"), acknowledging a gate→escalation bridge that is not yet wired.

## Open Questions for Trial

- Does a real `mol-decompose-with-gates` run produce a gate bead whose description renders correctly, and what happens on a 5th retry round (is there any silent bound)?
- When a gate polecat files fix beads and exits, does the fresh polecat that re-runs the gate have access to the prior review's findings as evidence, or does it re-review from scratch each round?
- Do review output files (`.reviews/<id>/correctness-findings.md`) carry reviewer-polecat identity in frontmatter/metadata, or only inside prose?
- Is there an unwritten convention for humans to reject a passed gate (re-open the gate bead + file a fix), and is that auditable via bead history?

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/04-review-and-gate-model.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md`
- `/Users/deuley/code/tools/gastown/docs/design/escalation.md`
- `/Users/deuley/code/tools/gastown/docs/design/witness-at-team-lead.md`
- `/Users/deuley/code/tools/gastown/docs/design/polecat-lifecycle-patrol.md`
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/code-review.formula.toml`
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/mol-plan-review.formula.toml`
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/mol-prd-review.formula.toml`
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/mol-polecat-code-review.formula.toml`
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/gate-bead-instructions.md`
- `/Users/deuley/code/tools/gastown/internal/formula/formulas/shiny.formula.toml`
- `/Users/deuley/code/tools/gastown/internal/cmd/mayor.go`
- CLI: `gt --help`, `gt escalate --help`, `gt feed --help`, `gt refinery --help`, `gt mq --help`, `gt done --help`
