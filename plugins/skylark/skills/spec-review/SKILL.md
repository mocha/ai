---
name: spec-review
description: Internal pipeline stage that runs iterative panel review on a spec document. Dispatches a panel via /skylark:panel-review, applies fixes on revise verdicts, and re-reviews (max 2 rounds). Escalates to user if still not approved after round 2. Called by implement — not user-invocable.
---

# Spec Review

Iterative panel review loop for specs. Review → fix → re-review until approval or max 2 rounds.

## When Called

Called by `/skylark:implement` for elevated+ risk work after a spec exists (from brainstorm or provided by user).

## Communication Style

Follows `_shared/communication-style.md`. Present findings as actionable items — blocking issues first, minor nits omitted when the reviewer would fix them directly. Apply the autonomous-fix rule: small, low-risk issues encountered in the spec (typos, obvious contradictions, missing frontmatter fields) get fixed inline before or during review without asking the user.

## Checklist

Follow these steps in order. Do not skip steps.

### 1. Identify the Spec

Read the spec fully. Verify it has:
- Clear ACs (not vague)
- Defined scope boundaries
- No unresolved TODOs or placeholders

If the spec has obvious issues, fix them before spending tokens on a panel.

### 2: Determine Panel Configuration

Read `_shared/risk-matrix.md` for model, panel size, and rounds:

| Risk | Panel Size | Rounds | Model |
|------|-----------|--------|-------|
| elevated | 2 experts | 1 | Opus |
| critical | 5 experts (round 1), 2-3 (round 2) | 2 | Opus |

Select expert perspectives appropriate to the spec's domain. At elevated (2 experts), pick the two angles that will catch the most important issues — typically a domain specialist and an architect. Common patterns:
- Backend spec → Backend architect + Database engineer (add Security at critical)
- Frontend spec → Frontend architect + UX engineer (add Accessibility at critical)
- Cross-cutting → Systems architect + domain specialist for the primary domain

Pass the risk tier to `panel-review` so it selects the correct review directive (critical uses the mandatory-finding directive; elevated uses the softer focus-on-blocking directive per `_shared/prompt-template.md`).

### 3: Round 1 — Panel Review

Invoke `/skylark:panel-review` with:
- Target: the spec file path
- Panel size and model from Step 2
- Risk level context

Wait for the synthesized verdict.

### 4: Handle Round 1 Verdict

**Ship** → Spec approved.
- Update spec frontmatter: `status: approved`
- Append changelog entry to the spec:
  ```
  - **YYYY-MM-DD HH:MM** — [SPEC-REVIEW] Approved (round 1). Report: docs/reports/R-YYYYMMDD-synthesis.md.
  ```
- Return to implement — next stage is PLAN.

**Revise** → Fix.
- Present blocking + major issues to the user as a tight actionable list.
- **Minor issues:** fix directly without asking (autonomous-fix rule from `_shared/communication-style.md`). Typos, missing frontmatter fields, obvious wording fixes, stale cross-references — just fix them.
- **Blocking + major issues:** propose specific fixes. At **elevated**, get user sign-off on the approach for blocking issues only; apply fixes for major issues directly and mention them in one line. At **critical**, get user approval on all proposed fixes.
- Apply fixes to the spec.
- **Post-revision scope check:** If revisions revealed that the spec spans 3+ bounded contexts or multiple independent subsystems, decompose into sub-specs. Each sub-spec gets its own file and pipeline cycle.
- Update spec frontmatter: `updated: [today]`
- Append changelog entry:
  ```
  - **YYYY-MM-DD HH:MM** — [SPEC-REVIEW] Round 1: revise. Revised per findings.
  ```
- **At elevated:** revisions are the terminal state — do not run a second round. Mark approved and proceed to WRITE-PLAN.
- **At critical:** proceed to Round 2.
- Return decomposed sub-specs to implement for independent review if decomposition triggered.

**Rethink** → Stop.
- Present fundamental concerns to user
- Do NOT iterate — the spec needs significant rework
- Append changelog entry:
  ```
  - **YYYY-MM-DD HH:MM** — [SPEC-REVIEW] Rethink recommended. Report: docs/reports/R-YYYYMMDD-synthesis.md.
  ```
- Return to implement with `rethink` status — implement will stop and surface to user.

### 5: Round 2 — Re-Review (Critical Only)

Skip this step at elevated.

Invoke `/skylark:panel-review` again with:
- Target: the revised spec
- **Do NOT pass round 1 findings** to the panel — this prevents bias toward confirming fixes rather than finding new issues
- **Adaptive narrowing (critical only):** narrow to 2-3 experts who had the strongest findings in round 1

### 6: Handle Round 2 Verdict

**Ship** → Spec approved.
- Update spec frontmatter: `status: approved`
- Append changelog entry:
  ```
  - **YYYY-MM-DD HH:MM** — [SPEC-REVIEW] Approved (round 2). Report: docs/reports/R-YYYYMMDD-synthesis.md.
  ```
- Return to implement.

**Revise or Rethink** → Escalate.
- Maximum rounds reached. Do NOT run a third round.
- Present remaining issues to user with full context
- Append changelog entry:
  ```
  - **YYYY-MM-DD HH:MM** — [SPEC-REVIEW] Escalated after round 2. N blocking issues remain.
  ```
- Return to implement with `escalate` status — implement will stop and let the user decide.

## Output

Return to implement:
```
status: approved | rethink | escalate
rounds_completed: 1 | 2
spec_path: docs/specs/...
report_paths: [list of report paths]
outstanding_issues: [list, empty if approved]
```
