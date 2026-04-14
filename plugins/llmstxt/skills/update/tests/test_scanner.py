import json as json_mod
import os
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from map_scanner import walk_content_dirs, check_staleness


def test_walk_excludes_dotfiles():
    """Walk should return content dirs but skip dotfile dirs."""
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, "references").mkdir()
        Path(tmp, "references", "companies").mkdir()
        Path(tmp, ".obsidian").mkdir()
        Path(tmp, ".claude").mkdir()
        Path(tmp, "projects").mkdir()

        result = walk_content_dirs(tmp)
        names = [os.path.basename(d) for d in result]

        assert "references" in names
        assert "companies" in names
        assert "projects" in names
        assert ".obsidian" not in names
        assert ".claude" not in names


def test_walk_returns_bottom_up():
    """Leaf directories should appear before their parents."""
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, "a").mkdir()
        Path(tmp, "a", "b").mkdir()
        Path(tmp, "a", "b", "c").mkdir()

        result = walk_content_dirs(tmp)
        idx_c = next(i for i, d in enumerate(result) if d.endswith("/c"))
        idx_b = next(i for i, d in enumerate(result) if d.endswith("/b"))
        idx_a = next(i for i, d in enumerate(result) if d.endswith("/a"))
        assert idx_c < idx_b < idx_a


def test_no_summary_is_stale():
    """Directory without summary.md is always stale."""
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, "file.md").write_text("hello")
        result = check_staleness(tmp)
        assert result["stale"] is True
        assert result["reason"] == "new"


def test_current_summary_is_not_stale():
    """Summary newer than all children is current."""
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, "file.md").write_text("hello")
        time.sleep(0.1)
        summary = Path(tmp, "summary.md")
        summary.write_text(
            "---\ntype: Summary\nlast_updated: 2099-01-01T00:00:00+00:00\n---\ntest"
        )
        result = check_staleness(tmp)
        assert result["stale"] is False


def test_modified_child_makes_stale():
    """If a child file is newer than summary, directory is stale."""
    with tempfile.TemporaryDirectory() as tmp:
        summary = Path(tmp, "summary.md")
        summary.write_text(
            "---\ntype: Summary\nlast_updated: 2020-01-01T00:00:00+00:00\n---\nold"
        )
        Path(tmp, "new_file.md").write_text("new content")
        result = check_staleness(tmp)
        assert result["stale"] is True
        assert result["reason"] == "modified"


def test_cli_json_output():
    """CLI should output JSON array of stale directories."""
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, "a").mkdir()
        Path(tmp, "a", "file.md").write_text("hello")
        Path(tmp, "b").mkdir()
        Path(tmp, "b", "file.md").write_text("hello")

        scanner = str(Path(__file__).resolve().parent.parent / "map_scanner.py")
        result = subprocess.run(
            ["python3", scanner, "--path", tmp],
            capture_output=True, text=True
        )
        assert result.returncode == 0
        data = json_mod.loads(result.stdout)
        assert len(data) == 3  # a, b, and the root itself
        assert all(d["stale"] for d in data)
        assert all(d["reason"] == "new" for d in data)


def test_cli_dry_run():
    """Dry run should output same JSON plus stderr summary."""
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, "a").mkdir()
        Path(tmp, "a", "file.md").write_text("hello")

        scanner = str(Path(__file__).resolve().parent.parent / "map_scanner.py")
        result = subprocess.run(
            ["python3", scanner, "--path", tmp, "--dry-run"],
            capture_output=True, text=True
        )
        assert result.returncode == 0
        data = json_mod.loads(result.stdout)
        assert len(data) == 2  # a and the root itself
        assert all(d["stale"] for d in data)
        # Dry run prints summary to stderr
        assert "2 of 2" in result.stderr
