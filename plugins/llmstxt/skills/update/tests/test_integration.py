"""Integration test: scanner against a realistic vault-like structure."""
import json as json_mod
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _make_vault(tmp):
    """Create a mini vault structure for testing."""
    # references/companies/ — homogeneous
    companies = Path(tmp, "references", "companies")
    companies.mkdir(parents=True)
    for name in ["acme", "globex", "initech"]:
        (companies / f"{name}.md").write_text(
            f"---\ntype: Company\nname: {name.title()}\n---\n# {name.title()}\n"
        )

    # _meta/research/events/ — homogeneous
    events = Path(tmp, "_meta", "research", "events")
    events.mkdir(parents=True)
    (events / "funding-round.md").write_text(
        "---\ntype: Event\ntitle: Funding Round\n---\n# Funding Round\n"
    )

    # projects/ — heterogeneous
    projects = Path(tmp, "projects")
    projects.mkdir()
    (projects / "index.md").write_text("---\ntype: Project\ntitle: Alpha\n---\n")

    # .obsidian/ — should be excluded
    Path(tmp, ".obsidian").mkdir()
    Path(tmp, ".obsidian", "config.json").write_text("{}")

    return tmp


def test_full_scan_on_mini_vault():
    """Scanner finds all content dirs, excludes dotfiles, sorts bottom-up."""
    with tempfile.TemporaryDirectory() as tmp:
        _make_vault(tmp)
        scanner = str(Path(__file__).resolve().parent.parent / "map_scanner.py")
        result = subprocess.run(
            ["python3", scanner, "--path", tmp],
            capture_output=True, text=True
        )
        assert result.returncode == 0
        data = json_mod.loads(result.stdout)

        paths = [d["path"] for d in data]
        path_names = [Path(p).name for p in paths]

        # All stale (no summaries exist)
        assert all(d["stale"] for d in data)

        # Dotfiles excluded
        assert ".obsidian" not in path_names

        # Leaf dirs before parents
        if "companies" in path_names and "references" in path_names:
            assert path_names.index("companies") < path_names.index("references")


def test_scan_after_summary_written():
    """Directory with current summary.md should not appear in results."""
    with tempfile.TemporaryDirectory() as tmp:
        _make_vault(tmp)

        # Write a current summary in projects/
        # Use a timestamp slightly in the future to ensure it's after all
        # filesystem mtimes (writing summary.md updates the dir's mtime).
        ts = (datetime.now(timezone.utc) + timedelta(seconds=2)).isoformat()
        (Path(tmp, "projects", "summary.md")).write_text(
            f"---\ntype: Summary\nlast_updated: {ts}\n---\n# /projects\nStuff.\n"
        )

        scanner = str(Path(__file__).resolve().parent.parent / "map_scanner.py")
        result = subprocess.run(
            ["python3", scanner, "--path", tmp],
            capture_output=True, text=True
        )
        data = json_mod.loads(result.stdout)
        stale_names = [Path(d["path"]).name for d in data]

        # projects/ should NOT be stale
        assert "projects" not in stale_names
        # But research dirs still are
        assert "companies" in stale_names
