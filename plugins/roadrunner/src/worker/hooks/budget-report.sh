#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
UTIL_PCT=$(echo "$INPUT" | jq '.context_utilization_pct // 0')
TASK_ID=$(cat .roadrunner/current_task_id 2>/dev/null || echo "0")

EVENT_DIR=".roadrunner/events"
mkdir -p "$EVENT_DIR"

EVENT_FILE="$EVENT_DIR/$(date +%s%N)-budget-report.json"
cat > "$EVENT_FILE" <<EOF
{"event":"BUDGET_REPORT","task_id":$TASK_ID,"session_id":"$SESSION_ID","final_utilization_pct":$UTIL_PCT}
EOF

# Clean up budget state file for this session
STATE_DIR=".roadrunner/budget_state"
rm -f "$STATE_DIR/$SESSION_ID.json" 2>/dev/null

exit 0
