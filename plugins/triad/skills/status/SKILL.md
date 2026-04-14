---
name: status
description: "Check the current state of an agent triad session. Captures all 3 panes, reads inbox state, task queue, and proposal/project statuses. Use to get a quick overview of where things stand."
---

# Status Triad

Get a comprehensive status report for an agent triad session.

## Usage

`/triad:status <org/repo>`
`/triad:status` — if only one active session, uses that

## What It Does

1. Captures the tail of each tmux pane to see what agents are currently doing
2. Reads all inboxes (unread counts + recent messages)
3. Reads the task queue (active tasks, completed tasks)
4. Reads proposal and project statuses
5. Produces a summary report

## Workflow

### 1. Capture agent activity

For each pane (0=PM, 1=PgM, 2=EM), run:
```bash
tmux capture-pane -t '<org/repo>.N' -p -S -50 | tail -30
```

Summarize what each agent is currently doing (idle, writing, reviewing, dispatching, waiting, stuck, errored).

### 2. Read inbox state

For each agent + human, count unread and list recent:
```bash
# Unread counts
for agent in product-manager program-manager engineering-manager human; do
  find <project-path>/docs/inbox/$agent/unread -type f ! -name '.gitkeep' | wc -l
done

# Recent messages (last 5 across all read/ dirs)
find <project-path>/docs/inbox/*/read -type f ! -name '.gitkeep' -exec ls -t {} + | head -10
```

### 3. Read task queue

```bash
# Active tasks
ls <project-path>/docs/tasks/*.md 2>/dev/null

# Completed tasks
ls <project-path>/docs/tasks/_completed/*.md 2>/dev/null
```

For each active task, read the `status` field from frontmatter.

### 4. Read proposal and project statuses

```bash
# Proposals
grep -r '^status:' <project-path>/docs/proposals/*/proposal.md

# Projects
grep -r '^status:' <project-path>/docs/projects/*/*.md
```

### 5. Produce summary report

Format as:

```
=== Triad Status: <org/repo> ===

Agents:
  PM (pane 0):  [idle | working | waiting | stuck | error] — <brief description>
  PgM (pane 1): [idle | working | waiting | stuck | error] — <brief description>
  EM (pane 2):  [idle | working | waiting | stuck | error] — <brief description>

Proposals:
  PMD-001: <title> — <status>

Projects:
  PRJ-001: <title> — <status>
  PRJ-002: <title> — <status> (blocked by PRJ-001)

Tasks:
  Active: N tasks (N todo, N in-progress, N blocked)
  Completed: N tasks in _completed/

Inboxes:
  PM: N unread
  PgM: N unread
  EM: N unread
  Human: N unread

Recent messages:
  <timestamp> <sender> → <recipient>: <type> (<disposition>)
  ...

Watcher logs: /tmp/claude/watcher-*-<session>.log
```

### 6. Flag issues

If any agent appears stuck (no output change, error visible), flag it and suggest `/triad:kick` or direct intervention.

If there are unread messages that have been sitting for more than 5 minutes, flag the recipient agent as potentially unresponsive.
