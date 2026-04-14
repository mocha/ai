#!/usr/bin/env bash
set -euo pipefail

# init-project.sh — Initialize agent triad protocol infrastructure in a target project.
# Usage: ./init-project.sh /path/to/project

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/project" >&2
  exit 1
fi

TARGET="$1"

if [[ ! -d "$TARGET" ]]; then
  echo "Error: target directory does not exist: $TARGET" >&2
  exit 1
fi

# Resolve to absolute path
TARGET="$(cd "$TARGET" && pwd)"

echo "Initializing agent triad infrastructure in: $TARGET"
echo ""

# --- Directory structure ---

DIRS=(
  docs/proposals
  docs/projects
  docs/tasks/_completed
  docs/inbox/product-manager/unread
  docs/inbox/product-manager/read
  docs/inbox/program-manager/unread
  docs/inbox/program-manager/read
  docs/inbox/engineering-manager/unread
  docs/inbox/engineering-manager/read
  docs/inbox/human/unread
  docs/inbox/human/read
)

created_count=0

for dir in "${DIRS[@]}"; do
  full="$TARGET/$dir"
  if [[ ! -d "$full" ]]; then
    mkdir -p "$full"
    ((created_count++))
  fi
done

# --- .gitkeep files in leaf directories ---

gitkeep_count=0

for dir in "${DIRS[@]}"; do
  full="$TARGET/$dir"
  gk="$full/.gitkeep"
  if [[ ! -f "$gk" ]]; then
    touch "$gk"
    ((gitkeep_count++))
  fi
done

# --- .gitignore for inbox (keep directory structure only) ---

GITIGNORE="$TARGET/docs/inbox/.gitignore"
gitignore_created=false

if [[ ! -f "$GITIGNORE" ]]; then
  cat > "$GITIGNORE" << 'EOF'
# Keep directory structure via .gitkeep
# All messages (both unread and read) are tracked as part of the decision record
EOF
  gitignore_created=true
fi

# --- Summary ---

echo "Done. Summary:"
echo "  Directories created: $created_count"
echo "  .gitkeep files added: $gitkeep_count"
if $gitignore_created; then
  echo "  Created: docs/inbox/.gitignore"
else
  echo "  Skipped: docs/inbox/.gitignore (already exists)"
fi
echo ""
echo "Structure:"
echo "  docs/"
echo "    proposals/          — Decision proposals between agents"
echo "    projects/           — Active project specs"
echo "    tasks/"
echo "      _completed/       — Archived completed tasks"
echo "    inbox/"
echo "      product-manager/  — PM inbox (unread/ + read/)"
echo "      program-manager/  — Deuleytron inbox (unread/ + read/)"
echo "      engineering-manager/ — EM inbox (unread/ + read/)"
echo "      human/            — Human inbox (unread/ + read/)"
echo ""
echo "Next steps:"
echo "  1. Copy agent CLAUDE.md files into the target project"
echo "  2. Configure each agent's skills and rules"
echo "  3. Commit the scaffolding: git add docs/ && git commit -m 'Initialize agent triad infrastructure'"
