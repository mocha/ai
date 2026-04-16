# Skylark — Review and Gate Model Conformance Evaluation

## Summary

- Conformance at a glance: 8 MEETS, 3 PARTIAL, 2 MISSING, 0 N/A (out of 13)
- Headline: Skylark has strong explicit gate infrastructure with typed verdicts, bounded loops, and composable primitives, but lacks a plan-vs-reality validation gate and has no mechanism to convert recurring panel findings into automation.

## Per-Requirement Findings

### Req 1: Stage gates are explicit. Stage completion does not imply stage-passed. Every stage has a gate artifact (verdict + evidence) separate from the work artifact.

- Verdict: MEETS
- Evidence: Each review stage writes a synthesis report distinct from the work artifact. From `skills/panel-review/SKILL.md` step 6: "Save the synthesis report to `docs/reports/` following `_shared/artifact-conventions.md`." The artifact conventions (`skills/_shared/artifact-conventions.md` lines 14-18) define a dedicated `docs/reports/` directory with filename pattern `R-<YYYYMMDDHHMMSS>-panel-<expert-slug>.md`. Report frontmatter schema (lines 80-86) includes `round`, `verdict: ship | revise | rethink`, `target`, `expert`, and `model`. Work-artifact changelog entries reference the report path (e.g., spec-review line 56: `"[SPEC-REVIEW] Approved (round 1). Report: docs/reports/R-YYYYMMDD-synthesis.md."`).
- Notes: Separation between work artifact and gate artifact is formalized.

### Req 2: Typed verdicts. Gates emit one of `approve`, `revise`, `reject`, `escalate`. No ambiguous "looks good" prose-only outcomes.

- Verdict: MEETS
- Evidence: Skylark uses typed verdict vocabulary `Ship | Revise | Rethink` enforced at panel-review synthesis (`skills/panel-review/SKILL.md` lines 125-129): "**Consolidated Verdict** — Ship | Revise | Rethink — If any expert says 'Rethink,' that must be surfaced even if others say 'Ship'. If all say 'Ship' (possibly with nits), the consolidated verdict is 'Ship'. Otherwise 'Revise'". At the stage level, spec-review returns `status: approved | rethink | escalate` (line 111). Panel-review also enforces "You must identify at least one substantive issue or explicitly justify clearance with specific evidence. An empty Issues section is not acceptable" (lines 92-94).
- Notes: Verdict names differ from spec vocabulary (ship/revise/rethink vs approve/revise/reject/escalate), but mapping is clear: `ship`=approve, `revise`=revise, `rethink`≈reject, and `escalate` is emitted at the stage level after round 2.

### Req 3: Multi-reviewer panels for high-risk stages. Elevated+ risk stages support parallel independent review by multiple domain experts, followed by synthesis.

- Verdict: MEETS
- Evidence: `skills/_shared/risk-matrix.md` Gate Activation Matrix (lines 21-35): `SPEC-REVIEW` elevated = "Opus 3-4"; critical = "Opus 5→3 adaptive"; `DEVELOP panel` elevated = "Sonnet 3-4"; critical = "Opus 3-4, 2 rounds". `skills/panel-review/SKILL.md` step 4: "Call the Agent tool once per expert, **ALL IN THE SAME MESSAGE.** This is critical — Claude Code runs parallel Agent calls concurrently. Sequential dispatch defeats the purpose of a panel." Synthesis step 5 enumerates Consensus / Unique Findings / Disagreements / Blocking Issues / Consolidated Verdict.
- Notes: Parallel dispatch is mandated, synthesis is structured.

### Req 4: Panel reviewers generated per-domain at dispatch time. Reviewers are not a fixed roster — they are generated or selected based on the stage's domain, matching the Worker Model requirement for per-task prompt generation.

- Verdict: MEETS
- Evidence: `skills/panel-review/SKILL.md` "What This Skill Does NOT Do": "Pick from pre-built expert profiles — always generates bespoke experts". Step 3 requires each expert to be generated via `_shared/expert-prompt-generator.md`, `_shared/vocabulary-guide.md`, `_shared/prompt-template.md`, with "Distinct identity matching their perspective" and "Vocabulary clusters tuned to their specialization". `skills/plan-review/SKILL.md` step 4: "Panel composition tailored to the task's domain (a database task gets different experts than a CLI task)". `skills/spec-review/SKILL.md` step 2: "Select expert perspectives appropriate to the spec's domain".
- Notes: Per-domain generation is explicitly required at every review invocation.

### Req 5: Bounded revision loops. Max N rounds (default 2) before escalation to human or higher-tier review. Loops do not run unbounded.

- Verdict: MEETS
- Evidence: `skills/panel-review/SKILL.md` line 167: "Maximum 2 rounds. If blocking issues persist after round 2, escalate to the user rather than continuing to loop." `skills/spec-review/SKILL.md` step 6: "Revise or Rethink → Escalate. Maximum rounds reached. Do NOT run a third round." `skills/plan-review/SKILL.md` step 5: "max 2 rounds per task". `skills/develop/SKILL.md` step 9: "Revise (round 2) or Rethink → Escalate". `skills/develop/SKILL.md` Red Flags: "Iterate beyond 2 review rounds — escalates to user".
- Notes: The 2-round cap is enforced at every gate.

### Req 6: Gate criteria defined in the spec. Each stage's gate references a checklist or criteria document — reviewers do not invent criteria on the fly.

- Verdict: PARTIAL
- Evidence: Panel experts receive a structured output format (Strengths / Issues / Missing / Verdict) from `skills/solo-review/SKILL.md` lines 66-82 and `panel-review/SKILL.md`. `skills/develop/SKILL.md` step 8 lists explicit code-quality criteria: "Does each file have one clear responsibility with a well-defined interface? Are units decomposed so they can be understood and tested independently? Is the implementation following the file structure from the plan? Did this change create new files that are already large...". Spec-review step 1 lists: "Clear ACs (not vague), Defined scope boundaries, No unresolved TODOs or placeholders". However, there is no FAR/FACTS-style checklist referenced by reviewers, and criteria beyond the minimal list are left to the generated expert's domain vocabulary and anti-patterns (per-dispatch).
- Notes: Gates reference output format and minimal checklist items; the substantive review criteria are emergent from the generated expert rather than anchored to a shared checklist document.

### Req 7: Recurring findings become automation. Any pattern that surfaces across >2 reviews is converted to a lint rule, CI check, or pre-dispatch validator. The review layer does not keep rediscovering the same class of bug.

- Verdict: MISSING
- Evidence: Grep for `lint|CI check|automate|recurring` across `skills/` returned no matches. The ENG-180 retrospective (`docs/research/2026-04-15-eng-180-retrospective.md` line 123) explicitly identifies this as a missing practice: "**Convert recurring panel complaints into lint rules or CI gates.** 'Missing `return` after `reply.send`' is lintable... Each panel discovery that repeats across tasks is a signal to automate it." The retrospective (lines 92-95) documents that "The **same taxonomy repeated across waves**. Atomicity, trust boundaries, fail-closed, test-only-surface isolation... Per-task panels largely rediscovered the categories the spec panel had named". No Skylark skill defines a mechanism to harvest recurring findings or convert them to automation.
- Notes: Acknowledged gap in the retrospective; not implemented in the skill set.

### Req 8: Evidenced approvals. Approval records include reviewer identity, timestamp, criteria reference, and findings. Stored in the artifact substrate, not ephemeral chat.

- Verdict: MEETS
- Evidence: Report frontmatter (`skills/_shared/artifact-conventions.md` lines 80-86) includes `round`, `verdict`, `target`, `expert`, `model`. In-file changelog format (lines 122-127): "**YYYY-MM-DD HH:MM** — [STAGE] Description. See `docs/reports/R-YYYYMMDD-panel-synthesis.md`." Panel-review step 6 appends: "**YYYY-MM-DD HH:MM** — [PANEL-REVIEW] Round N: [verdict]. Panel: [expert roles]. Blocking: [count]. Report: docs/reports/R-YYYYMMDD-synthesis.md." Reports are stored at absolute paths in `docs/reports/`, not in chat.
- Notes: Timestamp, reviewer identity (expert role), target reference, and findings report path are all captured.

### Req 9: Severity-routed escalation. Escalation from a failed gate routes by severity and target audience — peer review, senior reviewer, human operator, external approver.

- Verdict: PARTIAL
- Evidence: Skylark has a single escalation destination — the user. From `skills/spec-review/SKILL.md` step 6: "Return to implement with `escalate` status — implement will stop and let the user decide." `skills/_shared/risk-matrix.md` has a Scope Escalation table (lines 52-59) with user-gated handoffs. Severity is classified (blocking/major/minor in the output format at `solo-review/SKILL.md` line 72) and panel-review step 5 consolidates "Blocking Issues — all severity:blocking issues". Model/tier routing by risk level exists (Sonnet for standard, Opus for elevated/critical in `_shared/risk-matrix.md`). There is no peer-vs-senior-vs-external-approver distinction — escalation paths are: panel round 2 fails → user; subagent BLOCKED → user; scope escalation → user.
- Notes: Severity is captured; routing destinations are uniformly "the user" rather than differentiated by audience.

### Req 10: Lightweight and heavyweight variants. Trivial risk gets a single-reviewer conformance check; elevated/critical gets a full panel. Gate shape is a function of risk level.

- Verdict: MEETS
- Evidence: `skills/_shared/risk-matrix.md` gate activation matrix directly encodes this. Trivial risk: `SPEC-REVIEW skip`, `DEVELOP panel no`. Standard: `DEVELOP panel Sonnet 2-3`. Elevated: `SPEC-REVIEW Opus 3-4`, `DEVELOP panel Sonnet 3-4`. Critical: `SPEC-REVIEW Opus 5→3 adaptive`, `DEVELOP panel Opus 3-4, 2 rounds`. `skills/develop/SKILL.md` step 7 also mandates a solo "spec compliance review" before the panel, which functions as a lightweight conformance pre-check at every risk level above trivial. Solo-review exists as a primitive for lightweight use.
- Notes: Gate shape scales continuously by risk level via the matrix.

### Req 11: Plan-vs-reality validation. Before any implementation worker is dispatched, a gate checks the plan's signatures/paths/assumptions against current code and blocks on drift.

- Verdict: MISSING
- Evidence: No such gate exists in `skills/develop/SKILL.md`, `skills/plan-review/SKILL.md`, or `skills/implement/SKILL.md`. `skills/develop/SKILL.md` step 1 ("Read the Task Spec") reads referenced files but does not validate plan signatures against current code. The ENG-180 retrospective (lines 55-64) documents this failure: "The plan said `buildServer({ verifyToken })`; the real API was `buildServer({ auth: { verifyToken } })`... The T15 dispatch prompt described a `/whoami` update; the plan's Task 15 was actually the EXPLAIN regression guard, which commit `1bc341d` had already landed. These are signals that the plan was not validated against current code before being handed to workers." The retrospective recommends (line 132): "**Pre-validate plan signatures against real code before dispatching.**" Grep for `plan-vs-reality|pre-validate|drift` returned no matches in `skills/`.
- Notes: Explicitly documented as a pipeline failure in the ENG-180 retro; no corresponding gate added.

### Req 12: Human override. A human operator can always override a gate — approve a rejected artifact, or reject an approved one — with an auditable record of the override.

- Verdict: PARTIAL
- Evidence: User interaction is pervasive — `skills/implement/SKILL.md` has "Hard gate: cannot proceed without user approval of the spec" (line 65), `skills/_shared/risk-matrix.md` line 35: "User confirm gates ... critical: every gate". Escalation always routes to user with "User decides" (`skills/implement/SKILL.md` lines 72, 152, 166-167). `skills/spec-review/SKILL.md` step 4 on "Revise" requires "Get user approval on proposed fixes". Changelog discipline (`skills/_shared/artifact-conventions.md` lines 140-146) would capture any override as an append-only event. However, there is no explicit override-approve-a-rejected-artifact procedure; the mechanism is implicit (user instructs the agent) rather than a named gate primitive with a prescribed override-record format.
- Notes: Override is possible via user instruction and would be audit-trailed via changelog, but no dedicated override primitive or event tag (e.g., `[OVERRIDE]`) is defined.

### Req 13: Gates are composable primitives. Specific stages (spec review, plan review, implementation review) compose a shared gate primitive rather than each re-implementing review logic.

- Verdict: MEETS
- Evidence: `skills/panel-review/SKILL.md` opening: "This is a **building block** — it does one thing (multi-expert review) and is composed by other skills. It does NOT modify documents or iterate. Callers handle iteration." Description: "Building block composed by spec-review, plan-review, and develop stages." `skills/spec-review/SKILL.md` step 3: "Invoke `/skylark:panel-review` with: Target: the spec file path". `skills/plan-review/SKILL.md` step 4: "For each task spec, invoke `/skylark:panel-review`". `skills/develop/SKILL.md` step 8: "Only after spec compliance passes. Invoke `/skylark:panel-review`". Solo-review is a second primitive for lightweight use. `CLAUDE.md` confirms: "`skills/{panel-review,solo-review}/` — composable review primitives".
- Notes: Clear separation between primitive (panel-review/solo-review) and composing stages (spec-review/plan-review/develop).

## Surprises

- **Dual-gate develop stage.** `skills/develop/SKILL.md` runs spec compliance review (solo, cheap, trust-but-verify the implementer's report) BEFORE the code-quality panel. Step 7's "CRITICAL: Do Not Trust the Report" explicitly mandates verifying by reading code, not by trusting the subagent's claims. This two-stage shape (compliance → quality) is stronger than a single panel.
- **Adaptive panel narrowing for round 2.** `skills/_shared/risk-matrix.md` lines 43-47 and `skills/spec-review/SKILL.md` step 5 specify narrowing from 5 experts in round 1 to 2-3 in round 2 "who had the strongest findings". Round 2 is also instructed NOT to receive round-1 findings: "Do NOT pass round 1 findings to the panel — this prevents bias toward confirming fixes rather than finding new issues".
- **Anti-rubber-stamp directive baked into every expert.** Both `solo-review` and `panel-review` inject: "You must identify at least one substantive issue or explicitly justify clearance with specific evidence. An empty Issues section is not acceptable."
- **"One rethink vetoes."** Panel synthesis has asymmetric consolidation rules: any single "Rethink" surfaces even if others say "Ship". This biases toward caution.
- **Panel-review does not iterate itself.** The primitive explicitly refuses to run round 2 automatically; callers (spec-review, plan-review, develop) own the iteration loop. This keeps the primitive pure.

## Open Questions for Trial

- Does the "don't pass round 1 findings" rule actually produce independent round-2 review, or do experts rediscover the same issues regardless?
- How does the user experience "escalate" after round 2 — is there enough context carried forward to decide, or does the user have to reconstruct the issue from reports?
- When two experts disagree, the synthesis surfaces the disagreement "without resolving artificially" — how does the calling stage (spec-review, develop) decide to proceed? The caller stages' verdict-handling only enumerates Ship/Revise/Rethink outcomes.
- Does the spec-compliance solo review in `develop` actually catch issues the implementer's self-review missed, or is it redundant in practice?
- Without a plan-vs-reality gate, how often does an implementer dispatched with an outdated plan produce wasted work (the T15 pattern from ENG-180)?

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/04-review-and-gate-model.md` — criteria spec
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md` — method and format
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/panel-review/SKILL.md` — review primitive
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/solo-review/SKILL.md` — review primitive
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/spec-review/SKILL.md` — stage gate
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/plan-review/SKILL.md` — stage gate
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/develop/SKILL.md` — execution stage with embedded reviews
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/implement/SKILL.md` — orchestrator
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/risk-matrix.md` — gate activation matrix
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/artifact-conventions.md` — report schema and changelog format
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/linear/SKILL.md` — external event-comment conventions
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/2026-04-15-eng-180-retrospective.md` — real-run gate behavior
- `/Users/deuley/code/mocha/ai/plugins/skylark/CLAUDE.md` — conventions confirming composability
- Grep across `skills/` for `lint|CI check|automate|recurring` (no matches) and `plan-vs-reality|pre-validate|drift` (no matches)
