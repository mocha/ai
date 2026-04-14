---
name: resume
description: "Attach to an existing agent triad session and resume monitoring. Use when returning to a project after being away — checks state, verifies agents are responsive, and kicks any that need it."
---

# Resume Triad

Reconnect to an existing triad session and ensure everything is running.

## Usage

`/triad:resume <org/repo>`
`/triad:resume` — if only one active session, uses that

## What It Does

1. Verifies the tmux session exists
2. Runs `/triad:status` to assess current state
3. Checks if all 3 agents are responsive (not crashed, not hung)
4. Checks if inbox watchers are running
5. Kicks any unresponsive agents via `/triad:kick`
6. Reports the current state so you know where things stand

## Workflow

### 1. Verify session exists

```bash
tmux has-session -t '<org/repo>' 2>/dev/null
```

If not found, check `docs/active-projects.md` for the project and suggest `/triad:start` instead.

### 2. Run status check

Use the `/triad:status` workflow to get current state of all agents, inboxes, tasks, and projects.

### 3. Check agent responsiveness

For each pane, look at the captured output:
- Is Claude running? (check `pane_current_command`)
- Is it responsive or hung? (look for "Running...", API errors, or stale output)
- Does it have unread messages it hasn't processed?

### 4. Check inbox watchers

```bash
pgrep -f "inbox-watcher.sh.*<project-path>" | wc -l
```

Should be 3 (one per agent). If fewer, identify which are dead.

### 5. Auto-fix issues

- If an agent is crashed (pane shows shell, not Claude): kick it via `/triad:kick <org/repo> <agent>`
- If an agent has been unresponsive with unread messages for >5 min: kick it
- If inbox watchers are dead: restart them
- If everything is healthy: report and stand by

### 6. Report

```
=== Resume: <org/repo> ===

Session: found, 3 panes active
Agents: [all healthy | N kicked]
Watchers: [all running | N restarted]

[Full status report from /triad:status]

Ready to monitor. Use /triad:status for updates.
```
