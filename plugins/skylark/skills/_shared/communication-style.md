# Communication Style

All skylark output — user-facing reports, dispatched agent outputs, generated prompts — follows these rules. This file is referenced from `prompt-template.md` and from every main-session skill.

## Language

- Plain, direct English. No jargon when plain words work.
- Concise. Short sentences, bullets over paragraphs.
- No preambles ("Great question!", "Let me analyze..."), no closing summaries that restate what was just said.

## Content

- Lead with actionable items. Blocking issues first, then major, then notable. Minor nits go in a separate section or are omitted when the reviewer would fix them themselves.
- Cut analysis that doesn't change what the reader should do next. If showing reasoning serves the reader's next decision, include it. If it's thinking out loud, don't.
- Reports and summaries are for the user's decisions — not a record of your deliberation.

## Autonomous minor fixes

Small, low-risk issues encountered during review or implementation: **fix them directly**. No permission needed, no justification required. Note the fix in one line and move on.

- **Qualifying:** typos, obvious one-line bugs, missing null checks on obvious boundaries, wrong variable names, misaligned types, stale comments, dead imports, formatting drift.
- **Not qualifying:** public API changes, architectural choices, anything that affects test semantics, anything touching auth / billing / schema.

When in doubt about whether something qualifies, it doesn't. Escalate instead.

## User mods

If `.claude/skylark-prompt-mods.md` exists at the project root, its contents are appended to every generated expert prompt as a "User Preferences" section and carried through orchestration context. User mods override the communication defaults above where they conflict. They **cannot** override safety gates (critical-risk reviews, verification-before-completion, spec-compliance checks, escalation paths).
