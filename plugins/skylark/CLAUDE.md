# skylark-ai

Claude Code plugin encoding the Skylark development pipeline.

## Architecture

- `skills/implement/` — the single orchestrator entry point
- `skills/{triage,prepare,brainstorm,spec-review,write-plan,plan-review,develop,finish}/` — pipeline stages
- `skills/{panel-review,solo-review}/` — composable review primitives
- `skills/linear/` — Linear interaction conventions
- `skills/_shared/` — shared methodology: vocabulary routing (expert generation, vocabulary guide, prompt template), artifact conventions, risk matrix, and communication style

## Conventions

- All skill-to-skill references use fully-qualified names: `/skylark:<skill-name>`
- Superpowers is installed alongside — use `/skylark:` prefix to avoid routing collisions
- Skills follow the superpowers plugin format: `skills/<name>/SKILL.md` with YAML frontmatter
- Shared methodology lives in `skills/_shared/` and is read by skills that generate expert prompts

## Communication Style

All skylark output follows `_shared/communication-style.md`: plain language, concise, actionable items only, autonomous fixes for small low-risk issues. This file is inlined into every generated expert prompt (between Identity and Vocabulary) and referenced from every main-session skill.

## User Mods

Users can customize skylark's communication and judgment via **`.claude/skylark-prompt-mods.md`** at the project root (optional, freeform markdown). If present, its contents are loaded once by `/skylark:implement` at pipeline start and appended as a "User Preferences" section to every generated expert prompt. See `skills/implement/SKILL.md` and `skills/_shared/expert-prompt-generator.md` Step 6 for the injection contract.

User mods layer on top of skylark defaults for style and judgment. They cannot override safety gates (critical-risk reviews, verification-before-completion, spec-compliance checks, escalation paths).

## Modifying skills

- Do not add external dependencies
- Every skill must be self-contained or reference `_shared/` methodology explicitly
- Test changes against a real issue at each risk level (trivial, standard, elevated, critical) before shipping
