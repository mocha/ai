"""Directory scanner for the /map-directories skill.

Walks the vault directory tree, detects stale llms.txt files via mtime
comparison, and outputs a JSON work list. Stdlib only — no external deps.

Usage:
    python3 map_scanner.py [--path DIR] [--dry-run]
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

NAV_FILE = "llms.txt"

# Directory subtrees that should never have navigation files.
_SKIP_PATTERNS = [
    # _meta/research/events/YYYY, YYYY/MM, YYYY/MM/DD — date traversal only
    re.compile(r"_meta/research/events/\d{4}(/\d{2}(/\d{2})?)?$"),
    # fulltext_artifacts/ — image assets extracted from PDFs, not navigable
    re.compile(r"/fulltext_artifacts$"),
    # _proc/ — transient orchestrator working directory (gitignored)
    re.compile(r"/_proc(/|$)"),
    # publications/*/  — individual paper dirs (fulltext.md + summary.md are
    # self-describing; useful navigation lives at publications/ parent level)
    re.compile(r"/publications/[^/]+$"),
]

# Direct children of the scan root that should never be processed.
# Use this (not _SKIP_PATTERNS) for workspace directories that only exist at
# the vault root — avoids accidentally skipping same-named dirs deeper in the tree.
_ROOT_SKIP_DIRS = {
    "code",  # Local repo checkouts (gitignored, Obsidian-ignored). Workspace
             # for codebase investigation, not vault content. Can contain deep
             # trees (src/, node_modules/, etc.) with no nav value.
}


def _should_skip(dirpath: str, root: str) -> bool:
    """Return True if this directory should never have an llms.txt."""
    # Root-level workspace dirs — anchored to avoid false positives deeper in tree
    if os.path.dirname(dirpath) == root and os.path.basename(dirpath) in _ROOT_SKIP_DIRS:
        return True
    for pattern in _SKIP_PATTERNS:
        if pattern.search(dirpath):
            return True
    return False


def walk_content_dirs(root: str) -> list[str]:
    """Walk directory tree excluding dotfile dirs and skip-listed patterns.
    Returns paths bottom-up. Stops at git repo boundaries (dirs containing
    .git) so each repo can manage its own llms.txt tree independently."""
    dirs = []
    for dirpath, dirnames, _filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        if _should_skip(dirpath, root):
            dirnames[:] = []
            continue
        # Stop at git repo roots (but still include the root dir itself
        # so the parent's nav can reference it as a leaf entry)
        if dirpath != root and ".git" in os.listdir(dirpath):
            dirnames[:] = []  # don't recurse into repo contents
            dirs.append(dirpath)
            continue
        dirs.append(dirpath)

    dirs.sort(key=lambda d: d.count(os.sep), reverse=True)
    return dirs


def _parse_timestamp(nav_path: str) -> datetime | None:
    """Extract timestamp from the last non-empty line of an llms.txt file."""
    try:
        text = Path(nav_path).read_text()
    except FileNotFoundError:
        return None

    # Last non-empty line should be a bare ISO 8601 timestamp
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    if not lines:
        return None

    last_line = lines[-1]
    try:
        return datetime.fromisoformat(last_line)
    except ValueError:
        return None


def check_staleness(dirpath: str) -> dict:
    """Check if a directory's llms.txt is stale.

    Returns dict with keys: path, stale (bool), reason (new/modified/current),
    child_count, subdirectory_count.
    """
    nav_file = Path(dirpath, NAV_FILE)
    children = list(Path(dirpath).iterdir())
    child_files = [c for c in children if c.is_file() and c.name != NAV_FILE]
    child_dirs = [c for c in children if c.is_dir() and not c.name.startswith(".")]

    result = {
        "path": dirpath,
        "child_count": len(child_files),
        "subdirectory_count": len(child_dirs),
    }

    last_updated = _parse_timestamp(str(nav_file))
    if last_updated is None:
        result["stale"] = True
        result["reason"] = "new"
        return result

    if last_updated.tzinfo is None:
        last_updated = last_updated.replace(tzinfo=timezone.utc)

    # Only check child files and child dirs — not the directory itself
    # or llms.txt, since both get updated when the nav file is written.
    paths_to_check = child_files + child_dirs
    if not paths_to_check:
        result["stale"] = False
        result["reason"] = "current"
        return result
    latest_mtime = max(p.stat().st_mtime for p in paths_to_check)
    latest_dt = datetime.fromtimestamp(latest_mtime, tz=timezone.utc)

    if latest_dt > last_updated:
        result["stale"] = True
        result["reason"] = "modified"
    else:
        result["stale"] = False
        result["reason"] = "current"

    return result


def scan(root: str) -> tuple[list[dict], int]:
    """Scan all content directories and return staleness info.

    Returns (stale_dirs, total_count) where stale_dirs is sorted bottom-up.
    """
    dirs = walk_content_dirs(root)
    results = []
    for d in dirs:
        try:
            info = check_staleness(d)
        except PermissionError:
            print(f"warning: skipping unreadable directory: {d}", file=sys.stderr)
            continue
        if info["stale"]:
            results.append(info)
    return results, len(dirs)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Scan vault for stale llms.txt files")
    parser.add_argument("--path", default=".", help="Root directory to scan (default: cwd)")
    parser.add_argument("--dry-run", action="store_true", help="Report stale dirs without updating")
    args = parser.parse_args()

    root = str(Path(args.path).resolve())
    results, total = scan(root)

    print(json.dumps(results, indent=2))

    if args.dry_run:
        print(f"\n# {len(results)} of {total} directories are stale", file=sys.stderr)


if __name__ == "__main__":
    main()
