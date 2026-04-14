---
name: start
description: "Create a new agent triad session for a project. Sets up a tmux session with 3 panes (PM, PgM, EM), starts Claude Code in each, and sends initial briefings. Use when starting work on a new or existing project."
---

# Start Triad

Create a tmux-based agent triad session for a project.

## Usage

`/triad:start <org/repo> <project-path> [briefing]`

Examples:
- `/triad:start ionq/research-kb-ui ~/code/research-kb-ui`
- `/triad:start deuleyville/dogproj-app ~/code/dogproj-app "We're building the booking system"`

## What It Does

1. Creates a tmux session named `<org/repo>` with 3 panes (horizontal split)
2. Pane 0: PM — `cd` to `agents/product-manager/`, starts `claude`
3. Pane 1: PgM — `cd` to `agents/program-manager/`, starts `claude`
4. Pane 2: EM — `cd` to `agents/engineering-manager/`, starts `claude`
5. Starts inbox watchers for all 3 agents + human
6. Sends initial briefing to each agent with the project path and context
7. Registers the project in the active projects list

## Workflow

### 1. Validate prerequisites

- Check the project path exists
- Check if the project has been initialized (`docs/inbox/` exists). If not, run `scripts/init-project.sh`
- Check if a tmux session with this name already exists (error if so — use `/triad:resume` instead)

### 2. Create the tmux session

```bash
TOOLKIT="$(pwd)"  # should be the ai-toolkit root
SESSION="<org/repo>"

# Create session with first pane (PM)
tmux new-session -d -s "$SESSION" -c "$TOOLKIT/agents/product-manager"

# Split for PgM
tmux split-window -t "$SESSION" -h -c "$TOOLKIT/agents/program-manager"

# Split for EM
tmux split-window -t "$SESSION" -v -c "$TOOLKIT/agents/engineering-manager"

# Even out the layout
tmux select-layout -t "$SESSION" main-vertical
```

### 3. Start Claude Code in each pane (sandboxed)

Agents run inside Agent Safehouse (`safehouse`) with `--dangerously-skip-permissions`. Safehouse provides a deny-by-default macOS sandbox that confines filesystem access to the workdir and explicitly granted directories. This eliminates approval prompts while keeping agents contained.

**Required grants:**
- `--workdir=$PROJECT_PATH` — the target project gets read/write
- `--add-dirs=$HOME/code` — all project repos get read/write (agents need cross-project access for the toolkit, templates, and sibling repos)
- `--add-dirs-ro=$HOME/vault` — PM reads the knowledge vault (read-only)

```bash
SAFE_CMD="safehouse --workdir=$PROJECT_PATH --add-dirs=$HOME/code --add-dirs-ro=$HOME/vault --"

tmux send-keys -t "$SESSION.0" "$SAFE_CMD claude --dangerously-skip-permissions" Enter
tmux send-keys -t "$SESSION.1" "$SAFE_CMD claude --dangerously-skip-permissions" Enter
tmux send-keys -t "$SESSION.2" "$SAFE_CMD claude --dangerously-skip-permissions" Enter
```

If safehouse is not installed (`which safehouse` fails), fall back to plain Claude without sandbox or permission bypass:

```bash
tmux send-keys -t "$SESSION.0" "claude" Enter
tmux send-keys -t "$SESSION.1" "claude" Enter
tmux send-keys -t "$SESSION.2" "claude" Enter
```

Wait ~10 seconds for Claude to initialize.

### 4. Start inbox watchers

```bash
nohup "$TOOLKIT/scripts/inbox-watcher.sh" "$PROJECT_PATH" product-manager "$SESSION.0" > /tmp/claude/watcher-pm-${SESSION//\//-}.log 2>&1 &
nohup "$TOOLKIT/scripts/inbox-watcher.sh" "$PROJECT_PATH" program-manager "$SESSION.1" > /tmp/claude/watcher-pgm-${SESSION//\//-}.log 2>&1 &
nohup "$TOOLKIT/scripts/inbox-watcher.sh" "$PROJECT_PATH" engineering-manager "$SESSION.2" > /tmp/claude/watcher-em-${SESSION//\//-}.log 2>&1 &
```

### 5. Send initial briefings

Wait for Claude to fully load (~15 seconds), then send briefings:

**PM (pane 0):**
```
We're working on <org/repo> at <project-path>. <briefing if provided, otherwise: "Check your context file and inbox, then let me know when you're ready.">
```

**PgM (pane 1):**
```
We're working on <org/repo> at <project-path>. The PM is starting work on this project. Create a context file if you don't have one, then monitor your inbox at <project-path>/docs/inbox/program-manager/unread/ for incoming messages.
```

**EM (pane 2):**
```
We're working on <org/repo> at <project-path>. The PM and PgM are working upstream. Create a context file if you don't have one, then monitor your inbox at <project-path>/docs/inbox/engineering-manager/unread/ for incoming messages. You'll receive project-ready messages when projects are approved.
```

### 6. Register the project

Write an entry to `docs/active-projects.md` (create if doesn't exist):

```markdown
| Session | Project Path | Started | Status |
|---|---|---|---|
| <org/repo> | <project-path> | <date> | active |
```

### 7. Report

```
Triad session started: <org/repo>
  PM:  pane 0 (agents/product-manager/)
  PgM: pane 1 (agents/program-manager/)
  EM:  pane 2 (agents/engineering-manager/)
  Watchers: 3 running (PIDs in /tmp/claude/watcher-*.log)

Attach: tmux attach -t '<org/repo>'
```
