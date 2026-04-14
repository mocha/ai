# Three-Agent System Design

> Persistent multi-agent development workflow for dogproj, running on code.lan homelab server with Signal-based human interface.

**Date**: 2026-03-22
**Status**: Draft (rev 2 — post spec review)
**Author**: Patrick Deuley + Claude (brainstorming session)
**Depends on**: PM Agent Decision Framework (2026-03-21)
**Supersedes**: Escalation routing in the 2026-03-21 decision framework spec (Section 2 here is authoritative)
**Naming note**: The PM agent project is called "tron" on the laptop (`~/code/tron/`) and "deuleytron" on code.lan (`~/code/deuleytron/`). These are the same thing — the code.lan copy was deployed from `tron/` via the NanoClaw deploy bundle. This spec uses "deuleytron" for the runtime directory on code.lan and "tron" for the source on the laptop.

---

## 1. Problem Statement

Three needs that are currently unmet:

1. **The engineering agent gets blocked** on product/business questions and has no way to get answers without Patrick's direct involvement.
2. **Patrick can't close his laptop** without stopping all agent work — everything runs locally today.
3. **The PM agent is a bad chatbot** — its analytical personality makes for an unpleasant Signal conversation, but its decision-making capability is valuable.

## 2. Architecture Overview

Three agents with distinct roles, all running on code.lan:

| Agent | Role | Interface | Personality |
|-------|------|-----------|-------------|
| **Domo** (NanoClaw) | Patrick's majordomo — assistant, relay, note-taker | Signal (conversational) | Friendly, concise |
| **Deuleytron** (PM Agent) | Analytical decision engine | Headless (no direct chat) | Structured, conservative |
| **Engineering Agent** | Dev worker orchestrator | tmux session (SSH) | Task-focused |

```
code.lan
├── NanoClaw (systemd service, Signal)
│   ├── Talks to Patrick via Signal
│   ├── Reads/writes ~/vault/todos.md (Obsidian Sync to phone)
│   ├── Spawns PM agent as container task when needed
│   └── Relays PM results in conversational tone
│
├── PM Agent (spawned by NanoClaw, headless)
│   ├── git pull dogproj-app → scan for status: open decision docs
│   ├── Reads dogproj vault for business context
│   ├── Writes answers → git commit + push
│   ├── Logs to pm-agent.db
│   └── Reports results to NanoClaw via IPC
│
└── Engineering Agent (tmux session)
    ├── Runs in ~/code/dogproj-app
    ├── git push question docs when blocked
    ├── git pull to check for PM answers
    └── Moves to next unblocked task while waiting
```

### Communication flows

```
Eng agent writes _decisions/q6-foo.md (status: open)
  → git push
  → NanoClaw scheduled sweep detects new question (git pull + scan)
  → NanoClaw spawns PM agent container
  → PM agent reads dogproj vault, writes answer, git push
  → NanoClaw relays summary to Patrick via Signal
  → Eng agent git pulls, finds status: answered, resumes task
```

```
PM agent can't resolve (confidence < 85%)
  → Sets status: needs-escalation in decision doc, git push
  → NanoClaw sends Patrick: "Engineering has a question about X that
    the PM agent couldn't resolve. I dropped it in your todos."
  → Writes item to ~/vault/todos.md (syncs to phone via Obsidian)
  → Patrick answers via phone (Obsidian) or laptop (SSH + editor)
```

## 3. Sync Protocols

No Syncthing. Syncthing was considered but rejected because every data source already has a native sync mechanism, and adding Syncthing creates a second sync layer that conflicts with git (especially around `.git/`, `node_modules/`, and worktrees).

Each data type uses its native sync mechanism:

| Data | Mechanism | Direction |
|------|-----------|-----------|
| dogproj vault | Git push/pull | Laptop ↔ GitHub ↔ code.lan |
| dogproj-app code | Git push/pull | Laptop ↔ GitHub ↔ code.lan |
| ~/vault (personal) | Git push/pull | Laptop ↔ GitHub ↔ code.lan |
| Decision docs | Git (within dogproj-app) | Eng → GitHub → PM agent |
| PM answers | Git (within dogproj-app) | PM agent → GitHub → Eng |
| Alerts to Patrick | Signal (NanoClaw) | code.lan → Phone |
| Todos/notes | ~/vault/todos.md | NanoClaw writes on code.lan → git push → Patrick pulls on laptop/phone |

### Vault sync on code.lan

Obsidian Sync requires the Electron app and cannot run on a headless Linux server. Instead:

- **dogproj**: Already a git repo. Agents on code.lan do `git pull` before reading, `git push` after writing. Laptop syncs via Obsidian Sync to phone AND via git to code.lan — these are independent sync paths that don't conflict because agents only write to their own files (memory, decision docs) and the vault content is read-only to agents.
- **~/vault (personal)**: Initialize as a git repo if not already. NanoClaw writes to `todos.md`, commits, pushes. Patrick pulls on laptop where Obsidian Sync handles laptop↔phone. Alternatively, if ~/vault is not git-managed today, a cron rsync from laptop to code.lan (over Tailscale) is a simpler bootstrap.
- **dogproj-app**: Already git-managed. No special handling needed.

**Note on Obsidian Sync + git coexistence**: Obsidian Sync on the laptop/phone handles real-time sync between Patrick's devices. Git on code.lan handles sync with the server. These don't conflict as long as Patrick commits Obsidian changes before pushing. The `.obsidian/` directory should be in `.gitignore`.

## 4. Network Connectivity (PHASE 1 — CRITICAL PATH)

**Constraint**: Patrick is boarding a flight in ~3 hours. VPN must be working before then to enable continued work from the road.

### 4.1 Tailscale (Recommended)

Tailscale is a zero-config WireGuard mesh VPN. Install on code.lan + laptop + phone, get a private IP for each device. No port forwarding, works through NAT, survives network changes (airplane wifi, hotel, etc.).

**Why Tailscale over raw WireGuard**: No key management, no endpoint configuration, no port forwarding rules on the Firewalla. Tailscale handles NAT traversal automatically. Can be set up in under 15 minutes.

**Install on code.lan** (Ubuntu 25.04, x86_64):
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
```

The `--ssh` flag enables Tailscale SSH, so Patrick can SSH to code.lan via Tailscale IP without configuring SSH keys separately.

**Install on laptop** (macOS):
```bash
# Via Mac App Store or:
brew install --cask tailscale
```

**Install on phone**: Tailscale app from App Store.

**Post-install verification**:
```bash
# From laptop:
tailscale status          # see all devices
ssh code.lan              # should work via Tailscale
ssh deuley@<tailscale-ip> # fallback if mDNS doesn't resolve
```

**MagicDNS**: Tailscale provides DNS names automatically. code.lan may resolve as `code` on the tailnet. If not, use the Tailscale IP directly.

### 4.2 Firewall considerations

- Tailscale requires outbound HTTPS (443) — universally available, including airplane wifi
- No inbound port rules needed on Firewalla
- code.lan's Tailscale daemon maintains the tunnel persistently
- If Patrick's Firewalla blocks outbound connections from LXC containers, allow Tailscale traffic from code.lan (192.168.98.216)

### 4.3 What VPN enables

Once Tailscale is up:
- SSH to code.lan from anywhere (laptop, phone via Termius/Blink)
- tmux attach to engineering agent session
- Access NanoClaw logs and status
- git push/pull between laptop and code.lan repos
- All existing Signal communication continues to work (independent of VPN)

## 5. NanoClaw Configuration

### 5.1 Upstream consideration

The NanoClaw instance on code.lan has accumulated changes from multiple agent sessions. It may be worth pulling from upstream NanoClaw to reset to a known-good state before customizing.

**Assessment criteria** (check during implementation):
- Run `git diff origin/main --stat` in ~/nanoclaw to see scope of local changes
- If changes are primarily in `groups/`, `store/`, `.env`, and `deuleytron-deploy/` — these are configuration, not code changes. Keep them, no reset needed.
- If `src/` files have been modified significantly — consider resetting to upstream and reapplying only the configuration.
- If the build is broken or tests fail — reset to upstream.

**If reset is warranted**:
```bash
cd ~/nanoclaw
git stash  # preserve local config
git fetch origin
git reset --hard origin/main
npm install && npm run build
# Reapply: .env, groups/main/CLAUDE.md, mount-allowlist, registered groups
```

### 5.2 NanoClaw group CLAUDE.md rewrite

Strip the PM analysis personality from the main group CLAUDE.md. NanoClaw should be:
- Friendly and conversational
- Aware of `~/vault/todos.md` as the shared task list
- Able to search ~/vault on demand but not proactively loading it
- Capable of triggering PM agent sweeps (via scheduled task or on-demand spawn)
- Translating PM agent outputs into casual Signal messages

Key sections to include:
- Identity: Patrick's personal assistant (not PM proxy)
- Vault access: todos.md is home base, rest of vault is searchable
- PM agent relay: how to spawn, how to format results for Signal
- Escalation style: casual ("Hey, engineering has a question about X") not formal

### 5.3 Mount configuration

Create `~/.config/nanoclaw/mount-allowlist.json`:
```json
{
  "allowedRoots": [
    {
      "path": "~/vault",
      "allowReadWrite": true,
      "description": "Personal vault — agent writes to todos.md, reads on demand"
    },
    {
      "path": "~/code/deuleytron",
      "allowReadWrite": true,
      "description": "PM agent home: philosophy, memory, context"
    },
    {
      "path": "~/code/dogproj",
      "allowReadWrite": true,
      "description": "Pet care SaaS vault — PM agent reads for business context"
    },
    {
      "path": "~/code/dogproj-app",
      "allowReadWrite": true,
      "description": "Pet care SaaS codebase — PM agent writes to _decisions/ docs and commits via git"
    }
  ]
}
```

Note: dogproj-app must be read-write because `git commit` and `git push` write to the filesystem (`.git/` directory, index, objects). The PM agent only modifies files under `docs/projects/*/_decisions/` — this is enforced by the PM agent's CLAUDE.md authority boundaries, not by mount permissions. Git must be available in the container, and the repo must have push credentials configured (see Section 9: Resolved Questions).

### 5.4 PM agent as container task

The PM agent is NOT a NanoClaw chat group. It's a task that NanoClaw spawns:

**Scheduled sweep** (every 30 minutes on weekdays):
- NanoClaw scheduled task runs a container with PM agent CLAUDE.md
- Container mounts: deuleytron/ (rw), dogproj/ (rw), dogproj-app/ (ro)
- Prompt: pull dogproj-app, scan for `status: open` decision docs, process them
- Results reported via IPC message back to NanoClaw
- NanoClaw relays to Patrick if anything actionable

**On-demand** (Patrick says "check for questions"):
- NanoClaw spawns same container task immediately
- Same flow, just triggered by chat instead of cron

**Task prompt template**:
```
You are the PM agent (Deuleytron). Read your philosophy documents first:
1. /workspace/extra/deuleytron/philosophy/principles.md
2. /workspace/extra/deuleytron/philosophy/anti-patterns.md

Then:
1. cd /workspace/extra/dogproj-app && git pull origin main
2. Find all decision docs with status: open
3. For each, research the answer using /workspace/extra/dogproj/
4. Write your analysis and recommendation to the decision doc
5. Set status to 'answered' (if confidence >85%) or 'needs-escalation'
6. git add, commit, push
7. Log observations to /workspace/extra/deuleytron/memory/pm-agent.db
8. Send a summary of actions taken via send_message (NanoClaw built-in IPC: write JSON to /workspace/ipc/{groupFolder}/messages/{file}.json — NanoClaw's IPC watcher polls every 1s and delivers to the chat)
```

### 5.5 Git branch strategy

The PM agent and engineering agent both commit to dogproj-app. To avoid conflicts:

- **Engineering agent** works on feature branches (`feat/T005-whatever`), not main
- **PM agent** commits decision doc answers directly to `main` (small, isolated files in `_decisions/`)
- **Engineering agent** does `git pull origin main` before starting work, which picks up PM answers
- Decision docs live in `docs/projects/*/` which the engineering agent does not modify during feature work
- If a conflict does occur, the engineering agent resolves it (it has the fuller code context)

## 6. Engineering Agent Setup

### 6.1 Autonomy model

The engineering agent is **semi-autonomous, human-supervised**. It runs as a Claude Code session inside tmux on code.lan. Patrick directs it by attaching to the tmux session, giving instructions, and detaching. Between interactions, the agent works through its task queue autonomously (following the worktree/TDD workflow defined in dogproj-app's CLAUDE.md).

Key behaviors:
- **Autonomous**: picks up next unblocked task, creates worktrees, runs TDD cycle, commits, pushes question docs when blocked
- **Requires Patrick**: approval of one-way-door decisions, task prioritization, resolving merge conflicts, restarting after crashes
- **Session lifecycle**: if the Claude Code process exits (crash, token limit, inactivity), the tmux window shows a bash prompt. Patrick restarts it next time he attaches. NanoClaw can be configured to alert Patrick if the eng-agent tmux session has no running Claude process (future enhancement).

### 6.2 tmux session on code.lan

```bash
ssh code.lan
tmux new-session -s eng-agent
cd ~/code/dogproj-app
claude
```

**Prerequisite**: Claude Code CLI must be installed and authenticated on code.lan. Currently NOT installed — `claude` command not found.

### 6.3 Claude Code installation on code.lan

```bash
# Via nvm (already installed on code.lan)
source ~/.nvm/nvm.sh
npm install -g @anthropic-ai/claude-code
claude auth login
```

Claude Code requires its own authentication — it cannot share NanoClaw's OAuth token. Use `claude auth login` for the interactive OAuth flow, or set `ANTHROPIC_API_KEY` in the environment.

### 6.4 Engineering agent workflow

No changes needed — the engineering agent's workflow was updated earlier today to include:
- `status: open` frontmatter in decision docs
- git push after writing decision docs
- git pull before starting work to check for answers
- Move to next unblocked task while waiting

### 6.5 Persistent session

The tmux session persists across SSH disconnections. Patrick can:
- `ssh code.lan` + `tmux attach -t eng-agent` to check in
- Review agent output, approve decisions, redirect work
- Detach and the agent keeps running

## 7. PM Agent Database

The SQLite database at `~/code/deuleytron/memory/pm-agent.db` does not exist yet on code.lan. Create it using the schema from the deployment plan (DEPLOY.md Phase 1.4).

Tables: `observations`, `metrics`, `insights` with appropriate indexes.

## 8. Implementation Phases

Ordered by: critical path first (remote access), then independently useful milestones, then integration. Phases 1-3 must complete before the flight. Phases 4-6 can be done from the road.

### Phase 1: Network — VPN (DO FIRST — ~15 min)
1. Install Tailscale on code.lan
2. Install Tailscale on Patrick's laptop
3. Verify SSH via Tailscale from laptop to code.lan
4. Install Tailscale on phone (can do from airport)

**Exit criteria**: `ssh deuley@<tailscale-ip>` works from laptop when NOT on home LAN (test with wifi hotspot or disable LAN).

### Phase 2: Claude Code on code.lan (~10 min)
1. Install Claude Code CLI via npm (nvm already on code.lan)
2. Authenticate via `claude auth login`
3. Verify `claude --version` works

**Exit criteria**: Can launch Claude Code session on code.lan via SSH.

### Phase 3: Engineering agent session (~20 min)
1. Verify existing dogproj-app clone is current (`git pull`)
2. Install dependencies (`pnpm install`)
3. Configure git credentials for push (SSH key or token)
4. Set up tmux session (`tmux new-session -s eng-agent`)
5. Launch Claude Code, verify it can git push/pull
6. Reintegrate agent memory from `.claude-memory-export/` — follow the README in that directory (copy 14 memory files to Claude's memory path, verify)
7. Recreate Claude Code skills from `.claude/skills/` SKILL.md files (or let the agent rebuild them in the first session — they're simple enough)
8. Once memory is reintegrated and verified, remove `.claude-memory-export/` from the repo

**Exit criteria**: Engineering agent running in tmux with its memory restored, can create and push a test file. Patrick can detach, SSH back in from Tailscale, and reattach.

**At this point, Patrick can close the laptop and continue from the road.** The engineering agent is running, reachable via SSH+tmux over Tailscale, and NanoClaw is already sending Signal messages. Phases 4-6 are enhancements.

### Phase 4: NanoClaw reset assessment (~15 min, from the road)
1. Check `git diff origin/main --stat` in ~/nanoclaw
2. Decide: reset or keep (see Section 5.1 criteria)
3. If reset: `git stash`, reset, rebuild, `git stash pop` if upstream breaks
4. If keep: verify build and tests pass

**Exit criteria**: NanoClaw builds cleanly and starts without errors.

### Phase 5: NanoClaw reconfiguration (~45 min, from the road)
1. Rewrite main group CLAUDE.md (friendly assistant personality)
2. Create mount allowlist (`~/.config/nanoclaw/mount-allowlist.json`)
3. Create pm-agent.db with schema (from DEPLOY.md Phase 1.4)
4. Configure git credentials inside NanoClaw container for push access
5. Create PM agent sweep scheduled task (30-min cron)
6. Verify NanoClaw can spawn a PM agent container that reads vault files

**Exit criteria**: Send "check for questions" via Signal, PM agent container spawns, can read dogproj vault, and can git push to dogproj-app.

### Phase 6: End-to-end test (~15 min)
1. Engineering agent creates a test decision doc (status: open), pushes
2. Trigger PM agent sweep via Signal ("check for questions")
3. PM agent pulls, processes, writes answer, pushes
4. NanoClaw relays result to Patrick via Signal
5. Engineering agent pulls, sees answered doc

**Exit criteria**: Full round-trip works. Patrick gets a Signal message summarizing the PM agent's answer.

### Total estimated setup

- **Pre-flight (Phases 1-3)**: ~45 min — gives remote access + running engineering agent
- **From the road (Phases 4-6)**: ~75 min — NanoClaw + PM agent integration
- **Buffer**: remaining time for troubleshooting

## 9. Resolved Questions

These were open questions in the draft that have been resolved:

1. **Obsidian Sync on headless Linux**: Not feasible — Obsidian Sync requires the Electron app. Use git for all repos on code.lan. Obsidian Sync handles laptop↔phone independently. See Section 3.

2. **Claude Code auth on code.lan**: Claude Code needs its own auth — it cannot share NanoClaw's OAuth token. Use `claude auth login` (interactive OAuth flow) or set `ANTHROPIC_API_KEY` environment variable.

3. **Timezone for scheduled tasks**: Use CT/CDT (Patrick's local time). NanoClaw config supports timezone via `TIMEZONE` env var or system timezone on code.lan.

## 10. Open Questions

1. **Git credentials in NanoClaw containers**: The PM agent container needs to git push. Options: (a) mount `~/.ssh/` read-only into container, (b) set `GIT_TOKEN` env var and use HTTPS URLs with token auth, (c) configure git credential helper on the host and mount `~/.gitconfig`. Option (b) is simplest for containers. Investigate during Phase 5.

2. **Engineering agent model/cost**: Running a persistent Claude Code session on Opus 4.6 consumes tokens continuously. Recommend starting with Sonnet for the engineering orchestrator, Opus for the PM agent's analytical work. Revisit after one week of cost data.

3. **Vault sync for todos.md**: If ~/vault is not yet a git repo, the simplest bootstrap is to `git init` it on code.lan and set up a GitHub remote. NanoClaw writes to todos.md, commits, pushes. Patrick pulls on laptop. Alternatively, a cron rsync over Tailscale from laptop→code.lan works but is one-directional.

## 11. Future Considerations

- **IT agent specialization**: A dedicated agent with homelab context and infrastructure management rules. Not in scope for today, but the pattern (specialized CLAUDE.md + authority boundaries) matches the PM agent design.
- **Webhook-based triggers**: Instead of polling on a cron, a GitHub webhook could notify NanoClaw immediately when the engineering agent pushes a decision doc. Reduces latency from hours to seconds.
- **Engineering agent on NanoClaw**: Instead of a tmux session, the engineering agent could run as a NanoClaw group with its own container. This would give it the same lifecycle management (systemd, auto-restart, scheduling) as the PM agent. Trade-off: more complex container configuration vs. simpler tmux approach.
