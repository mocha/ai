---
id: SPEC-001
title: Skylark calibration for Opus 4.7 — reduce over-review, tighten output, allow user mods
type: spec
status: approved
external_ref: ""
parent: null
created: 2026-04-16
updated: 2026-04-16
---

## Context

Opus 4.7 is ~11% more performant on SWE-bench than 4.6 and noticeably more verbose. Expert panel reviews now surface many findings the implementer would have caught in-process, so review gates have shifted from catching real defects to generating nits about over-specified pseudocode. Plans contain roughly as much pseudocode as the eventual implementation.

Three problems follow:

1. **Over-gated review.** `elevated` risk runs Opus panels of 3-4 experts across spec-review and plan-review, up to 2 rounds each — too much reviewer load for work the implementer would handle correctly.
2. **Over-specified plans.** `write-plan` targets ~2,000 tokens per task including code-level detail; that's the material reviewers then nit on.
3. **Verbose output.** Every stage emits analysis, preamble, and closing summary. Users want actionable items, not thinking-out-loud.

And one missing capability:

4. **No on-the-fly customization.** Users have no way to shape skylark's communication style per project without editing plugin source.

## Solution

Recalibrate risk gates, slim task specs, tighten output style, and add a user mod-injection file.

## Detailed Design

### 1. Risk gate recalibration

Update `_shared/risk-matrix.md` gate activation matrix:

| Stage | Trivial | Standard | Elevated | Critical |
|---|---|---|---|---|
| PREPARE | skip | yes | yes | yes |
| BRAINSTORM | skip | skip | if no spec | if no spec |
| SPEC-REVIEW | skip | skip | **Opus 2, 1 round** | Opus 5→3 adaptive, 2 rounds |
| WRITE-PLAN | skip | skip | yes | yes |
| PLAN-REVIEW | skip | skip | **Opus 2, 1 round per task** | Opus 3→2 adaptive, 2 rounds |
| DEVELOP worktree | no | yes | yes | yes |
| DEVELOP vocab expert | no | yes | yes | yes |
| DEVELOP panel | no | **Sonnet 2, 1 round** | **Sonnet 2-3, 1 round** | Opus 3, 2 rounds |
| FINISH session notes | skip | yes | yes | yes |
| FINISH arch docs | skip | if needed | yes | mandatory |
| User confirm gates | no | no | on escalation | every gate |

### 2. Risk threshold changes

Update the classification table in `_shared/risk-matrix.md`:

| Signal | Risk Level |
|--------|-----------|
| Single file, clear fix, no architectural impact | **trivial** |
| Few files, one bounded context, clear ACs, including single-context schema migrations and self-contained auth/billing tweaks | **standard** |
| Cross-context changes (3+ bounded contexts), or auth/billing/schema changes that touch multiple consumers | **elevated** |
| Architectural change, new integration, breaking change, load-bearing system | **critical** |

Net effect: most work that landed in `elevated` now lands in `standard` (no spec-review, no plan-review, Sonnet code-only review).

### 3. Task spec slimming

Update `skills/write-plan/SKILL.md`:

- Target per task: **~800-1,000 tokens** (down from ~2,000).
- Task spec contains: Scope (1-2 sentences), File list (exact paths), **Interface shape** (signatures, types, config keys — no function bodies), Acceptance criteria, Edge cases.
- Include code only when it disambiguates a non-obvious contract. Default to prose.
- Pseudocode, full SQL statements, JSON payload examples are **dropped by default** — implementer writes the implementation.

Update `skills/plan-review/SKILL.md` size guardrails accordingly (target ~800-1,000 tokens, hard cap stays at 40,000 total dispatch).

### 4. Soften "must find" review mandate

Update `_shared/prompt-template.md` mandatory review directive and `skills/panel-review/SKILL.md` panelist directive:

- **Critical risk:** keep current mandate — "You must identify at least one substantive issue or explicitly justify clearance with specific evidence."
- **Elevated and below:** replace with — "Focus on blocking issues. Minor issues may be noted or omitted. If the document is sound, say so."

Callers (spec-review, plan-review, develop) pass a risk tier hint into panel-review which selects the appropriate directive.

### 5. Communication style (new shared file)

Create `_shared/communication-style.md`:

```markdown
# Communication Style

All skylark output — user-facing reports, dispatched agent outputs, generated
prompts — follows these rules.

## Language
- Plain, direct English. No jargon when plain words work.
- Concise. Short sentences, bullets over paragraphs.
- No preambles ("Great question!", "Let me analyze..."), no closing summaries
  that restate what was just said.

## Content
- Lead with actionable items. Blocking issues first, then major, then notable.
  Minor nits go in a separate section or are omitted when the reviewer would
  fix them themselves.
- Cut analysis that doesn't change what the reader should do next. If showing
  reasoning serves the reader's next decision, include it. If it's thinking
  out loud, don't.

## Autonomous minor fixes
Small, low-risk issues encountered during review or implementation:
**fix them directly**. No permission needed, no justification required.
Note the fix in one line and move on.

- **Qualifying:** typos, obvious one-line bugs, missing null checks on
  obvious boundaries, wrong variable names, misaligned types, stale comments,
  dead imports.
- **Not qualifying:** public API changes, architectural choices, anything
  that affects test semantics, anything touching auth/billing/schema.
```

This file is referenced from:
- `_shared/prompt-template.md` — inserted as a "Communication Style" section between Identity and Vocabulary in every generated expert prompt.
- Main-session skill bodies (`implement`, `brainstorm`, `spec-review`, `plan-review`, `develop`, `finish`, `triage`, `prepare`) — referenced at the top of the skill behavior section.
- `skills/panel-review/SKILL.md` — referenced in the synthesis output section.

### 6. Prompt-mods injection

New convention: **`.claude/skylark-prompt-mods.md`** at the working directory root.

- Optional. Freeform markdown. Absent → no-op.
- Contents are appended as a "User Preferences" section at the end of:
  - Every generated expert prompt (via `_shared/expert-prompt-generator.md` assembly step)
  - Every main-session skill's behavior context (via an instruction at the top of `skills/implement/SKILL.md` that reads the file once and carries its contents through orchestration)
- **Precedence:** user mods override skylark defaults for communication style and judgment calls. They **cannot** override safety gates — critical-risk reviews, verification-before-completion, spec-compliance checks, escalation paths.
- Soft warning emitted if the file exceeds ~2,000 tokens (it multiplies across every dispatched agent).
- V1 is project-local only. `~/.claude/skylark-prompt-mods.md` (global) is out of scope for this spec.

### 7. Files touched

| File | Change |
|---|---|
| `_shared/risk-matrix.md` | New gate matrix, new threshold classifications |
| `_shared/prompt-template.md` | Risk-tiered review mandate; insert Communication Style slot between Identity and Vocabulary |
| `_shared/communication-style.md` | **NEW** — the rules above |
| `_shared/expert-prompt-generator.md` | Insert communication-style reference into Step 6 assembly; append prompt-mods if present |
| `skills/implement/SKILL.md` | Load `.claude/skylark-prompt-mods.md` at pipeline start; document convention in "When to Use" area |
| `skills/write-plan/SKILL.md` | Token target 800-1,000 per task; prose-over-pseudocode guidance |
| `skills/spec-review/SKILL.md` | Elevated caps at 1 round; drop "user approval on fixes" gate for minor findings |
| `skills/plan-review/SKILL.md` | Elevated caps at 1 round per task; 2-expert panels at elevated |
| `skills/develop/SKILL.md` | Reinforce autonomous-fix rule in implementer self-review loop |
| `skills/panel-review/SKILL.md` | Risk-tiered panelist directive; soften synthesis output style |
| `skills/triage/SKILL.md` | Apply new threshold language |
| `plugins/skylark/CLAUDE.md` | Document `.claude/skylark-prompt-mods.md` convention |

## Acceptance Criteria

- `elevated` risk runs SPEC-REVIEW and PLAN-REVIEW with 2-expert Opus panels, 1 round each.
- `standard` absorbs single-context schema/auth/billing work that previously triggered `elevated`.
- A generated expert prompt contains a Communication Style section between Identity and Vocabulary.
- A generated expert prompt under `critical` risk retains the "must find an issue" directive; `elevated` and below do not.
- Task specs emitted by `write-plan` target 800-1,000 tokens and contain interface shapes, not function bodies.
- If `.claude/skylark-prompt-mods.md` exists, its contents appear as a "User Preferences" section in every generated expert prompt.
- The autonomous-fix rule is referenced in the implementer dispatch prompt and in the communication-style file.

## Out of Scope

- Global `~/.claude/skylark-prompt-mods.md` (deferred to v2 if demand emerges).
- Any change to `critical` risk gates — those stay as-is as the safety net.
- Machine-readable structure for the mods file (remains freeform markdown).
- Test harness for skylark prompt changes (changes are validated by running real issues through each risk tier per CLAUDE.md).

## Open Questions

None. Design approved by user 2026-04-16.

## Changelog

- **2026-04-16** — [BRAINSTORM] Spec drafted and approved. Ready for implementation.
