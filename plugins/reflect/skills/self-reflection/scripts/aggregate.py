#!/usr/bin/env python3
"""Aggregate Claude Code session data within a date range.

Reads cached session-meta/*.json and facets/*.json from ~/.claude/usage-data/
and emits an AggregatedData JSON object to stdout.

Mirrors the aggregateData() function in the built-in /insights command
(see _tmp/insights.ts lines 1145-1323) but scoped to a date range.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path


DEFAULT_DATA_DIR = Path.home() / ".claude" / "usage-data"


def parse_time_spec(spec: str, *, default: datetime | None = None) -> datetime:
    """Parse a time spec into a UTC datetime.

    Accepts: relative (24h, 7d, 30d, 1w), ISO date (2026-04-14),
    ISO datetime (2026-04-14T10:00:00Z), or 'now'.
    """
    spec = spec.strip().lower()
    now = datetime.now(timezone.utc)

    if spec in ("now", ""):
        return now

    m = re.fullmatch(r"(\d+)\s*([hdwm])", spec)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        delta = {
            "h": timedelta(hours=n),
            "d": timedelta(days=n),
            "w": timedelta(weeks=n),
            "m": timedelta(days=30 * n),
        }[unit]
        return now - delta

    # ISO date or datetime
    try:
        if "T" in spec:
            return datetime.fromisoformat(spec.replace("z", "+00:00"))
        return datetime.fromisoformat(spec).replace(tzinfo=timezone.utc)
    except ValueError as e:
        if default is not None:
            return default
        raise SystemExit(f"cannot parse time spec {spec!r}: {e}")


def load_session_metas(meta_dir: Path, since: datetime, until: datetime) -> list[dict]:
    """Load session-meta JSON files with start_time in [since, until]."""
    metas: list[dict] = []
    for path in meta_dir.glob("*.json"):
        try:
            meta = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        start = meta.get("start_time")
        if not start:
            continue
        try:
            start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        except ValueError:
            continue
        if since <= start_dt <= until:
            metas.append(meta)
    return metas


def dedupe_by_session_id(metas: list[dict]) -> list[dict]:
    """Keep the branch with most user messages per session_id (TS line 2893-2912)."""
    best: dict[str, dict] = {}
    for meta in metas:
        sid = meta.get("session_id", "")
        prev = best.get(sid)
        if (
            prev is None
            or meta.get("user_message_count", 0) > prev.get("user_message_count", 0)
            or (
                meta.get("user_message_count", 0) == prev.get("user_message_count", 0)
                and meta.get("duration_minutes", 0) > prev.get("duration_minutes", 0)
            )
        ):
            best[sid] = meta
    return list(best.values())


def is_substantive(meta: dict) -> bool:
    return (
        meta.get("user_message_count", 0) >= 2
        and meta.get("duration_minutes", 0) >= 1
    )


def load_facets(facets_dir: Path, session_ids: set[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for sid in session_ids:
        path = facets_dir / f"{sid}.json"
        if not path.exists():
            continue
        try:
            out[sid] = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
    return out


def is_minimal(facets: dict) -> bool:
    cats = facets.get("goal_categories") or {}
    non_zero = [k for k, v in cats.items() if v > 0]
    return len(non_zero) == 1 and non_zero[0] == "warmup_minimal"


def aggregate(sessions: list[dict], facets: dict[str, dict]) -> dict:
    """Port of aggregateData() from insights.ts."""
    result: dict = {
        "total_sessions": len(sessions),
        "sessions_with_facets": len(facets),
        "date_range": {"start": "", "end": ""},
        "total_messages": 0,
        "total_duration_hours": 0.0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
        "tool_counts": Counter(),
        "languages": Counter(),
        "git_commits": 0,
        "git_pushes": 0,
        "projects": Counter(),
        "goal_categories": Counter(),
        "outcomes": Counter(),
        "satisfaction": Counter(),
        "helpfulness": Counter(),
        "session_types": Counter(),
        "friction": Counter(),
        "success": Counter(),
        "session_summaries": [],
        "total_interruptions": 0,
        "total_tool_errors": 0,
        "tool_error_categories": Counter(),
        "user_response_times": [],
        "median_response_time": 0.0,
        "avg_response_time": 0.0,
        "sessions_using_task_agent": 0,
        "sessions_using_mcp": 0,
        "sessions_using_web_search": 0,
        "sessions_using_web_fetch": 0,
        "total_lines_added": 0,
        "total_lines_removed": 0,
        "total_files_modified": 0,
        "days_active": 0,
        "messages_per_day": 0,
        "message_hours": [],
        "multi_clauding": {
            "overlap_events": 0,
            "sessions_involved": 0,
            "user_messages_during": 0,
        },
    }

    dates: list[str] = []
    all_response_times: list[float] = []
    all_message_hours: list[int] = []

    for s in sessions:
        dates.append(s.get("start_time", ""))
        result["total_messages"] += s.get("user_message_count", 0)
        result["total_duration_hours"] += s.get("duration_minutes", 0) / 60
        result["total_input_tokens"] += s.get("input_tokens", 0)
        result["total_output_tokens"] += s.get("output_tokens", 0)
        result["git_commits"] += s.get("git_commits", 0)
        result["git_pushes"] += s.get("git_pushes", 0)
        result["total_interruptions"] += s.get("user_interruptions", 0)
        result["total_tool_errors"] += s.get("tool_errors", 0)

        for cat, cnt in (s.get("tool_error_categories") or {}).items():
            result["tool_error_categories"][cat] += cnt
        all_response_times.extend(s.get("user_response_times") or [])
        result["sessions_using_task_agent"] += int(s.get("uses_task_agent", False))
        result["sessions_using_mcp"] += int(s.get("uses_mcp", False))
        result["sessions_using_web_search"] += int(s.get("uses_web_search", False))
        result["sessions_using_web_fetch"] += int(s.get("uses_web_fetch", False))
        result["total_lines_added"] += s.get("lines_added", 0)
        result["total_lines_removed"] += s.get("lines_removed", 0)
        result["total_files_modified"] += s.get("files_modified", 0)
        all_message_hours.extend(s.get("message_hours") or [])

        for tool, cnt in (s.get("tool_counts") or {}).items():
            result["tool_counts"][tool] += cnt
        for lang, cnt in (s.get("languages") or {}).items():
            result["languages"][lang] += cnt

        pp = s.get("project_path") or ""
        if pp:
            result["projects"][pp] += 1

        sf = facets.get(s.get("session_id", ""))
        if sf:
            for cat, cnt in (sf.get("goal_categories") or {}).items():
                if cnt > 0:
                    result["goal_categories"][cat] += cnt
            result["outcomes"][sf.get("outcome", "")] += 1
            for lvl, cnt in (sf.get("user_satisfaction_counts") or {}).items():
                if cnt > 0:
                    result["satisfaction"][lvl] += cnt
            result["helpfulness"][sf.get("claude_helpfulness", "")] += 1
            result["session_types"][sf.get("session_type", "")] += 1
            for t, cnt in (sf.get("friction_counts") or {}).items():
                if cnt > 0:
                    result["friction"][t] += cnt
            ps = sf.get("primary_success", "none")
            if ps != "none":
                result["success"][ps] += 1

        if len(result["session_summaries"]) < 50:
            result["session_summaries"].append({
                "id": (s.get("session_id") or "")[:8],
                "date": (s.get("start_time") or "").split("T")[0],
                "summary": s.get("summary") or (s.get("first_prompt") or "")[:100],
                "goal": sf.get("underlying_goal") if sf else None,
            })

    dates.sort()
    if dates:
        result["date_range"]["start"] = dates[0].split("T")[0]
        result["date_range"]["end"] = dates[-1].split("T")[0]

    result["user_response_times"] = all_response_times
    if all_response_times:
        result["median_response_time"] = statistics.median(all_response_times)
        result["avg_response_time"] = sum(all_response_times) / len(all_response_times)

    unique_days = {d.split("T")[0] for d in dates}
    result["days_active"] = len(unique_days)
    if result["days_active"] > 0:
        result["messages_per_day"] = round(
            result["total_messages"] / result["days_active"], 1
        )

    result["message_hours"] = all_message_hours

    # Convert Counters to plain dicts for JSON
    for k, v in list(result.items()):
        if isinstance(v, Counter):
            result[k] = dict(v)

    return result


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--since", default="30d", help="start (e.g. 24h, 7d, 2026-04-13)")
    p.add_argument("--until", default="now", help="end (default: now)")
    p.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    p.add_argument("--include-minimal", action="store_true",
                   help="include sessions whose only goal category is warmup_minimal")
    p.add_argument("--raw-sessions", action="store_true",
                   help="also emit filtered session list under 'sessions' key")
    args = p.parse_args()

    since = parse_time_spec(args.since)
    until = parse_time_spec(args.until)
    if since >= until:
        print(f"error: --since ({since.isoformat()}) >= --until ({until.isoformat()})",
              file=sys.stderr)
        return 2

    meta_dir = args.data_dir / "session-meta"
    facets_dir = args.data_dir / "facets"
    if not meta_dir.is_dir():
        print(f"error: {meta_dir} not found", file=sys.stderr)
        return 2

    metas = load_session_metas(meta_dir, since, until)
    metas = dedupe_by_session_id(metas)
    metas.sort(key=lambda m: m.get("start_time", ""), reverse=True)

    substantive = [m for m in metas if is_substantive(m)]
    ids = {m["session_id"] for m in substantive}
    facets = load_facets(facets_dir, ids)

    if not args.include_minimal:
        drop = {sid for sid, f in facets.items() if is_minimal(f)}
        substantive = [m for m in substantive if m["session_id"] not in drop]
        facets = {sid: f for sid, f in facets.items() if sid not in drop}

    aggregated = aggregate(substantive, facets)
    aggregated["total_sessions_scanned"] = len(metas)
    aggregated["query"] = {
        "since": since.isoformat(),
        "until": until.isoformat(),
    }

    payload: dict = {"aggregated": aggregated, "facets": facets}
    if args.raw_sessions:
        payload["sessions"] = substantive

    json.dump(payload, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
