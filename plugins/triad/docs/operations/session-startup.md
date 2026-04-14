# Session Startup Guide

How to start an agent triad session for a project.

## Prerequisites

- **tmux** -- terminal multiplexer for running agents in parallel sessions
- **fswatch** (macOS: `brew install fswatch`) or **inotifywait** (Linux: `sudo apt-get install inotify-tools`) -- filesystem watcher for inbox notifications
- **Claude Code** -- installed and authenticated
- **Project initialized** -- target project has been set up with `scripts/init-project.sh` (see [onboarding guide](onboarding.md))
- **Context files created** -- each agent has a context file in `agents/<role>/context/<project-name>.md`

## 1. Start tmux Sessions

Create one tmux session per agent:

```bash
tmux new-session -d -s pm
tmux new-session -d -s pgm
tmux new-session -d -s em
```

Attach to any session with `tmux attach -t <name>`.

## 2. Start Inbox Watchers

Each watcher monitors an agent's `docs/inbox/<agent>/unread/` directory and sends a tmux notification when a new message arrives.

```bash
# From the toolkit root
PROJECT="/path/to/dogproj-app"

./scripts/inbox-watcher.sh "$PROJECT" product-manager pm &
./scripts/inbox-watcher.sh "$PROJECT" program-manager pgm &
./scripts/inbox-watcher.sh "$PROJECT" engineering-manager em &
```

Each watcher runs in the background. It will print a log line and send keystrokes to the corresponding tmux session when a new file appears in the inbox.

## 3. Invoke Agents

Attach to each tmux session and start Claude Code from the agent's directory in the toolkit.

**Product Manager (pm):**

```bash
tmux attach -t pm
cd /path/to/ai-toolkit/agents/product-manager
claude

# Then tell the agent:
# "You are working on dogproj-app at /path/to/dogproj-app.
#  Your project context file is at agents/product-manager/context/dogproj-app.md.
#  Read it to get oriented."
```

**Program Manager (pgm):**

```bash
tmux attach -t pgm
cd /path/to/ai-toolkit/agents/program-manager
claude

# Then tell the agent:
# "You are working on dogproj-app at /path/to/dogproj-app.
#  Your project context file is at agents/program-manager/context/dogproj-app.md.
#  Read it to get oriented."
```

**Engineering Manager (em):**

```bash
tmux attach -t em
cd /path/to/ai-toolkit/agents/engineering-manager
claude

# Then tell the agent:
# "You are working on dogproj-app at /path/to/dogproj-app.
#  Your project context file is at agents/engineering-manager/context/dogproj-app.md.
#  Read it to get oriented."
```

Detach from any session with `Ctrl-b d`.

## 4. Kick Off Work

Either approach works:

- **Drop a directive** into the PM's inbox:
  ```bash
  cp my-directive.md /path/to/dogproj-app/docs/inbox/product-manager/unread/
  ```
  The watcher will notify the PM session automatically.

- **Start the PM manually** by telling it to begin a new proposal or work on a specific topic in the active session.

The PM will produce proposals and tasks that flow to the PgM and EM through the inbox system.

## 5. Monitor

Watch the human inbox for escalations and status updates:

```bash
# Optional symlink (set up once during onboarding)
ls ~/inbox/

# Or watch directly
ls /path/to/dogproj-app/docs/inbox/human/unread/
```

You can also peek at any agent's inbox to see message flow:

```bash
ls /path/to/dogproj-app/docs/inbox/*/unread/
```

## 6. Shut Down

Stop the inbox watchers:

```bash
# Kill all background watcher processes
pkill -f inbox-watcher.sh
```

End tmux sessions:

```bash
tmux kill-session -t pm
tmux kill-session -t pgm
tmux kill-session -t em
```

Or kill all three at once:

```bash
tmux kill-server
```

Note: this kills all tmux sessions, not just agent ones. Use `kill-session` if you have other tmux sessions running.

## Quick-Start Script

Save this as `scripts/start-triad.sh` and run with `./scripts/start-triad.sh /path/to/project`:

```bash
#!/usr/bin/env bash
# Quick start: agent triad for a project
PROJECT="${1:?Usage: $0 /path/to/project}"
TOOLKIT="$(cd "$(dirname "$0")/.." && pwd)"

# Start tmux sessions
tmux new-session -d -s pm
tmux new-session -d -s pgm
tmux new-session -d -s em

# Start inbox watchers
"$TOOLKIT/scripts/inbox-watcher.sh" "$PROJECT" product-manager pm &
"$TOOLKIT/scripts/inbox-watcher.sh" "$PROJECT" program-manager pgm &
"$TOOLKIT/scripts/inbox-watcher.sh" "$PROJECT" engineering-manager em &

echo "Sessions: pm, pgm, em"
echo "Attach: tmux attach -t pm"
```

After running the script, attach to each session and invoke Claude Code as described in step 3.
