# reflect

A **reimagination** of the built-in Claude Code `/insights` skill.

The built-in `/insights` command produces a rich, eight-section report
analyzing your Claude Code sessions — but it operates over your entire
session history and ignores date-range hints you pass to it. `reflect`
keeps the style, structure, and data model of `/insights` but lets you
scope the report to any window you care about: the last 24 hours, a
specific day, a sprint, a weekend of autonomous runs.

## Why a reimagination, not a patch

`/insights` is a built-in command — shipped as compiled TypeScript inside
Claude Code itself. Its filtering logic, section prompts, and HTML rendering
aren't directly editable. `reflect` is a clean-room reimplementation of the
relevant pieces as a **hackable skill**, so you (or anyone installing this
plugin) can:

- Change the section prompts to match your own report style
- Add new sections (e.g. "blockers still open", "experiments to try")
- Scope to any date range the aggregator understands
- Extend the aggregation logic (e.g. subagent commit rollup, multi-clauding
  detection, custom friction categories)
- Render to formats other than markdown

It is **data-compatible** with the built-in: the aggregator reads directly
from `~/.claude/usage-data/session-meta/` and `~/.claude/usage-data/facets/`,
the same caches `/insights` populates. Whenever you run the built-in
`/insights`, `reflect` automatically benefits from the fresh facet data.

## Skills

| Skill | What it does |
|---|---|
| `/reflect:self-reflection` | Generate a date-scoped insights report (same eight sections as built-in /insights) |

## Usage

```bash
# Last 24 hours
/reflect:self-reflection 24h

# A specific window
/reflect:self-reflection 2026-04-10..2026-04-14

# Yesterday only
/reflect:self-reflection --since 48h --until 24h

# Default (last 30 days)
/reflect:self-reflection
```

The skill parses the window, runs the bundled Python aggregator, sanity-checks
coverage (empty window, missing facets), and produces the eight-section
narrative in the style of built-in `/insights`: project areas, interaction
style, what's working, friction analysis, suggestions, on the horizon, fun
ending, and at-a-glance.

For installation, see the [marketplace README](../../README.md).

## What's bundled

```
reflect/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── self-reflection/
        ├── SKILL.md                # Workflow and section prompts
        └── scripts/
            └── aggregate.py        # Python port of the built-in aggregator
```

### `aggregate.py`

A Python port of the built-in `aggregateData()` function. Reads cached
`SessionMeta` and `SessionFacets` JSON files, filters by date range,
deduplicates session branches, drops warmup-minimal sessions, and emits a
single `AggregatedData` JSON object to stdout. Runs in under a second even
on full-history scans.

```bash
python3 scripts/aggregate.py --since 24h
python3 scripts/aggregate.py --since 2026-04-01 --until 2026-04-14
python3 scripts/aggregate.py --since 7d --include-minimal --raw-sessions
```

## Compared to built-in `/insights`

|  | Built-in `/insights` | `reflect` |
|---|---|---|
| Date-range filtering | No | Yes |
| Facet extraction (new sessions) | Yes | No (reads cache only) |
| HTML rendering | Yes | No (markdown only in v0.1) |
| Multi-clauding detection | Yes | Stubbed |
| Editable prompts / sections | No | Yes |
| Data source | `~/.claude/projects/**/*.jsonl` | `~/.claude/usage-data/{session-meta,facets}/` |

For the full-history, facet-refreshing, HTML-rendering experience, keep using
built-in `/insights`. Use `reflect` when you want a scoped window, a
customized report, or a place to experiment with new sections.

## Roadmap

- `scripts/render.py` — HTML rendering to match the built-in's visual report
- Subagent commit rollup (parent sessions that dispatch agents currently
  don't credit subagent commits against the window's totals)
- Multi-clauding detection port
- `--extract-missing` flag to optionally fill facet-cache gaps

## License

MIT
