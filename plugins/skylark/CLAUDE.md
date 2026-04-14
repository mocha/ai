# skylark-ai

Claude Code plugin encoding the Skylark development pipeline.

## Architecture

- `skills/implement/` — the single orchestrator entry point
- `skills/{triage,prepare,brainstorm,spec-review,write-plan,plan-review,develop,finish}/` — pipeline stages
- `skills/{panel-review,solo-review}/` — composable review primitives
- `skills/linear/` — Linear interaction conventions
- `skills/_shared/` — vocabulary routing methodology (expert generation, vocabulary guide, prompt template, artifact conventions, risk matrix)

## Conventions

- All skill-to-skill references use fully-qualified names: `/skylark:<skill-name>`
- Superpowers is installed alongside — use `/skylark:` prefix to avoid routing collisions
- Skills follow the superpowers plugin format: `skills/<name>/SKILL.md` with YAML frontmatter
- Shared methodology lives in `skills/_shared/` and is read by skills that generate expert prompts

## Modifying skills

- Do not add external dependencies
- Every skill must be self-contained or reference `_shared/` methodology explicitly
- Test changes against a real issue at each risk level (trivial, standard, elevated, critical) before shipping
