# Triad — Review and Gate Model Conformance Evaluation

## Summary

- Conformance at a glance: 6 MEETS, 4 PARTIAL, 3 MISSING, 0 N/A (out of 13)
- Headline: Triad has a disciplined human-in-the-loop gate model at each agent boundary with typed dispositions and a hard 2-cycle cap, but has no multi-reviewer panels, no shared gate primitive, no plan-vs-reality drift gate, and no mechanism for converting recurring findings into automation.

## Per-Requirement Findings

### Req 1: Stage gates are explicit. Stage completion does not imply stage-passed. Every stage has a gate artifact (verdict + evidence) separate from the work artifact.

- Verdict: MEETS
- Evidence: The protocol spec defines distinct handoff messages separate from the canonical artifact at every boundary. `docs/specs/2026-03-23-agent-triad-protocol-design.md` §5.1–§5.2 locates gate messages at `docs/inbox/<agent>/unread/` and §6.1 rule 3 states: "The canonical document is the single source of truth — messages reference it, they don't duplicate it". §6.2–§6.3 show each boundary emits a named review message (`proposal-review`, `feedback`, `project-plan`, `tasks-proposed`, `tasks-revised`, `project-ready`, `project-complete`, `project-validated`). Messages are archived to `inbox/read/` (§5.5: "Message archives (`docs/inbox/*/read/`) — committed as decision record").
- Notes: Gate artifact = inbox message; work artifact = proposal/project/task file. Separation is strict.

### Req 2: Typed verdicts. Gates emit one of `approve`, `revise`, `reject`, `escalate`. No ambiguous "looks good" prose-only outcomes.

- Verdict: PARTIAL
- Evidence: §5.3 defines a typed `disposition` field with values "`approved` | `revise` | `escalate` | `info` | `directive`". Frontmatter in `templates/message.md` enforces it: "disposition:     # pending | acknowledged | resolved | expired" (template is out of sync with the spec's canonical values). Spec has no `reject` verdict — rejection is expressed as `escalate` (§6.2 "disposition: escalate  → human intervenes (max cycles reached)"). Messages also carry a one-paragraph prose Summary/Detail alongside the typed field.
- Notes: Gap — no `reject` verdict (the spec collapses reject into escalate). Template file disposition vocabulary (`pending | acknowledged | resolved | expired`) contradicts the protocol spec's vocabulary.

### Req 3: Multi-reviewer panels for high-risk stages. Elevated+ risk stages support parallel independent review by multiple domain experts, followed by synthesis.

- Verdict: MISSING
- Evidence: No occurrences of "panel" anywhere in the source tree (grep on `/docs/research/triad-source/` returned "No matches found"). Every gate is reviewed by exactly one counterpart role: PM reviews PgM plans; PgM reviews EM tasks; EM reviews worker PRs. §6.1 rule 4: "Negotiations are sequential — one active negotiation per document at a time."
- Notes: No parallel multi-expert review is described anywhere in the protocol.

### Req 4: Panel reviewers generated per-domain at dispatch time. Reviewers are not a fixed roster — they are generated or selected based on the stage's domain, matching the Worker Model requirement for per-task prompt generation.

- Verdict: MISSING
- Evidence: Reviewer roster is fixed by role. §3.1 table of roles hard-codes PM/PgM/EM/Dev. The EM's worker dispatch template explicitly rejects per-task prompt variation: `agents/engineering-manager/.claude/worker-dispatch-template.md` line 41: "If all three are good, TASK_SPECIFIC_NOTES should be empty." EM CLAUDE.md §"Worker Dispatch" item 5: "No custom per-task prompts. The task file IS the contract."
- Notes: Reviewers are role-identity agents, not generated-per-domain experts.

### Req 5: Bounded revision loops. Max N rounds (default 2) before escalation to human or higher-tier review. Loops do not run unbounded.

- Verdict: MEETS
- Evidence: §6.1 rule 1: "**Max 2 revision cycles** at each boundary before escalation to human. A revision cycle is: reviewer sends `revise` → author revises → reviewer evaluates revision. The initial submission and first review are not a revision cycle." Enforced independently in PM↔PgM (§6.2), PgM↔EM (§6.3), and restated in each agent's rules (e.g., `agents/program-manager/CLAUDE.md` §Negotiation Discipline: "You get a maximum of 2 revision cycles at each boundary before escalation to human... If you and the PM cannot agree after 2 cycles, escalate to human with both positions clearly stated. Do not keep iterating.").
- Notes: This is Triad's most distinctive and thoroughly specified feature. The `round` field on every message (§5.2) is the accounting mechanism.

### Req 6: Gate criteria defined in the spec. Each stage's gate references a checklist or criteria document — reviewers do not invent criteria on the fly.

- Verdict: PARTIAL
- Evidence: Every artifact template carries a typed `acceptance_criteria` field that serves as the gate checklist (proposal `success_criteria`, project `acceptance_criteria`, task `acceptance_criteria`). EM validate-project skill (`agents/engineering-manager/.claude/skills/validate-project/SKILL.md`) hardcodes the criteria source: step 4 "Read the project file's acceptance criteria" and step 5 "Run each project-level criterion." PgM review-tasks (CLAUDE.md §How to Review Tasks item 1): "Check each task's acceptance criteria against the project-level criteria. Are all project criteria covered by at least one task?" PM review-project-plan: evaluation criteria listed (Coverage/Sequencing/Alignment/Deviations).
- Notes: Artifact-embedded criteria are specified, but the broader *review criteria* (what the reviewer evaluates beyond the artifact's own criteria) are left to each agent's philosophy docs and judgment. No central "gate criteria checklist" document exists separate from the artifact.

### Req 7: Recurring findings become automation. Any pattern that surfaces across >2 reviews is converted to a lint rule, CI check, or pre-dispatch validator. The review layer does not keep rediscovering the same class of bug.

- Verdict: MISSING
- Evidence: No automation hook for recurring findings is described. §2 Design Thesis mentions observation of friction: "The negotiation records become the observability layer. Friction patterns in the message archive reveal where agent prompts need tuning." §8 Future Work item 3: "**Observability and tuning** — how to systematically analyze the message archive for friction patterns, and how those patterns translate into agent prompt changes." The translation target is *prompt changes*, not lint rules or CI checks. No lint/CI/validator generation is described.
- Notes: Recurring-finding detection is explicitly deferred to Future Work and targets prompt tuning, not automation artifacts.

### Req 8: Evidenced approvals. Approval records include reviewer identity, timestamp, criteria reference, and findings. Stored in the artifact substrate, not ephemeral chat.

- Verdict: MEETS
- Evidence: Message frontmatter (§5.2) requires: `from`, `to`, `disposition`, `references`, `timestamp`, `round`, plus Summary and Detail body. §5.5: "Message archives (`docs/inbox/*/read/`) — committed as decision record... the full decision trail is committed alongside the work itself. Messages can be directly referenced from project and task documents." Filename format `<YYMMDDHHMMSS>-<object-id>-<step>.md` preserves timestamp and object linkage. PgM commit convention: `agents/program-manager/CLAUDE.md` §Commit Conventions: "`feedback: <approved|revise> tasks for PRJ-NNN (round N)`".
- Notes: All four attributes are present and git-committed.

### Req 9: Severity-routed escalation. Escalation from a failed gate routes by severity and target audience — peer review, senior reviewer, human operator, external approver.

- Verdict: MEETS
- Evidence: §6.6: "**Escalation chain:** Dev → EM → PgM → PM → Human. Each level attempts to resolve before passing up. An agent may skip levels if the question is clearly outside the next level's domain." Severity taxonomy in §5.2/§6.6: "Urgency: `blocking` (work stopped) or `non-blocking` (work continues on other items)" and "Reason: `need-clarity` (content problem) or `process-concern` (systemic problem)". §6.7 Stop the Line distinguishes `process-concern` from `need-clarity`: "These are the signals to watch when tuning agent prompts."
- Notes: Two orthogonal severity axes (urgency, reason) plus a defined up-chain routing path.

### Req 10: Lightweight and heavyweight variants. Trivial risk gets a single-reviewer conformance check; elevated/critical gets a full panel. Gate shape is a function of risk level.

- Verdict: PARTIAL
- Evidence: No risk-level → gate-shape mapping. The EM's task-completion review has a weight-varying policy based on pattern novelty rather than risk level: `agents/engineering-manager/CLAUDE.md` §Task Completion Validation Step 2: "**First instance of a new pattern** (first schema, first route, first middleware, first test pattern): Dispatch spec compliance review / Dispatch code quality review / Fix any issues found, re-review until clean. **Repetition of an established pattern:** Dispatch spec compliance review / Spot-check implementation." Ad hoc tasks bypass gating (§6.4: "Ad hoc tasks... No approval gate — ad hoc tasks enter the queue immediately / PgM acknowledges but no negotiation round is consumed").
- Notes: Some gate-shape variation exists (novel vs repeat pattern; ad hoc vs planned), but it is not tied to a risk-level concept, and no heavy-variant panel review exists at all.

### Req 11: Plan-vs-reality validation. Before any implementation worker is dispatched, a gate checks the plan's signatures/paths/assumptions against current code and blocks on drift.

- Verdict: MISSING
- Evidence: No pre-dispatch gate against current code is specified. EM dispatches after PgM task approval with no drift check: `agents/engineering-manager/CLAUDE.md` §"Dispatch immediately after task approval": "When the PgM approves tasks (disposition: approved), begin dispatching workers for tasks with no unresolved dependencies. Do not ask the human for confirmation — approved means go." The EM reads source during task decomposition (CLAUDE.md §Task decomposition item 3: "Read architecture references and relevant source code to evaluate feasibility") but there is no gate between approval and dispatch that re-verifies plan signatures/paths against current code.
- Notes: Drift is caught only post-hoc in completion validation, not pre-dispatch.

### Req 12: Human override. A human operator can always override a gate — approve a rejected artifact, or reject an approved one — with an auditable record of the override.

- Verdict: MEETS
- Evidence: §7.4 defines the `directive` message type: "**Directive handling:** A `directive` is the only message type that can arrive unprompted (not in response to a prior message)... If the directive conflicts with existing approved documents, the agent escalates back to the human rather than silently overriding the approved plan. Directives do not consume negotiation rounds. They are outside the normal protocol flow — they represent the human exercising direct authority over the system." Audit trail is provided by §5.5 (directives land as messages in inbox archives, committed to git). §6.7: "The human can respond by: Dropping a `*-feedback` message in the stalled agent's inbox with guidance / Going directly to the other agent involved and mediating / Adjusting the protocol or agent prompts based on what the escalation reveals."
- Notes: Override is via directive + mandatory `info` acknowledgment (§7.4 step 4: "Send an `info` acknowledgment back to `docs/inbox/human/` confirming receipt and any impacts"), both git-committed.

### Req 13: Gates are composable primitives. Specific stages (spec review, plan review, implementation review) compose a shared gate primitive rather than each re-implementing review logic.

- Verdict: PARTIAL
- Evidence: A partial shared primitive exists: message format (§5.2), disposition vocabulary (§5.3), 2-cycle cap (§6.1), and escalation rules (§6.6) are shared across all boundaries. However, each boundary is hand-specified as prose: §6.2 PM↔PgM, §6.3 PgM↔EM, §6.4 EM↔Dev ("No negotiation at this boundary — dispatch and validation only"), §6.5 Completion Validation ("is not a negotiation"). Each agent re-implements review logic in CLAUDE.md ("How to Review Tasks" in PgM, "Task Completion Validation" in EM, "Project Plan Review Judgment" in PM) rather than composing a single review skill. Skills are per-agent and per-artifact-type: `review-tasks` (PgM), `review-project-plan` (PM), `validate-project` (EM), `validate-proposal` (PM) — four parallel skills, not one primitive.
- Notes: Primitives (message schema, disposition, round cap) are shared; the gate *process* is re-authored per boundary.

## Surprises

- **EM↔Dev explicitly has no negotiation.** §6.4: "No negotiation at this boundary — dispatch and validation only." Worker rejections produce dev re-work in-place rather than bounded cycles. The 2-round cap only applies at the two upper boundaries.
- **Ad hoc tasks bypass all gating by design.** §6.4: "No approval gate — ad hoc tasks enter the queue immediately." The PgM is merely informed.
- **Completion validation is defined as "not a negotiation."** §6.5: "Completion validation is not a negotiation — it is a pass/fail check against defined criteria... There is no bounded revision cycle here; instead, the corrective work flows through the normal task execution pipeline." This is a deliberate asymmetry — upstream gates are bounded negotiations, downstream validation is unbounded pass/fail with new-task spawning.
- **Stop-the-line has two modes — active escalation with `process-concern`, and passive silence.** §6.7: "Any agent, at any time, can halt processing by: 1. **Not responding** to a message — the downstream chain stalls passively 2. **Sending an escalation to `docs/inbox/human/`** with `reason: process-concern`."
- **Template/spec drift.** `templates/message.md` frontmatter lists `disposition: pending | acknowledged | resolved | expired` while the protocol spec §5.3 defines `approved | revise | escalate | info | directive`. The template is stale.
- **Retired status acknowledges gate-observability failure.** `README.md`: "**Inbox watchers were noisy**... message flurries during handoffs could overwhelm a pane. **State drift between agents**... recovery after a crash (`/triad:kick`) required careful state reconstruction." The gate substrate (filesystem messages) is cited as a primary reason for retirement.

## Open Questions for Trial

- How does a reviewer write concrete "revise" detail without a shared gate-criteria document — what happens when PM and PgM interpret "success criteria coverage" differently across rounds?
- Does the 2-cycle cap in practice converge, or does it systematically produce escalations to human (given the PgM's "Escalation Default" instruction: "When below 60% confidence after context gathering, escalate")?
- Can a single-reviewer gate catch the cross-domain concerns a panel would catch (security + perf + correctness)? Retrospective evidence in the retired README suggests the gate caught coordination bugs but not necessarily domain-specific defect classes.
- What happens when ad-hoc tasks accumulate — is there a feedback loop that promotes recurring ad-hoc work back into a PgM project-plan revision?

## Source Index

- `docs/research/triad-source/README.md`
- `docs/research/triad-source/docs/specs/2026-03-23-agent-triad-protocol-design.md` (§§1–8, Appendix A)
- `docs/research/triad-source/agents/product-manager/CLAUDE.md`
- `docs/research/triad-source/agents/program-manager/CLAUDE.md`
- `docs/research/triad-source/agents/engineering-manager/CLAUDE.md`
- `docs/research/triad-source/agents/engineering-manager/.claude/worker-dispatch-template.md`
- `docs/research/triad-source/agents/engineering-manager/.claude/skills/validate-project/SKILL.md`
- `docs/research/triad-source/templates/proposal.md`
- `docs/research/triad-source/templates/project.md`
- `docs/research/triad-source/templates/task.md`
- `docs/research/triad-source/templates/message.md`
- Grep searches across `triad-source/` for `panel`, `lint`, `recurring`, `automat`, `criteria`, `override`, `audit` (case-insensitive).
