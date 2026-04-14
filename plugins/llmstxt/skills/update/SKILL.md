---
name: update
description: >
  Create and maintain llms.txt navigation files throughout the vault.
  Scans directories for staleness via mtime comparison, then generates
  concise agent-oriented navigation files following the llms.txt convention.
  Use when you want to update vault navigation, after significant content
  changes, or to check what needs updating with --dry-run.
---

# Map Directories — llms.txt Navigation Generator

Maintain `llms.txt` files across the vault's content directories. These
files follow the [llmstxt.org](https://llmstxt.org) convention: agent-first
navigation aids that are invisible to Obsidian (which only renders `.md`).

## Invocation

- `/llmstxt:update` — update all directories from the vault root down
- `/llmstxt:update <path>` — update a specific directory subtree
- `/llmstxt:update --dry-run` — report stale directories without updating

## Step-by-Step Flow

### 1. Run the scanner

The scanner (`map_scanner.py`) lives in this skill's own directory. Invoke it
using the skill's base path (shown at skill invocation):

```bash
python3 <skill-base>/map_scanner.py --path <root>
```

For dry-run mode, add `--dry-run` and report the results to the user. Stop here.

The scanner outputs a JSON array of stale directories, sorted bottom-up
(leaves first). Each entry has: `path`, `reason` (new/modified),
`child_count`, `subdirectory_count`.

### 2. Process each stale directory

For each directory in the scanner output, **in order** (bottom-up):

#### 2a. Read directory contents

- List all direct child files (excluding `llms.txt`)
- For each file: read the filename and YAML frontmatter (first 20 lines)
- For each child subdirectory: read its `llms.txt` if it exists (should — bottom-up)

#### 2b. Classify the directory

- **Homogeneous:** Most files share a `type` frontmatter field or naming pattern.
  Describe the schema and count. Do NOT list individual files.
- **Heterogeneous:** Files are diverse. List contents with one-line descriptions.

#### 2c. Generate the llms.txt

Write an `llms.txt` following the llmstxt.org format:

```
# <Descriptive Name>

> <One-sentence summary of what this directory contains and its role in the vault.>

<Optional body: for homogeneous dirs, describe the schema and count.
For heterogeneous dirs, additional context if needed.>

## Contents

- [filename.md](filename.md): One-line description
- [other.md](other.md): One-line description

## Subdirectories

- [subdir-name](subdir-name/llms.txt): First sentence from child's llms.txt blockquote

## Optional

- [_backlog](_backlog/llms.txt): Secondary navigation (backlog, sources, archives)
- [_sources](_sources/llms.txt): Source material directories

<ISO 8601 timestamp>
```

**Format rules:**

- **H1 title**: Use a descriptive human-readable name, NOT the file path.
  The agent already knows the path from the request. Example: use
  "IQ Cloud API" not "/product/cloud-api".
- **Blockquote**: Required. One sentence describing what's here and why.
- **Body**: Optional paragraphs for context. Keep concise.
- **## Contents**: Child files with `- [name](path): description` links.
  For homogeneous dirs (500+ company files, etc.), omit individual file
  links and describe the collection pattern in the body instead.
- **## Subdirectories**: Child directories linking to their `llms.txt`.
- **## Optional**: Secondary content (backlog, sources, archives) that
  context-constrained agents can skip. Omit if nothing qualifies.
- **Timestamp**: The very last line is always a bare ISO 8601 timestamp
  (e.g. `2026-03-17T14:48:50+00:00`). No label, no formatting. Agents
  and the scanner parse it positionally.

Omit any section that would be empty. The only required elements are
the H1, blockquote, and timestamp.

### 3. Report results

Summarize what was done:
- How many directories were scanned
- How many llms.txt files were created (new) vs updated (modified)
- List each directory that was updated

## Purpose — When to Create (and Skip) llms.txt

**The only goal of `llms.txt` is to make a directory legible and navigable for agents.** Before generating a file, ask: does an agent navigating this directory genuinely need help understanding what's here and where to go next?

**Do NOT generate llms.txt if:**
- The files in the directory are self-describing by name (e.g., `fulltext.md` + `summary.md` in a paper directory — no agent needs a nav file to understand those)
- The parent directory's `llms.txt` already provides all useful context for this level
- The directory is a leaf with only one or two obvious files
- The content is infrastructure/assets with no agent decision value (images, temp files, date-only traversal dirs)

The scanner enforces known cases via `_SKIP_PATTERNS`. **Add new skip patterns rather than generating useless files.**

## Important Notes

- **Exclude dotfile directories** — `.claude/`, `.obsidian/`, `.git/` are never processed.
- **Exclude root-level workspace dirs** — `code/` (local repo checkouts) is listed in `_ROOT_SKIP_DIRS` in `map_scanner.py`. These are skipped only when they appear as direct children of the scan root, so a `code/` dir deeper in the vault is unaffected. Add new root-level workspace directories to `_ROOT_SKIP_DIRS`, not to `_SKIP_PATTERNS`.
- **Bottom-up order is critical** — always process children before parents.
- **Homogeneous directories summarize the pattern, not the inventory.**
- **Use Haiku** for all generation — these are short, mechanical tasks.
- **Always emit timezone-aware timestamps** — `+00:00` suffix.
- **llms.txt is invisible to Obsidian** — this is intentional. These files
  are for agents only. Obsidian is the human UI.
- **summary.md files are content, not navigation** — the vault uses
  `summary.md` for paper summaries in `reference-general/publications/`.
  Those are unrelated to `llms.txt` navigation files. Never modify them.
