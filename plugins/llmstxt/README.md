# llmstxt

Create and maintain [`llms.txt`](https://llmstxt.org) navigation files
throughout a content vault. These files are agent-first directory maps: concise,
hand-crafted summaries that let a Claude agent traverse a deep knowledge base
without having to read every file to figure out where to go next.

Invisible to tools like Obsidian (which only render `.md`), so they stay out
of the human UI while dramatically cutting token cost for agent traversal.

## When this earns its keep

On small, self-describing directories you don't need navigation files at all.
The skill pays off when your vault has:

- **Deep trees** that are expensive to walk blindly
- **Heterogeneous directories** where filenames alone don't tell you what's inside
- **Mixed homogeneous collections** (500+ company files, papers, notes) where
  summarising the pattern is cheaper than listing every file
- **Agent workflows** that re-traverse the same paths repeatedly — a stale
  `llms.txt` is a cache, a fresh one is a warm cache

## Skills

| Skill | What it does |
|---|---|
| `/llmstxt:update` | Scan for stale `llms.txt` files (mtime comparison) and regenerate them bottom-up |

## Usage

```bash
# Update all directories from the vault root down
/llmstxt:update

# Update a specific subtree
/llmstxt:update path/to/dir

# Report stale directories without writing anything
/llmstxt:update --dry-run
```

The scanner sorts stale directories bottom-up (leaves first) so each parent
can include child summaries in its own nav file. Directories are classified as
**homogeneous** (shared `type` frontmatter or naming pattern — describe the
pattern, don't list files) or **heterogeneous** (list contents with one-line
descriptions).

For installation, see the [marketplace README](../../README.md).

## What's bundled

```
llmstxt/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── update/
        ├── SKILL.md             # Full format rules, skip patterns, generation flow
        ├── map_scanner.py       # Stdlib-only directory scanner
        └── tests/               # pytest suite for the scanner
            ├── test_scanner.py
            └── test_integration.py
```

### `map_scanner.py`

Stdlib-only Python script that walks a directory tree, detects stale
`llms.txt` files via mtime comparison, and outputs a JSON work list sorted
bottom-up. No external dependencies.

```bash
python3 map_scanner.py --path path/to/vault [--dry-run]
```

Skip patterns and root-level workspace exclusions are declared at the top of
`map_scanner.py` (`_SKIP_PATTERNS`, `_ROOT_SKIP_DIRS`). Edit these to match
your vault's conventions — the scanner deliberately refuses to generate nav
for anything matched.

## Format

Each `llms.txt` follows the [llmstxt.org](https://llmstxt.org) convention:

```
# <Descriptive Name>

> <One-sentence summary of what this directory contains and its role in the vault.>

## Contents

- [filename.md](filename.md): One-line description

## Subdirectories

- [subdir](subdir/llms.txt): First sentence from child's llms.txt blockquote

<ISO 8601 timestamp>
```

The bare trailing timestamp is parsed positionally by the scanner to detect
staleness on next run.

See [SKILL.md](skills/update/SKILL.md) for the full format rules and
skip-pattern conventions.

## Tests

```bash
cd skills/update && python -m pytest tests/
```

## License

MIT
