---
name: kick
description: "Restart crashed or stuck agent triad sessions. Exits current Claude sessions, restarts them, and sends state-aware resume prompts. Use when agents are disconnected, stuck, or hit API errors."
---

# Kick Triad

Restart all agents in a triad session with full state recovery.

## Usage

`/triad:kick <org/repo>` — restart all 3 agents
`/triad:kick <org/repo> pm` — restart only the PM
`/triad:kick <org/repo> pgm` — restart only the PgM
`/triad:kick <org/repo> em` — restart only the EM

## What It Does

1. Reads current state from the project (inboxes, tasks, proposals, projects)
2. Exits the current Claude session(s) in the target pane(s)
3. Restarts Claude Code
4. Sends a context-aware resume prompt that tells the agent exactly where it left off
5. Restarts inbox watchers if they died

## Workflow

### 1. Assess current state

Before restarting, read the project state to build resume prompts:

```bash
# What proposals exist and their statuses
grep -r '^status:' <project-path>/docs/proposals/*/proposal.md

# What projects exist and their statuses
grep -r '^status:' <project-path>/docs/projects/*/*.md

# Active tasks
ls <project-path>/docs/tasks/*.md 2>/dev/null
for f in <project-path>/docs/tasks/*.md; do grep '^status:' "$f"; done

# Completed tasks
ls <project-path>/docs/tasks/_completed/*.md 2>/dev/null | wc -l

# Unread messages per agent
for agent in product-manager program-manager engineering-manager; do
  find <project-path>/docs/inbox/$agent/unread -type f ! -name '.gitkeep'
done

# Recent messages (decision trail)
find <project-path>/docs/inbox/*/read -type f ! -name '.gitkeep' -exec ls -t {} + | head -10
```

### 2. Exit and restart Claude

For each target pane:
```bash
tmux send-keys -t '<session>.<pane>' '/exit' Enter
sleep 3
# Use safehouse if available, otherwise plain claude
if command -v safehouse &>/dev/null; then
  SAFE_CMD="safehouse --workdir=$PROJECT_PATH --add-dirs=$HOME/code --add-dirs-ro=$HOME/vault --"
  tmux send-keys -t '<session>.<pane>' "$SAFE_CMD claude --dangerously-skip-permissions" Enter
else
  tmux send-keys -t '<session>.<pane>' 'claude' Enter
fi
sleep 10  # wait for Claude to load
```

### 3. Build and send resume prompts

Each agent gets a resume prompt tailored to the current state. The prompt should include:

**For all agents:**
- Project name and path
- Current proposal/project statuses
- Any unread messages in their inbox

**PM-specific:**
- Which proposals are in which state
- Whether any project-validated messages are waiting

**PgM-specific:**
- Which projects are in which state
- Whether any tasks-proposed or project-complete messages are waiting
- Which projects are blocked vs. in-progress

**EM-specific:**
- Which tasks are in the queue (status, dependencies)
- Which tasks are completed
- Whether workers need dispatching
- Any pending feedback from PgM

**Resume prompt format:**
```
We're working on <org/repo> at <project-path>. Here's the current state:

[state summary tailored to this agent's role]

Check your inbox and resume where you left off.
```

### 4. Restart inbox watchers

Check if watcher processes are still running:
```bash
pgrep -f "inbox-watcher.sh.*<project-path>.*<agent>" || echo "DEAD"
```

If dead, restart:
```bash
nohup "$TOOLKIT/scripts/inbox-watcher.sh" "$PROJECT_PATH" <agent> "<session>.<pane>" > /tmp/claude/watcher-<agent>-<session>.log 2>&1 &
```

### 5. Report

```
Kicked <org/repo>:
  PM (pane 0):  restarted — [N unread messages, current state summary]
  PgM (pane 1): restarted — [N unread messages, current state summary]
  EM (pane 2):  restarted — [N unread messages, current state summary]
  Watchers: [restarted N / all running]
```
