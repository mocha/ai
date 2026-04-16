#!/usr/bin/env bash
set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)
UTIL_PCT=$(echo "$INPUT" | jq -r '.context_utilization_pct // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

# Exit early if no utilization data
if [ -z "$UTIL_PCT" ]; then exit 0; fi

# Read task_id from marker file
TASK_ID=$(cat .roadrunner/current_task_id 2>/dev/null || echo "0")

# Load/create threshold state
STATE_DIR=".roadrunner/budget_state"
STATE_FILE="$STATE_DIR/$SESSION_ID.json"
mkdir -p "$STATE_DIR"
if [ ! -f "$STATE_FILE" ]; then
  echo '{"fired_40":false,"fired_60":false,"fired_70":false}' > "$STATE_FILE"
fi

STATE=$(cat "$STATE_FILE")
EVENT_DIR=".roadrunner/events"
mkdir -p "$EVENT_DIR"

# Integer comparison for thresholds
# Use awk to convert utilization to integer (handles both int and float)
INT_PCT=$(echo "$UTIL_PCT" | awk '{printf "%d", $1}')

# Check 70% threshold (check highest first)
FIRED_70=$(echo "$STATE" | jq -r '.fired_70')
if [ "$INT_PCT" -ge 70 ] && [ "$FIRED_70" = "false" ]; then
  # Write CONTEXT_WARNING
  EVENT_FILE="$EVENT_DIR/$(date +%s%N)-context-warning-70.json"
  cat > "$EVENT_FILE" <<EOF
{"event":"CONTEXT_WARNING","task_id":$TASK_ID,"session_id":"$SESSION_ID","utilization_pct":$INT_PCT,"threshold":70,"action":"handoff"}
EOF
  # Write HANDOFF_READY
  HANDOFF_FILE="$EVENT_DIR/$(date +%s%N)-handoff-ready.json"
  cat > "$HANDOFF_FILE" <<EOF
{"event":"HANDOFF_READY","task_id":$TASK_ID,"session_id":"$SESSION_ID","handoff_path":""}
EOF
  # Update state
  STATE=$(echo "$STATE" | jq '.fired_70 = true')
  echo "$STATE" > "$STATE_FILE"
fi

# Check 60% threshold
FIRED_60=$(echo "$STATE" | jq -r '.fired_60')
if [ "$INT_PCT" -ge 60 ] && [ "$FIRED_60" = "false" ]; then
  EVENT_FILE="$EVENT_DIR/$(date +%s%N)-context-warning-60.json"
  cat > "$EVENT_FILE" <<EOF
{"event":"CONTEXT_WARNING","task_id":$TASK_ID,"session_id":"$SESSION_ID","utilization_pct":$INT_PCT,"threshold":60,"action":"save_state"}
EOF
  # Update state
  STATE=$(echo "$STATE" | jq '.fired_60 = true')
  echo "$STATE" > "$STATE_FILE"
fi

# Check 40% threshold
FIRED_40=$(echo "$STATE" | jq -r '.fired_40')
if [ "$INT_PCT" -ge 40 ] && [ "$FIRED_40" = "false" ]; then
  EVENT_FILE="$EVENT_DIR/$(date +%s%N)-context-warning-40.json"
  cat > "$EVENT_FILE" <<EOF
{"event":"CONTEXT_WARNING","task_id":$TASK_ID,"session_id":"$SESSION_ID","utilization_pct":$INT_PCT,"threshold":40,"action":"warn"}
EOF
  # Update state
  STATE=$(echo "$STATE" | jq '.fired_40 = true')
  echo "$STATE" > "$STATE_FILE"
fi

# Always exit 0 — never block the worker
exit 0
