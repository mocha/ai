#!/usr/bin/env bash
# MCP tool gate — blocks destructive MCP operations.
# Adapted from the sandbox ergonomics report (Section 5).
#
# Hook type: PreToolUse (matcher: mcp__.*)
# Exit 2 = deny the tool call
# Exit 0 = no opinion (defer to permission system)
set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')

DENIED_MCP_TOOLS=(
  "mcp__linear__delete_issue"
  "mcp__linear__delete_comment"
  "mcp__github__delete_repository"
  "mcp__github__merge_pull_request"
)

for denied in "${DENIED_MCP_TOOLS[@]}"; do
  if [ "$TOOL" = "$denied" ]; then
    echo "BLOCKED by mcp-tool-gate: $TOOL requires explicit approval. Use the Linear/GitHub UI directly." >&2
    exit 2
  fi
done

exit 0
