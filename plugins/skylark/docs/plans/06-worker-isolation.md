# Domain 6 — Worker Isolation & Workspace Configuration

**Scope:** Sandbox configuration, permission allow-lists, hook scripts, network policy, devcontainer setup, and subagent permission workarounds for the composed pipeline.

**Prerequisites:**
- Domain 3 (Worker Dispatch) defines the worktree lifecycle — specifically the `.worktrees/TASK-NNN-<slug>/` path convention and the `DISPATCH_WORKER` / `WORKER_COMPLETE` contract.
- Claude Code CLI installed (`claude` binary on PATH).
- `jq` available on the host (used by hook scripts).

**Key sources:**
- `docs/research/claude-code-sandbox-ergonomics-report.md` — referred to below as "the sandbox report." Contains complete recommended configurations that this plan adapts rather than reinvents.
- `docs/spec/05-worker-execution.md` — the worker execution spec. Defines CLI flags, worktree conventions, and tool scoping.
- `docs/research/criteria-review/09-environment-isolation.md` — the 16 best-practice requirements this domain must satisfy.

---

## Task 1: User-Scope Settings — Permission Allow-List and Sandbox Configuration

### Description

Write `~/.claude/settings.json` with the composed pipeline's permission allow-list, sandbox configuration, and hook references. This is the single most important file in the domain because user-scope settings are the only scope that reliably propagates to subagents (bug #37730 workaround).

The sandbox report's "Proposed Configuration for Your Environment" section (Section 7, final heading) contains a comprehensive recommended `settings.json`. This task adapts it for the composed pipeline with the following modifications:

1. **Add `Bash(git worktree *)` explicitly** — the worker dispatch harness creates and removes worktrees. This must be in the allow-list even though `Bash(git *)` covers it, because pattern specificity matters for audit clarity.

2. **Remove deployment/infra domains from the network allow-list** (`*.railway.app`, `api.cloudflare.com`, `*.neon.tech`, `api.upstash.com`, `*.upstash.io`, `*.supabase.co`, `*.supabase.in`, `api.stripe.com`, `api.workos.com`). Workers do not deploy. These belong in a separate deployment-mode profile, not the default worker profile. The sandbox report includes them because it targets interactive use; the pipeline does not need them.

3. **Add `Bash(xstate *)` and `Bash(tsx *)`** — the orchestrator (Layer 2) uses XState and the harness scripts use tsx.

4. **Keep `Bash(gh pr *)` and `Bash(gh issue *)` but NOT `Bash(gh *)`** — workers should not run arbitrary gh commands. Only PR and issue operations are needed for the finish stage.

5. **Set `sandbox.filesystem.allowWrite`** to include `.worktrees/` relative to the project root — the worker dispatch harness writes worktrees here.

6. **Add `Bash(rm -rf .worktrees/TASK-*)`** to the allow-list — worktree cleanup requires this pattern. The pre-bash firewall (Task 2) will still block `rm -rf /` and `rm -rf ~`.

### Files to create/modify

| File | Action |
|------|--------|
| `~/.claude/settings.json` | Create or merge. If the file already exists, merge arrays (allow-list entries are additive). Do not overwrite existing deny rules. |

### Acceptance criteria

- [ ] `sandbox.enabled` is `true`
- [ ] `sandbox.autoAllowBashIfSandboxed` is `true`
- [ ] `sandbox.failIfUnavailable` is `true`
- [ ] Permission allow-list includes all tools from the sandbox report's recommended config (git, node, pnpm, python, go, gh, common CLI)
- [ ] Permission deny-list includes secrets patterns (`.env`, `.ssh`, `.aws`, `secrets/`)
- [ ] Network allow-list includes: package registries (npm, pypi, golang), git hosts (github.com, api.github.com), Anthropic API, Linear API, docs sites (MDN, nodejs.org). Does NOT include deployment infrastructure.
- [ ] Hooks section references `~/.claude/hooks/pre-bash-firewall.sh` and `~/.claude/hooks/audit-logger.sh`
- [ ] `docker` is in `sandbox.excludedCommands` (requires interactive approval)
- [ ] Validation: run `claude --bare -p "echo hello" --output-format json` in the project directory and confirm it executes without permission prompts

### Dependencies

None (this is the foundation all other tasks depend on).

### Estimated scope

Small. Mostly transcribing and adapting the sandbox report's recommended config. The main work is deciding which domains to include/exclude.

---

## Task 2: Pre-Bash Firewall Hook

### Description

Install the pre-bash firewall hook that blocks destructive shell patterns before they execute. The sandbox report's Section 3 contains the complete script. This task installs it verbatim with one addition: a pattern to block `rm -rf` on the git object store (`.git/objects`, `.git/refs`) which protects the shared object store that all worktrees depend on.

The hook reads the tool input JSON from stdin, extracts the `command` field, and matches it against a deny-pattern list. If any pattern matches, the hook exits with code 2 (which Claude Code interprets as "deny this tool call"). Otherwise it exits 0 (no opinion — defer to the permission system).

### Files to create/modify

| File | Action |
|------|--------|
| `~/.claude/hooks/pre-bash-firewall.sh` | Create. Source: sandbox report Section 3, "Pre-bash firewall" script. |

### Acceptance criteria

- [ ] File exists at `~/.claude/hooks/pre-bash-firewall.sh`
- [ ] File is executable (`chmod +x`)
- [ ] Blocks all patterns from the sandbox report: `rm -rf /`, `rm -rf ~`, `rm -rf $HOME`, `git push.*--force`, `git push.*-f `, `git reset --hard`, `git clean -fd`, `DROP TABLE`, `DROP DATABASE`, `TRUNCATE `, `chmod 777`, `chmod -R 777`, `| sh`, `| bash`, `curl.*| sh`, `wget.*| sh`, `npm publish`, `npm login`, `npm adduser`, `pnpm publish`
- [ ] Additionally blocks: `rm -rf .git/objects`, `rm -rf .git/refs` (git object store protection)
- [ ] Does NOT block: `rm -rf .worktrees/TASK-*` (worktree cleanup is legitimate)
- [ ] Validation: pipe a test JSON payload with `command: "rm -rf /"` through the script and confirm exit code 2. Pipe `command: "ls -la"` and confirm exit code 0.

### Dependencies

None (can be done in parallel with Task 1).

### Estimated scope

Small. Copy from the sandbox report, add two patterns, test.

---

## Task 3: Audit Logger Hook

### Description

Install the audit logger hook that records every tool call to `~/.claude/audit.log`. The sandbox report's Section 3 contains the complete script. Install it verbatim.

The hook runs asynchronously (`"async": true` in the settings.json hook config) so it does not slow down the agent loop. It captures: ISO timestamp, session ID, tool name, and a truncated (500-char) summary of the tool input.

The log file grows unbounded. A companion logrotate config or a periodic truncation cron job is recommended but out of scope for this task (note for operational runbook).

### Files to create/modify

| File | Action |
|------|--------|
| `~/.claude/hooks/audit-logger.sh` | Create. Source: sandbox report Section 3, "Audit logger" script. |

### Acceptance criteria

- [ ] File exists at `~/.claude/hooks/audit-logger.sh`
- [ ] File is executable (`chmod +x`)
- [ ] Writes one line per invocation to `~/.claude/audit.log`
- [ ] Line format: `<ISO-timestamp>|<session-id>|<tool-name>|<tool-input-json-truncated>`
- [ ] Handles missing fields gracefully (jq defaults to `"unknown"` / `"?"`)
- [ ] Validation: pipe a test JSON payload through the script. Confirm `~/.claude/audit.log` contains the expected line.

### Dependencies

None (can be done in parallel with Tasks 1 and 2).

### Estimated scope

Small. Direct copy from the sandbox report.

---

## Task 4: Per-Worktree Settings Generator

### Description

Create a function in the worker dispatch harness (Domain 3) that writes a `.claude/settings.json` inside each worktree when it is created. This per-worktree settings file provides defense-in-depth scoping for the worker session. It does NOT replace the user-scope settings (Task 1) — it narrows them.

**Why per-worktree settings exist despite bug #37730:** The bug means subagents may not pick up project-scoped settings. But the worker itself (the top-level `claude` process running in the worktree) DOES load its local `.claude/settings.json`. The risk is that the worker's own subagents (if it spawns any via the Agent tool) may not inherit. Since workers are run with `--bare` and have `Skill` denied (spec Section 9), they should not spawn subagents. The per-worktree settings are a second layer, not the primary one.

The per-worktree settings file should contain:

1. **`allowedTools`** — mirrors the spec's default tool set: `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`. Denies: `WebSearch`, `WebFetch`, `Skill`, `NotebookEdit`, `Agent` (workers do not spawn sub-agents).

2. **`deniedMcpServers`** — deny all MCP servers by default. Workers run with `--bare` which already disables MCP, but this is belt-and-suspenders.

3. **`sandbox.filesystem.allowWrite`** — scoped to the worktree path itself. The worker should not write outside its worktree.

4. **Risk-based tool restrictions** — for `trivial` risk tasks without a `testStrategy`, remove `Bash` from allowed tools (spec Section 9).

### Files to create/modify

| File | Action |
|------|--------|
| `src/worker/worktree-settings.ts` (or equivalent in the Domain 3 harness) | Create. Function: `writeWorktreeSettings(worktreePath: string, riskLevel: string, hasTestStrategy: boolean): void` |
| `.worktrees/TASK-NNN-<slug>/.claude/settings.json` | Created at runtime by the function above. Not committed to the repo. |

### Acceptance criteria

- [ ] Function generates valid JSON matching the Claude Code settings schema
- [ ] `allowedTools` matches the spec's Section 9 for each risk level
- [ ] `deniedMcpServers` contains a wildcard deny-all pattern
- [ ] `sandbox.filesystem.allowWrite` is scoped to the worktree path
- [ ] Trivial-risk tasks without `testStrategy` have `Bash` removed from `allowedTools`
- [ ] The settings file is written inside `<worktree>/.claude/settings.json` before the CLI session starts (i.e., between Step 2 and Step 4 of the worker lifecycle in spec Section 4)
- [ ] Validation: create a test worktree, run the function, confirm the settings file exists and parses as valid JSON

### Dependencies

- Task 1 (user-scope settings must exist first so we know what we are narrowing)
- Domain 3 (Worker Dispatch) must define the worktree creation function that this integrates into

### Estimated scope

Medium. Requires a TypeScript function, risk-level branching logic, and integration with the worktree creation step.

---

## Task 5: MCP Server Isolation Configuration

### Description

Configure which MCP servers are available to workers and to the orchestrator. The spec (Section 9) states workers run with `--bare`, which disables all MCP servers. This task makes that explicit and adds guardrails for the orchestrator session, which DOES have MCP access.

**Worker sessions:** No MCP access. Enforced by `--bare` flag and by `deniedMcpServers: ["*"]` in the per-worktree settings (Task 4). No additional configuration needed.

**Orchestrator session:** Has access to Taskmaster MCP (for task DAG operations) and Linear MCP (for issue tracking). This task creates a PreToolUse hook that gates destructive MCP tool calls. The sandbox report's Section 5 contains a template hook script.

Destructive MCP tools to deny:
- `mcp__linear__delete_issue`
- `mcp__linear__delete_comment`
- `mcp__github__delete_repository`
- `mcp__github__merge_pull_request` (merges go through git, not the GitHub API)

### Files to create/modify

| File | Action |
|------|--------|
| `~/.claude/hooks/mcp-tool-gate.sh` | Create. PreToolUse hook that denies destructive MCP operations. Based on the sandbox report Section 5 template. |
| `~/.claude/settings.json` | Modify (add the MCP gate hook to the `PreToolUse` hooks array with `matcher: "mcp__.*"`). |

### Acceptance criteria

- [ ] `mcp-tool-gate.sh` exists and is executable
- [ ] Hook denies the four destructive MCP tools listed above
- [ ] Hook allows all other MCP tools (read operations, create operations)
- [ ] Settings.json PreToolUse array includes the MCP gate with matcher `mcp__.*`
- [ ] Validation: pipe a test payload with `tool_name: "mcp__linear__delete_issue"` and confirm exit code 2. Pipe `tool_name: "mcp__linear__list_issues"` and confirm exit code 0.

### Dependencies

- Task 1 (settings.json must exist to add the hook reference)

### Estimated scope

Small. Template from the sandbox report, enumerate the deny list, wire into settings.

---

## Task 6: Devcontainer Configuration for Unattended Pipelines

### Description

Create a devcontainer configuration for running the composed pipeline unattended. Based on Anthropic's reference devcontainer (cited in sandbox report Section 7) but adapted for the Skylark pipeline.

Inside the container, `--dangerously-skip-permissions` is safe because the container IS the security boundary. The sandbox is redundant inside the container, but the pre-bash firewall hook (Task 2) still runs as defense-in-depth.

The devcontainer consists of three files:

**`devcontainer.json`:**
- Base image: Node 22 LTS + Python 3.12 + Go 1.22 (multi-runtime for the composed pipeline)
- Install: Claude Code CLI, pnpm, gh CLI, jq, git
- Mount: the project directory as the workspace
- Post-create command: install project dependencies, copy hook scripts into the container's `~/.claude/hooks/`
- Features: `ghcr.io/devcontainers/features/node`, `ghcr.io/devcontainers/features/python`, `ghcr.io/devcontainers/features/go`

**`Dockerfile`:**
- FROM the devcontainer base image
- Install Claude Code via npm
- Copy `init-firewall.sh` and make executable
- Set `CLAUDE_CODE_SKIP_PERMISSIONS=1` environment variable
- Create `~/.claude/hooks/` directory and copy hook scripts

**`init-firewall.sh`:**
- iptables rules with default-deny egress policy
- Allow-list mirrors the sandbox network config from Task 1 (package registries, git hosts, Anthropic API, Linear API)
- Additionally allows DNS (port 53 to system resolver)
- Runs as root during container init (before dropping to the dev user)

### Files to create/modify

| File | Action |
|------|--------|
| `.devcontainer/devcontainer.json` | Create |
| `.devcontainer/Dockerfile` | Create |
| `.devcontainer/init-firewall.sh` | Create |

### Acceptance criteria

- [ ] `devcontainer.json` is valid JSON and specifies all required tools
- [ ] `Dockerfile` builds successfully (`docker build .devcontainer/`)
- [ ] `init-firewall.sh` is executable and sets iptables default-deny with explicit allows
- [ ] Inside the container: `claude --version` succeeds
- [ ] Inside the container: `pnpm --version`, `node --version`, `python3 --version`, `go version`, `gh --version`, `jq --version` all succeed
- [ ] Inside the container: `curl https://registry.npmjs.org` succeeds (allowed domain)
- [ ] Inside the container: `curl https://example.com` fails (blocked domain)
- [ ] Inside the container: hook scripts exist at `~/.claude/hooks/` and are executable
- [ ] The container can run `claude --dangerously-skip-permissions -p "echo hello" --output-format json` and return valid JSON

### Dependencies

- Tasks 1-3 (settings and hook scripts must be defined so the Dockerfile can copy them)

### Estimated scope

Medium. Three files, but the Dockerfile and firewall script require iterative testing to get domain resolution and iptables rules correct. Docker build + runtime testing needed.

---

## Task 7: Devcontainer Network Firewall

### Description

Write the `init-firewall.sh` iptables rules. This is the container-level equivalent of the sandbox network allow-list but enforced at the kernel level rather than the application level. The sandbox report (Section 7) describes Anthropic's reference approach.

**Domain resolution strategy:** iptables works with IP addresses, not domain names. The firewall script must resolve domains to IPs at container init time using `dig` or `getent hosts`. For CDN-backed domains (npm registry, GitHub), the IPs change frequently. Two approaches:

1. **DNS-based (recommended for this pipeline):** Allow all traffic to port 443 (HTTPS) and port 80 (HTTP), but only to resolved IPs of the allowed domains. Re-resolve periodically via a cron job inside the container.

2. **Proxy-based (more robust but more complex):** Route all HTTP/HTTPS traffic through a local proxy (squid, mitmproxy) that enforces domain-level allow-lists. This handles CDN IP rotation but adds operational complexity.

For the initial implementation, use approach 1 (DNS-based) with a generous TTL on the cron re-resolution (every 30 minutes).

**Allowed domains** (must match Task 1 network allow-list):
- `registry.npmjs.org`, `*.npmjs.org`
- `pypi.org`, `files.pythonhosted.org`
- `proxy.golang.org`, `sum.golang.org`, `storage.googleapis.com`
- `github.com`, `api.github.com`
- `api.anthropic.com`
- `api.linear.app`

### Files to create/modify

| File | Action |
|------|--------|
| `.devcontainer/init-firewall.sh` | Create (same file as Task 6, but this task defines the iptables content in detail) |

### Acceptance criteria

- [ ] Default policy is DROP for OUTPUT chain
- [ ] Loopback (127.0.0.1) is allowed
- [ ] DNS (UDP/TCP port 53) is allowed to the container's resolver
- [ ] All domains from the allowed list resolve and have iptables ACCEPT rules
- [ ] A domain NOT on the list (e.g., `example.com`) is blocked
- [ ] The script is idempotent (running it twice does not create duplicate rules)
- [ ] A cron entry or systemd timer re-resolves domains every 30 minutes

### Dependencies

- Task 6 (this is the detailed implementation of the firewall script referenced in the Dockerfile)

### Estimated scope

Medium. iptables rule generation from domain names requires careful handling of DNS resolution failures and IPv4/IPv6 dual-stack. Needs testing inside a running container.

---

## Task 8: Pipeline Launcher Script

### Description

Create a script that starts the composed pipeline inside the devcontainer, mounts the project directory, and streams output to the host. The user runs this script from the host machine, walks away, and checks results later.

The script should:

1. Build the devcontainer image if not already built
2. Start the container with the project directory bind-mounted at `/workspace`
3. Run `init-firewall.sh` inside the container (requires `--cap-add=NET_ADMIN`)
4. Execute the pipeline entry point (`claude --dangerously-skip-permissions -p "<pipeline-prompt>" --output-format json`)
5. Stream stdout/stderr to both the terminal and a log file on the host
6. On completion, copy `.skylark/results/` and `.skylark/verdicts/` from the container to the host project directory
7. Print a summary: total cost, duration, tasks completed, tasks failed
8. Optionally tear down the container (`--keep` flag to preserve for debugging)

### Files to create/modify

| File | Action |
|------|--------|
| `scripts/run-pipeline.sh` | Create. The host-side launcher. |

### Acceptance criteria

- [ ] Script runs from the project root on the host machine
- [ ] Builds the devcontainer image if missing
- [ ] Mounts the project directory read-write at `/workspace`
- [ ] Runs `init-firewall.sh` before the pipeline starts
- [ ] Streams output to terminal AND to `logs/pipeline-<timestamp>.log`
- [ ] Copies result artifacts to the host on completion
- [ ] Prints a cost/duration summary
- [ ] `--keep` flag preserves the container; default is teardown
- [ ] `--dry-run` flag prints the docker command without executing
- [ ] Exit code 0 on success, non-zero on failure

### Dependencies

- Tasks 6 and 7 (devcontainer must be defined)

### Estimated scope

Medium. Shell scripting with docker run commands, output tee-ing, artifact copying, and argument parsing.

---

## Task 9: Proxmox LXC Alternative Documentation

### Description

Document the Proxmox LXC container approach as an alternative to the Docker devcontainer. The sandbox report (Section 7, "Recommended approach for your Proxmox homelab") outlines the approach. This task creates a short operational guide with concrete commands.

The LXC approach is equivalent to the devcontainer but avoids Docker-in-Docker overhead and leverages existing Proxmox infrastructure. The guide should cover:

1. **LXC container creation** — `pct create` with Ubuntu 24.04 template, 4GB RAM, 20GB disk
2. **Bind mount** — mount the project directory from the host into the container
3. **Toolchain installation** — Node 22, Python 3.12, Go 1.22, Claude Code CLI, pnpm, gh, jq
4. **Firewall rules** — Proxmox firewall (iptables-based) rules equivalent to `init-firewall.sh`
5. **Running the pipeline** — `pct exec` to run the pipeline inside the container
6. **Firewalla Gold integration** — optional: network isolation at the router level for defense-in-depth

### Files to create/modify

| File | Action |
|------|--------|
| `.devcontainer/PROXMOX-ALTERNATIVE.md` | Create. Operational guide for the LXC approach. |

### Acceptance criteria

- [ ] Document provides complete `pct create` command with all parameters
- [ ] Bind mount configuration is specified
- [ ] Firewall rules match the devcontainer's `init-firewall.sh` allowed domains
- [ ] The pipeline can be launched via `pct exec` with the same entry point as the Docker approach
- [ ] Document notes trade-offs vs. devcontainer (no Docker overhead, but requires Proxmox host, not portable)

### Dependencies

- Tasks 6 and 7 (must understand the devcontainer approach to describe the equivalent)

### Estimated scope

Small. Documentation task, no code. The sandbox report already describes the approach; this task makes it concrete and actionable.

---

## Task 10: Integration Verification

### Description

End-to-end verification that all isolation layers work together. This is not a unit test task — it is a manual (or scripted) integration check that confirms the full isolation stack functions correctly.

**Interactive mode checks:**

1. Start a Claude Code session in the project directory.
2. Confirm sandbox is active (`sandbox.enabled: true` in effective config).
3. Confirm `autoAllowBashIfSandboxed` eliminates bash permission prompts.
4. Confirm the pre-bash firewall blocks `rm -rf /` (run it, expect denial).
5. Confirm the audit logger writes to `~/.claude/audit.log`.
6. Confirm network access to `registry.npmjs.org` succeeds.
7. Confirm network access to `example.com` is blocked (if sandbox network isolation is active on the platform).
8. Create a test worktree, confirm per-worktree settings are written by the harness.
9. Run a worker session in the worktree, confirm it completes without permission prompts.
10. Confirm the MCP tool gate blocks `mcp__linear__delete_issue`.

**Unattended mode checks:**

11. Build the devcontainer.
12. Run the pipeline launcher script with a trivial task.
13. Confirm the firewall blocks egress to non-allowed domains.
14. Confirm the pipeline completes and artifacts are copied to the host.
15. Tear down the container, confirm no state leaks.

### Files to create/modify

| File | Action |
|------|--------|
| `scripts/verify-isolation.sh` | Create. Automated smoke test for the interactive-mode checks (items 1-10). |

### Acceptance criteria

- [ ] All 10 interactive-mode checks pass
- [ ] All 5 unattended-mode checks pass
- [ ] `verify-isolation.sh` can be re-run idempotently
- [ ] Failures produce clear error messages indicating which check failed and why

### Dependencies

- All prior tasks (1-9)

### Estimated scope

Medium. Scripting the verification checks, running them, debugging any failures. This is the "shake the tree" task that surfaces integration issues.

---

## Execution Order

Tasks can be parallelized as follows:

```
Phase 1 (no dependencies — run in parallel):
  Task 1: User-scope settings.json
  Task 2: Pre-bash firewall hook
  Task 3: Audit logger hook

Phase 2 (depends on Phase 1):
  Task 4: Per-worktree settings generator  [depends on Task 1, Domain 3]
  Task 5: MCP server isolation             [depends on Task 1]

Phase 3 (depends on Phase 1):
  Task 6: Devcontainer configuration       [depends on Tasks 1-3]
  Task 7: Devcontainer network firewall    [depends on Task 6]

Phase 4 (depends on Phase 3):
  Task 8: Pipeline launcher script         [depends on Tasks 6-7]
  Task 9: Proxmox LXC alternative          [depends on Tasks 6-7]

Phase 5 (depends on all):
  Task 10: Integration verification        [depends on Tasks 1-9]
```

---

## Cross-Cutting Concerns

### Bug #37730 mitigation strategy

The subagent permission inheritance bug affects any Claude Code session that spawns sub-agents. Our mitigation is layered:

1. **Primary:** All critical permissions live in `~/.claude/settings.json` (user scope). User-scope settings are loaded regardless of working directory path. (Task 1)
2. **Secondary:** `autoAllowBashIfSandboxed: true` eliminates bash permission prompts entirely when the sandbox is active, sidestepping the per-command inheritance issue. (Task 1)
3. **Tertiary:** Workers run with `--bare` and have `Agent` and `Skill` in their denied tools list, so they should not spawn sub-agents at all. (Task 4, spec Section 9)
4. **Monitoring:** The audit logger (Task 3) records all tool calls. If a sub-agent permission prompt occurs, it will appear as a gap in the audit log (the sub-agent's session ID will differ from the parent's).

### MCP servers run outside the sandbox

The sandbox report (Section 8, "What's Worth Rebuilding") notes that MCP servers are separate processes not subject to the sandbox's network restrictions. The container approach (Tasks 6-7) solves this because the container's iptables rules apply to ALL processes, including MCP servers. For interactive mode, the MCP tool gate hook (Task 5) is the only mitigation.

### Worktree path resolution for project settings

The sandbox report (Section 4) identifies that project-scoped settings (`~/.claude/projects/<path>/settings.json`) fail for worktrees because the path differs from the main working tree. The per-worktree settings (Task 4) work around this by writing a `.claude/settings.json` INSIDE the worktree itself, which is a project-scope file that resolves correctly because it is relative to the worktree root, not an absolute path in `~/.claude/projects/`.

### Build artifact isolation between worktrees

Each worktree has its own `node_modules/`, `.next/`, `dist/`, etc. because these directories are inside the worktree's filesystem subtree. The `.worktrees/` directory is in `.gitignore` (spec Section 7). No additional configuration is needed, but the devcontainer's disk allocation (Task 6) must account for multiple worktrees each with their own `node_modules/` — budget at least 2GB per concurrent worktree for a typical Node project.

### Credential injection

This plan does not cover credential injection (API keys, tokens). The sandbox report notes this as an open question. For the initial implementation, credentials are inherited from the host environment (interactive mode) or passed as Docker environment variables (unattended mode). A dedicated secrets management task should be added when the pipeline handles credentials for deployment or external service access.
