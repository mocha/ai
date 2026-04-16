#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
UTIL_PCT=$(echo "$INPUT" | jq '.context_utilization_pct // 0')
TASK_ID=$(cat .roadrunner/current_task_id 2>/dev/null || echo "0")

EVENT_DIR=".roadrunner/events"
mkdir -p "$EVENT_DIR"

EVENT_FILE="$EVENT_DIR/$(date +%s%N)-compaction.json"
cat > "$EVENT_FILE" <<EOF
{"event":"COMPACTION_DETECTED","task_id":$TASK_ID,"session_id":"$SESSION_ID","utilization_at_compaction":$UTIL_PCT}
EOF

exit 0
