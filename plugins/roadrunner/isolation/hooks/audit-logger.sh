#!/usr/bin/env bash
# Audit logger — records every tool call to a local log file.
# Adapted from the sandbox ergonomics report (Section 3).
#
# Hook type: PostToolUse (matcher: .*, async: true)
# Always exits 0 — never blocks the agent loop.
set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
SESSION=$(echo "$INPUT" | jq -r '.session_id // "?"')

# Truncate tool input to 500 chars to keep logs readable
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}' | head -c 500)

LOG_DIR=".roadrunner/audit"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/tool-calls.log"

echo "$(date -Iseconds)|$SESSION|$TOOL|$TOOL_INPUT" >> "$LOG_FILE"

exit 0
