---
name: self-reflection
description: >-
  Generates a date-scoped version of the Claude Code /insights report. Use when
  the user wants to reflect on a specific window of their work ("last 24 hours",
  "this week", "since yesterday") instead of the full month that built-in
  /insights covers. Mirrors the style and section structure of /insights: project
  areas, interaction style, what's working, friction analysis, suggestions, on
  the horizon, fun ending, at-a-glance.

  Reads from the existing Claude Code usage caches at ~/.claude/usage-data/
  (session-meta/ and facets/). Does NOT re-extract facets — if a session in the
  window has no cached facets, it contributes metrics only.
---

# Self-Reflection (Date-Scoped Insights)

A hackable fork of the built-in `/insights` command. Produces the same report
sections but bounded to a user-specified date range.

## When to run

- User asks for a report over a specific window: "last 24 hours", "this week",
  "since last Tuesday", "2026-04-10..today".
- User wants to iterate on the insights format, the section prompts, or the
  narrative style — this skill is editable, `/insights` isn't.

If the user wants the default full-history report, prefer built-in `/insights`.

## Inputs

Accept a date range in any of these forms (pass to `aggregate.py --since`):

- Relative: `24h`, `7d`, `2w`, `1m`
- ISO date: `2026-04-13`
- ISO datetime: `2026-04-13T18:00:00Z`
- Default: `30d`

Optional `--until` (default: `now`). For "yesterday", use `--since 48h --until 24h`.

## Workflow

1. **Parse the user's range** into concrete `--since` / `--until` args. When the
   user says "last night" or "the last 24 hours", default to `--since 24h`.

2. **Run the aggregator** from this skill's `scripts/` directory. The path is
   relative to the skill's base directory (shown at skill invocation):

   ```bash
   python3 <skill-base>/scripts/aggregate.py --since <SINCE> --until <UNTIL>
   ```

   Output is a single JSON object on stdout:
   ```
   {
     "aggregated": { ...AggregatedData, query: {since, until} },
     "facets": { "<session_id>": {...}, ... }
   }
   ```

   Pipe to `$TMPDIR/self-reflection.json` if it will be large; otherwise read
   directly. Do NOT write to `/tmp` — the sandbox blocks direct `/tmp` writes
   but allows `$TMPDIR`.

3. **Sanity-check coverage.** If `aggregated.total_sessions` is 0, tell the user
   their window was empty and suggest a wider one. If
   `sessions_with_facets < total_sessions`, mention that some sessions in the
   window were too new to have cached facets and will only contribute metrics
   (facet extraction is handled by the built-in command, not this skill).

4. **Generate the narrative.** For each section below, produce a JSON-shaped
   object matching the built-in `/insights` schema. Use second person, concrete
   evidence from `session_summaries`, `projects`, `tool_counts`, and facet
   aggregates. The tone should match `/insights` — analytical, specific, not
   flattering.

   Required sections:
   - `project_areas` — 4-5 areas, each with name, session_count, description
   - `interaction_style` — narrative (2-3 paragraphs), key_pattern (one line)
   - `what_works` — intro, 3 impressive_workflows (title + description)
   - `friction_analysis` — intro, 3 categories (category, description, 2 examples)
   - `suggestions` — claude_md_additions, features_to_try, usage_patterns
   - `on_the_horizon` — intro, 3 opportunities (title, whats_possible, how_to_try, copyable_prompt)
   - `fun_ending` — headline, detail (a memorable qualitative moment, not a stat)
   - `at_a_glance` — whats_working, whats_hindering, quick_wins, ambitious_workflows

   For short windows (<10 sessions) you may shrink each section proportionally
   rather than padding with filler.

5. **Emit the summary.** Output a markdown header matching the built-in format:

   ```
   # Claude Code Self-Reflection

   <N> sessions · <M> messages · <H>h · <C> commits
   <since> to <until>

   ## At a Glance
   **What's working:** ...
   **What's hindering you:** ...
   **Quick wins to try:** ...
   **Ambitious workflows:** ...
   ```

   Then ask the user which section they want to expand, or offer to save the
   full expanded report to `~/.claude/usage-data/self-reflection-<date>.md`.

## Data shapes

The aggregator produces data mirroring the built-in `/insights` types:

**SessionMeta** (per session, from `~/.claude/usage-data/session-meta/`):
- `session_id`, `project_path`, `start_time`, `duration_minutes`
- `user_message_count`, `assistant_message_count`, `tool_counts`, `languages`
- `git_commits`, `git_pushes`, `input_tokens`, `output_tokens`
- `first_prompt`, `summary?`, `user_interruptions`, `user_response_times`
- `tool_errors`, `tool_error_categories`
- Feature flags: `uses_task_agent`, `uses_mcp`, `uses_web_search`, `uses_web_fetch`
- `lines_added`, `lines_removed`, `files_modified`, `message_hours`

**SessionFacets** (per session, from `~/.claude/usage-data/facets/`):
- `underlying_goal`, `goal_categories`, `outcome`
- `user_satisfaction_counts`, `claude_helpfulness`, `session_type`
- `friction_counts`, `friction_detail`, `primary_success`, `brief_summary`

**AggregatedData** (the rollup emitted under `aggregated`):
All of the above rolled up, plus `date_range`, `total_sessions_scanned`,
`messages_per_day`, `days_active`, and a `query` block echoing the window.

## Notes

- Facet extraction is deliberately out of scope for v1 — we rely on the cache
  that `/insights` has already populated. Cached facets live at
  `~/.claude/usage-data/facets/<session_id>.json`.
- The aggregation logic in `scripts/aggregate.py` is a Python port of the
  built-in `aggregateData()` function.
- Multi-clauding detection is stubbed (`multi_clauding: {0, 0, 0}`). To add it,
  port `detectMultiClauding()` from the built-in command — operates over
  `user_message_timestamps` across sessions.
- HTML rendering is not yet implemented — v1 prints a markdown summary only.
  A future `scripts/render.py` could replicate the built-in's HTML output.
