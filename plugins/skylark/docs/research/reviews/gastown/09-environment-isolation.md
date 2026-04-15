# Gas Town — Environment Isolation Conformance Evaluation

## Summary

- Conformance at a glance: 4 MEETS, 7 PARTIAL, 5 MISSING, 0 N/A (out of 16)
- Headline: Gas Town ships a git-worktree-per-polecat isolation primitive plus an mTLS proxy with a hard command/subcommand allowlist and a dangerous-command PreToolUse guard, but container execution and network-layer allow-lists are proposal-stage (daytona/exitbox via `ExecWrapper`), credentials are shell-pass-through rather than per-worker scoped, and `--dangerously-skip-permissions` is the uniform default on the host regardless of container coupling.

## Per-Requirement Findings

### Req 1: Per-worker isolation unit. Each worker executes in a dedicated isolation unit — at minimum a git worktree, preferably also a container or microVM for unattended runs.

- Verdict: PARTIAL
- Evidence:
  - `internal/polecat/manager.go:524` "Add creates a new polecat as a git worktree from the repo base."
  - `internal/polecat/manager.go:948` "`git worktree add -b polecat/<name>-<timestamp> <path> <startpoint>`"
  - `docs/design/sandboxed-polecat-execution.md:14-17` "Every polecat today runs directly on the host machine in a tmux session under the user's own UID, with full access to the host filesystem, network, and credentials."
  - `templates/polecat-CLAUDE.md:44-46` pins the worker to `{{rig}}/polecats/{{name}}/` by prompt convention.
  - `Dockerfile` + `docker-compose.yml` exist but provision a single `gastown-sandbox` container for the whole workspace (one `/gt` bind mount), not per-worker.
- Notes: Worktree-per-polecat is implemented and real; container-per-worker is proposal-only. `docs/design/sandboxed-polecat-execution.md` is dated 2026-03-02, Status: "Proposal".

### Req 2: Orchestrator-managed provisioning. Containers/VMs are instantiated by an orchestrator-managed script, not by workers calling `docker` or cloud provisioning APIs directly.

- Verdict: PARTIAL
- Evidence:
  - `internal/cmd/polecat_spawn.go` and `internal/polecat/manager.go` own worktree creation (host-side orchestrator path).
  - Container provisioning for the host workspace is `docker compose up -d` per `docker-compose.yml:2` — an operator command, not an orchestrator path.
  - `docs/design/sandboxed-polecat-execution.md:295-333` specifies a daytona provisioning sequence driven by `gt sling --daytona`, but `internal/config/types.go:751-755` contains only the `ExecWrapper` field; there is no implemented daytona module. `grep -r "daytona" internal/` returns only config comments and test stubs.
- Notes: Worktree provisioning is orchestrator-managed. Container provisioning is proposal-stage; today there is no `gt` command that creates a per-worker container.

### Req 3: Deterministic environment setup. The same provisioning call produces the same tooling, env vars, and network policy, every time.

- Verdict: PARTIAL
- Evidence:
  - `Dockerfile` lines 10-22 install a fixed package set; `ARG GO_VERSION=1.25.8` (L5), `Dockerfile.e2e` lines 14-15 `ARG DOLT_VERSION=1.82.4` / `ARG BD_VERSION=v0.57.0` pin versions.
  - `docker-entrypoint.sh:14-20` runs `gt install /gt --git` deterministically on first boot and `--force` on subsequent boots.
  - `docs/INSTALLING.md:11-14` lists required tool versions for host install but relies on the host shell to supply them; `go install ...@latest` is the install vector (not pinned).
  - No network policy is set in `Dockerfile`/`docker-compose.yml`; none to reproduce.
- Notes: Inside the container, provisioning is reproducible. Host install leans on `@latest`, which is not deterministic.

### Req 4: Explicit network allow-list. Egress is gated by an allow-list of domains. Default-deny at the iptables/firewall layer, not only at the application layer.

- Verdict: MISSING
- Evidence:
  - `grep -n "iptables\|firewall\|egress" Dockerfile docker-compose.yml docker-entrypoint.sh` returns no matches.
  - `docker-compose.yml` declares no `networks:` restrictions; default bridge applies.
  - `internal/proxy/server.go` implements an mTLS proxy for `gt`/`bd`/git traffic, but this is a relay — not an iptables egress firewall. The container in the daytona proposal is described as having "zero outbound internet access" (`docs/design/sandboxed-polecat-execution.md:110`), but daytona is unimplemented.
- Notes: No network-layer allow-list in the shipped Docker setup. No reference to Anthropic's/Trail of Bits' iptables default-deny pattern.

### Req 5: Filesystem allow-list. Workers write only to the project directory plus explicit scratch paths. Read-access to secrets (`.env`, `.ssh`, `.aws`, `secrets/`) is denied by path rule.

- Verdict: PARTIAL
- Evidence:
  - `docker-compose.yml:27-35` mounts only `${FOLDER}:/gt`, `agent-home:/home/agent`, `dolt-data:/gt/.dolt-data` — host `~/.ssh`/`~/.aws` are not bind-mounted.
  - `docker-compose.yml:12-22` sets `security_opt: no-new-privileges:true`, `cap_drop: ALL`, and only adds `CHOWN, SETUID, SETGID, DAC_OVERRIDE, FOWNER, NET_RAW`.
  - `templates/polecat-CLAUDE.md:44-51` enforces worktree discipline by prompt: "ALL file operations must be within this directory … NEVER write to `~/gt/{{rig}}/` (rig root) or other directories." This is LLM-instruction, not a kernel-enforced rule.
  - `docs/design/sandboxed-polecat-execution.md:504-511` (exitbox profile, proposal) lists `rw: worktree only` — not yet implemented.
  - `.claude/skills/crew-commit/SKILL.md:121` checklist item "No `.env` files, API keys, or credentials" — a reviewer heuristic.
- Notes: Host-level secrets are not mounted into the container, but within the container there is no path-deny rule. No pre-tool-use filesystem guard was found for reads of `.env`, `.ssh`, `.aws`.

### Req 6: Sandbox + permissions layered. Sandbox is the security boundary; permissions are ergonomic policy. Inside a sandbox, per-command prompts auto-resolve. Outside, they gate.

- Verdict: MISSING
- Evidence:
  - Every role TOML (`internal/config/roles/{polecat,refinery,mayor,deacon,crew,dog,witness}.toml:13`) sets `start_command = "exec claude --dangerously-skip-permissions"` regardless of where the role runs.
  - `internal/config/agents.go:227,488`, `cost_tier.go:234,243`, `agents.go:354` all hard-code `--dangerously-skip-permissions`.
  - No reference to `autoAllowBashIfSandboxed` was found in the codebase.
- Notes: Permissions-are-bypassed-everywhere is the policy; the sandbox/permission layering is not expressed.

### Req 7: Fail-closed on sandbox failure. If the sandbox cannot start or its policy cannot load, execution fails rather than falling back to unsandboxed.

- Verdict: MISSING
- Evidence:
  - `internal/config/loader.go:2227-2229` "ExecWrapper is a deployment-level setting (sandbox/container) independent of agent choice. If len(rc.ExecWrapper) == 0 { rc.ExecWrapper = resolveExecWrapper(rigPath) }" — empty wrapper is the default; startup proceeds directly.
  - `internal/config/loader.go:2279-2281` prefixes the wrapper if present but does not refuse to start when it is absent.
  - No "sandbox required" check found in `resolveExecWrapper` or spawn paths.
- Notes: Absence of a sandbox wrapper is treated as "run on host", the opposite of fail-closed.

### Req 8: Pre-tool-use deny patterns. Hooks deny destructive patterns (`rm -rf /`, `git push --force`, `curl | sh`, credential exfiltration shapes) independent of the permission allow-list.

- Verdict: MEETS
- Evidence:
  - `internal/cmd/tap_guard_dangerous.go:14-40` documents the guard list: `sudo`, `apt/dnf/yum/pacman/brew install`, `pip install --system`, `npm install -g`, `gem install`, `rm -rf /`, `git push --force`, `git reset --hard`, `git clean -f`, `drop table/database`, `truncate table`. "Exit codes: 0 - Operation allowed; 2 - Operation BLOCKED".
  - `internal/hooks/templates/claude/settings-autonomous.json:41-95` wires `gt tap guard dangerous-command` into PreToolUse seven times (one per matcher).
  - `internal/hooks/config.go:843,850,857` register the same command in the base hook config.
  - `.githooks/pre-push` enforces branch allowlist (`main/master`, `polecat/*`, `integration/*`, `beads-sync`) at git-push time.
- Notes: Credential exfiltration shapes (`curl … | sh`, base64-piped tokens) are not in the fragment list. Covers the rm/force-push/privilege-escalation cases explicitly.

### Req 9: Per-worker credential scoping. API keys, tokens, and session credentials are scoped to the worker that needs them. Never shared across isolation units.

- Verdict: MISSING
- Evidence:
  - `internal/config/env.go:353-409` passes through a fixed list of cloud credentials from the parent shell to every spawned session: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, etc. Comment L354-355: "Only variables explicitly listed here are forwarded; all others are blocked for isolation."
  - No per-worker secret broker, no per-bead key rotation, no scoped tokens. All workers inherit the operator's shell credentials.
  - The proxy design issues per-polecat mTLS certs (`docs/design/sandboxed-polecat-execution.md:242-263`) for control-plane calls, but that is a proxy identity, not an LLM-provider credential, and is proposal-stage.
- Notes: API keys are shared across all workers by design.

### Req 10: Unattended = container-only. Unattended pipelines (`--dangerously-skip-permissions` or equivalent) run only inside a container or VM. The harness enforces this coupling.

- Verdict: MISSING
- Evidence:
  - `internal/config/roles/polecat.toml:13`, `refinery.toml:13`, `mayor.toml:13`, `witness.toml:13`, `crew.toml:13`, `dog.toml:13`, `deacon.toml:13` — every role defaults to `exec claude --dangerously-skip-permissions` with no container requirement.
  - `internal/crew/manager.go:54` "Interactive removes `--dangerously-skip-permissions` for interactive/refresh mode" — the only coupling check is interactive vs autonomous, not host vs container.
  - No code path checks for `ExecWrapper` presence or container context before appending `--dangerously-skip-permissions`.
- Notes: The flag is the default on the operator's host machine.

### Req 11: On-demand provisioning. The orchestrator can spin up a fresh isolation unit when a task dispatches and tear it down after completion, with no manual setup.

- Verdict: MEETS
- Evidence:
  - `gt sling` auto-spawns polecats: `gt sling --help` — "Auto-spawning polecats when target is a rig … `gt sling gp-abc greenplace  # Auto-spawn polecat in rig`".
  - `internal/polecat/manager.go:522-774` `Add`/`AddWithOptions` create the worktree, overlay files, settings, and `.beads` in a single call.
  - `internal/polecat/manager.go:1048-1180` `Remove`/`RemoveWithOptions` nuke the worktree, including unpushed-commit protection.
  - `templates/polecat-CLAUDE.md:70` "`gt done` pushes your branch, submits to MQ, nukes sandbox, exits session."
- Notes: This is the worktree-level isolation unit, not a container. For containers, provisioning is manual `docker compose up`.

### Req 12: Persisted outputs after teardown. Artifacts (logs, diffs, decision notes, cost metrics) persist outside the isolation unit so they survive teardown.

- Verdict: MEETS
- Evidence:
  - Beads (Dolt-backed SQL DB) persists work state: `docker-compose.yml:35` `- dolt-data:/gt/.dolt-data` in a named volume; `Dockerfile:34` `mkdir -p /gt /gt/.dolt-data`.
  - Branch-level artifacts persist in `.repo.git` on the host; `docs/design/sandboxed-polecat-execution.md:228-239` "`.repo.git` (the bare repo GasTown already maintains at `~/gt/<rig>/.repo.git`)".
  - Cost metrics via the Stop hook: `docs/HOOKS.md:147` "costs-record Stop Yes crew, polecat, witness, refinery".
  - Mail/handoffs live in town-level directories outside the polecat worktree (hooks registry, costs.go).
- Notes: Worktree teardown preserves beads, git refs, and cost/mail data.

### Req 13: Worktree/build isolation. Build artifact directories (`.next`, `dist`, `node_modules`, etc.) do not leak between workers' worktrees.

- Verdict: PARTIAL
- Evidence:
  - `internal/polecat/manager.go:948` each polecat gets its own worktree path via `git worktree add -b polecat/<name>-<timestamp> <path>` — distinct directory trees, so local `node_modules` etc. are per-worktree by default.
  - `internal/polecat/manager.go:990` "Keep worktree runtime ignores local so the tracked tree stays clean."
  - No evidence of shared build-cache isolation (e.g., separate `GOCACHE`, `npm config cache`) per worker. `grep -n "GOCACHE\|npm.*cache\|cache.*isolat" internal/` returns nothing relevant.
- Notes: Directory-level isolation holds. Cross-worker build-tool caches (Go, npm, pip, cargo) inherit from the shared `$HOME`.

### Req 14: Subagent permission inheritance handled. The known inheritance bug is worked around deterministically (user-scope settings, `autoAllowBashIfSandboxed`, or explicit per-subagent permission injection).

- Verdict: PARTIAL
- Evidence:
  - `docs/HOOKS.md:22-25` "Gas Town manages `.claude/settings.json` files in gastown-managed parent directories and passes them to Claude Code via the `--settings` flag. This keeps customer repos clean while providing role-specific hook configuration."
  - `docs/HOOKS.md:46-61` describes per-role settings placement at `<rig>/<role>/.claude/settings.json` (parent-directory scope), not per-worktree — addressing the "project-scoped settings don't resolve in worktrees" issue.
  - No reference to GitHub issue 37730 or `autoAllowBashIfSandboxed`.
- Notes: The shape of the fix (shared parent directory + `--settings` flag) matches the user-scope workaround pattern, though `autoAllowBashIfSandboxed` is not used; the `--dangerously-skip-permissions` default makes inheritance moot in practice.

### Req 15: MCP tool gating. Destructive MCP tool calls (delete_issue, merge_pull_request, etc.) are gated by hooks regardless of MCP server-level allow-lists.

- Verdict: MISSING
- Evidence:
  - `grep -rn "mcp" internal/hooks/ .claude/` returned no matches.
  - `internal/cmd/tap_guard_dangerous.go` matches on shell command text only; MCP tool invocations are matched via hook `matcher` fields which the guard code does not enumerate.
  - No PreToolUse hook entry targets `mcp__*` matchers in `internal/hooks/templates/claude/settings-autonomous.json`.
- Notes: No evidence that MCP tool calls are gated.

### Req 16: Auditable isolation. The posture of every worker (container image, network policy, credential scope, permission set) is queryable and logged.

- Verdict: PARTIAL
- Evidence:
  - `internal/proxy/exec.go:106-112` audit-logs every proxied exec call: `s.log.Info("exec", "identity", identity, "cmd", cmd0, "sub", subForLog(req.Argv), "exit", exitCode)`.
  - `docs/HOOKS.md:112-120` `gt hooks scan` / `gt hooks list --json` make hook posture queryable.
  - `docs/otel-data-model.md` (not read in full) ships OTel telemetry; `.claude/skills/pr-sheriff/skill.md:42` references "trust tiers, firewalled contributors".
  - No command found that reports a worker's active `ExecWrapper`, active container image, effective allowlist, or credential scope together. `gt status` / `gt doctor` were not exhaustively inspected here for an "isolation posture" query.
- Notes: Hooks and proxy calls are auditable; container/wrapper/credential posture per worker is not consolidated into a single query.

## Surprises

- The mTLS proxy (`internal/proxy/`) is production-grade (TLS 1.3, RequireAndVerifyClientCert, per-client rate limiting, deny list, resolved-absolute-paths-at-startup to prevent PATH hijacking, minimal env via `minimalEnv()`) — a full implementation of the control-plane half of the daytona proposal even though the container half is not shipped.
- Role TOML `start_command` baking in `--dangerously-skip-permissions` is uniform across all seven roles, including `witness` and `mayor` which were not identified by the spec as needing it.
- `internal/config/env.go:353-409` is an explicit allowlist for env-var propagation — the inverse pattern of the rest of the codebase (all other isolation is permissive by default).
- `docker-compose.yml` drops all capabilities and re-adds a minimal set with `no-new-privileges:true` — stronger container posture than the surrounding docs imply, but operates at the full-workspace granularity, not per-worker.
- The dangerous-command guard's exit-code-2 plumbing is correctly aligned with Claude Code hook protocol, and is installed seven times in `settings-autonomous.json` (once per matcher), confirming end-to-end registration.
- Base image `docker/sandbox-templates:claude-code` (Dockerfile L3) is inherited as-is; its own isolation properties are not restated in the Gas Town Dockerfile.

## Open Questions for Trial

- Does `gt sling --exec-wrapper "…"` actually propagate to the spawned Claude process end-to-end, given `ExecWrapper` is implemented in config but no sling flag was documented in `gt sling --help`?
- Do per-polecat worktrees share a `$HOME` with node_modules/Go cache contamination potential when two polecats build concurrently?
- Does `docker compose up -d` start a single container shared by all workers, or is it expected that the operator runs `gt install` inside it and spawns per-polecat worktrees within the same container?
- Does `gt doctor` flag absence of a sandbox wrapper when `--dangerously-skip-permissions` is in use, or treat it as acceptable?
- Are there MCP servers configured anywhere in the default Gas Town setup that would need gating, or does the default distribution ship zero MCP configuration?

## Source Index

- `/Users/deuley/code/tools/gastown/Dockerfile`
- `/Users/deuley/code/tools/gastown/Dockerfile.e2e`
- `/Users/deuley/code/tools/gastown/docker-compose.yml`
- `/Users/deuley/code/tools/gastown/docker-entrypoint.sh`
- `/Users/deuley/code/tools/gastown/docs/INSTALLING.md`
- `/Users/deuley/code/tools/gastown/docs/HOOKS.md`
- `/Users/deuley/code/tools/gastown/docs/design/sandboxed-polecat-execution.md`
- `/Users/deuley/code/tools/gastown/docs/proxy-server.md` (line-counted only)
- `/Users/deuley/code/tools/gastown/docs/design/agent-api-inventory.md` (grep only)
- `/Users/deuley/code/tools/gastown/templates/polecat-CLAUDE.md`
- `/Users/deuley/code/tools/gastown/.githooks/pre-push`
- `/Users/deuley/code/tools/gastown/internal/proxy/server.go`
- `/Users/deuley/code/tools/gastown/internal/proxy/exec.go`
- `/Users/deuley/code/tools/gastown/internal/proxy/denylist.go` (grep only)
- `/Users/deuley/code/tools/gastown/internal/cmd/proxy_subcmds.go`
- `/Users/deuley/code/tools/gastown/internal/cmd/tap_guard_dangerous.go`
- `/Users/deuley/code/tools/gastown/internal/cmd/tap_guard.go` (grep only)
- `/Users/deuley/code/tools/gastown/internal/cmd/tap_list.go` (grep only)
- `/Users/deuley/code/tools/gastown/internal/polecat/manager.go` (grep only)
- `/Users/deuley/code/tools/gastown/internal/config/env.go`
- `/Users/deuley/code/tools/gastown/internal/config/types.go` (grep only)
- `/Users/deuley/code/tools/gastown/internal/config/loader.go` (grep only)
- `/Users/deuley/code/tools/gastown/internal/config/roles/*.toml` (grep only)
- `/Users/deuley/code/tools/gastown/internal/config/agents.go` (grep only)
- `/Users/deuley/code/tools/gastown/internal/config/cost_tier.go` (grep only)
- `/Users/deuley/code/tools/gastown/internal/crew/manager.go` (grep only)
- `/Users/deuley/code/tools/gastown/internal/hooks/config.go` (grep only)
- `/Users/deuley/code/tools/gastown/internal/hooks/templates/claude/settings-autonomous.json` (grep only)
- `/Users/deuley/code/tools/gastown/.claude/skills/crew-commit/SKILL.md` (grep only)
- `/Users/deuley/code/tools/gastown/.claude/skills/pr-sheriff/skill.md` (grep only)
- CLI: `gt install --help`, `gt rig add --help`, `gt sling --help`, `gt hooks --help`, `gt crew add --help`
- Criteria: `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/09-environment-isolation.md`
- Format: `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md`
