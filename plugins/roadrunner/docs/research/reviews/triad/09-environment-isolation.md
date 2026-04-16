# Triad — Environment Isolation Conformance Evaluation

## Summary

- Conformance at a glance: 2 MEETS, 6 PARTIAL, 8 MISSING, 0 N/A (out of 16)
- Headline: Triad's isolation posture is two layers — per-task git worktrees created by the EM and a macOS-only `safehouse` filesystem sandbox wrapping each manager's Claude Code session — with network policy, credential scoping, destructive-pattern hooks, fail-closed behavior, and auditability either delegated to the host or absent.

## Per-Requirement Findings

### Req 1: Per-worker isolation unit. Each worker executes in a dedicated isolation unit — at minimum a git worktree, preferably also a container or microVM for unattended runs.

- Verdict: PARTIAL
- Evidence:
  - `agents/engineering-manager/CLAUDE.md:120`: "Create a worktree from main inside the project: `git worktree add .worktrees/<task-id> -b <branch>`. All worktrees live under `<project>/.worktrees/` to keep the parent directory clean."
  - `agents/engineering-manager/.claude/skills/assign-task/SKILL.md`: "Workers execute in the target project repository, not in this agent's repo: `cd $PROJECT_PATH; git worktree add .worktrees/T-<id> -b task/T-<id>`".
- Notes: Worktree boundary is enforced per task. No container/microVM layer for workers — workers are dispatched as Claude Code sub-tasks from the EM pane and inherit whatever sandbox the EM was launched inside.

### Req 2: Orchestrator-managed provisioning. Containers/VMs are instantiated by an orchestrator-managed script, not by workers calling `docker` or cloud provisioning APIs directly. The script is the only sanctioned path.

- Verdict: PARTIAL
- Evidence:
  - `scripts/init-project.sh` creates the directory scaffold (`docs/proposals`, `docs/projects`, `docs/tasks`, `docs/inbox/...`). It does not provision containers.
  - `skills/start/SKILL.md:55-70` is the orchestrator path that wraps `claude` in `safehouse` at session-start — not per task. Workers do not go through a provisioning script; the EM issues `git worktree add` directly.
- Notes: No container provisioning exists at all. The only orchestrator-managed step is starting the three manager panes via `/triad:start`.

### Req 3: Deterministic environment setup. The same provisioning call produces the same tooling, env vars, and network policy, every time. Reproducible.

- Verdict: MISSING
- Evidence: `scripts/init-project.sh` creates directories and `.gitkeep` files only. `skills/start/SKILL.md:65` invokes `safehouse --workdir=$PROJECT_PATH --add-dirs=$HOME/code --add-dirs-ro=$HOME/vault --` with paths rooted in the host user's home (`/Users/deuley/code`, `$HOME/vault`). No tooling install, no env-var injection, no network policy. No evidence found in `scripts/`, `templates/`, or `skills/` of a reproducible environment build.

### Req 4: Explicit network allow-list. Egress is gated by an allow-list of domains. Default-deny at the iptables/firewall layer, not only at the application layer.

- Verdict: MISSING
- Evidence: No evidence found in `scripts/`, `agents/*/.claude/settings.json`, `skills/`, or `docs/specs/`. The three manager `.claude/settings.json` files contain only `permissions.allow` entries for `Bash(git commit:*)`, `Bash(git add:*)`, `Bash(git push:*)`, `Bash(git stash:*)`, `Bash(git init:*)`, a filesystem `allowWrite`, and `excludedCommands` — no network allow-list, no firewall configuration. `docs/specs/2026-03-22-three-agent-system-design.md:142` references a host-side Firewalla for LXC containers, external to Triad itself.

### Req 5: Filesystem allow-list. Workers write only to the project directory plus explicit scratch paths. Read-access to secrets (`.env`, `.ssh`, `.aws`, `secrets/`) is denied by path rule.

- Verdict: PARTIAL
- Evidence:
  - `agents/engineering-manager/.claude/settings.json`: `"sandbox": { "enabled": true, "autoAllowBashIfSandboxed": true, "filesystem": { "allowWrite": ["/Users/deuley/code"] } }` — identical in the PM and PgM settings.json files.
  - `skills/start/SKILL.md:65`: `safehouse --workdir=$PROJECT_PATH --add-dirs=$HOME/code --add-dirs-ro=$HOME/vault --`.
- Notes: Write is scoped to `/Users/deuley/code` (the user's entire code tree, not just the project). No read-deny rules for `.env`, `.ssh`, `.aws`, or `secrets/`. `docs/specs/2026-03-22-three-agent-system-design.md:220` acknowledges this explicitly: "The PM agent only modifies files under `docs/projects/*/_decisions/` — this is enforced by the PM agent's CLAUDE.md authority boundaries, not by mount permissions."

### Req 6: Sandbox + permissions layered. Sandbox is the security boundary; permissions are ergonomic policy. Inside a sandbox, per-command prompts auto-resolve. Outside, they gate.

- Verdict: MEETS
- Evidence:
  - All three `.claude/settings.json` set `"autoAllowBashIfSandboxed": true`.
  - `skills/start/SKILL.md:57`: "Safehouse provides a deny-by-default macOS sandbox that confines filesystem access to the workdir and explicitly granted directories. This eliminates approval prompts while keeping agents contained."
  - Manager panes launch with `claude --dangerously-skip-permissions` inside safehouse (`skills/start/SKILL.md:67-69`).
- Notes: Applies to the three manager sessions. Whether dispatched workers inherit the same layering is not documented.

### Req 7: Fail-closed on sandbox failure. If the sandbox cannot start or its policy cannot load, execution fails rather than falling back to unsandboxed.

- Verdict: MISSING
- Evidence: `skills/start/SKILL.md:72-78` documents the opposite: "If safehouse is not installed (`which safehouse` fails), fall back to plain Claude without sandbox or permission bypass: `tmux send-keys -t \"$SESSION.0\" \"claude\" Enter` ...". The permission bypass is removed but so is the sandbox boundary — this is fall-open behavior.

### Req 8: Pre-tool-use deny patterns. Hooks deny destructive patterns (`rm -rf /`, `git push --force`, `curl | sh`, credential exfiltration shapes) independent of the permission allow-list.

- Verdict: MISSING
- Evidence: No `hooks` key in any of the three `.claude/settings.json` files. No `PreToolUse` hook scripts found in `scripts/`, `agents/*/.claude/`, or `skills/`. The only pre-dispatch safeguards are narrative (`agents/engineering-manager/CLAUDE.md:270`: "Do not modify files outside a task's `scope.boundaries`") and the `excludedCommands: ["git push", "git commit"]` sandbox list in each settings.json — which routes listed commands back to approval prompting, not a deny-pattern matcher.

### Req 9: Per-worker credential scoping. API keys, tokens, and session credentials are scoped to the worker that needs them. Never shared across isolation units.

- Verdict: MISSING
- Evidence: No credential-injection mechanism exists in the worker dispatch path. `agents/engineering-manager/.claude/worker-dispatch-template.md` and `worker-context.md` contain no env-var or secret plumbing. The dispatch template passes only `{WORKER_ID}`, `{TASK_ID}`, `{PROJECT_PATH}`, `{WORKTREE_PATH}`, `{BRANCH_NAME}`, `{LIST_OF_FILES}`, `{TASK_SPECIFIC_NOTES}`. `docs/specs/2026-03-22-three-agent-system-design.md:396` lists git-credential mounting as an unresolved question: "Git credentials in NanoClaw containers ... Investigate during Phase 5." Credentials are whatever the host user's shell environment provides to the parent `claude` process.

### Req 10: Unattended = container-only. Unattended pipelines (`--dangerously-skip-permissions` or equivalent) run only inside a container or VM. The harness enforces this coupling.

- Verdict: PARTIAL
- Evidence:
  - `skills/start/SKILL.md:57`: agents run "inside Agent Safehouse (`safehouse`) with `--dangerously-skip-permissions`". The harness couples skip-permissions to the sandbox layer.
  - `skills/start/SKILL.md:72-78`: "If safehouse is not installed ... fall back to plain Claude without sandbox or permission bypass." Coupling is enforced only when safehouse is present.
- Notes: `safehouse` is a macOS filesystem sandbox, not a container or VM. `docs/ORIGINAL_README.md:70`: "Agents run inside [Agent Safehouse](https://github.com/eugene1g/agent-safehouse) with `--dangerously-skip-permissions` for autonomous operation." Workers dispatched by EM inherit whatever sandbox their parent pane has.

### Req 11: On-demand provisioning. The orchestrator can spin up a fresh isolation unit when a task dispatches and tear it down after completion, with no manual setup.

- Verdict: PARTIAL
- Evidence:
  - `agents/engineering-manager/.claude/skills/assign-task/SKILL.md`: `git worktree add .worktrees/T-<id> -b task/T-<id>` runs at dispatch time.
  - No teardown step documented. `agents/engineering-manager/CLAUDE.md:178-180` moves the task file to `docs/tasks/_completed/` but does not remove the worktree. No `git worktree remove` anywhere in the source tree.
- Notes: Spin-up is on-demand for worktrees; teardown is manual and undocumented.

### Req 12: Persisted outputs after teardown. Artifacts (logs, diffs, decision notes, cost metrics) persist outside the isolation unit so they survive teardown.

- Verdict: MEETS
- Evidence: Worker output is committed via `git` (`agents/engineering-manager/.claude/worker-context.md:37-40`: "All git commands use `-C {WORKTREE_PATH}`. Commit to your branch, NEVER to main."). Task files live at `docs/tasks/` (the project root, outside the `.worktrees/<id>/` subdirectory). Completion summaries are recorded in the task file and moved to `docs/tasks/_completed/` (`agents/engineering-manager/CLAUDE.md:178-180`). Token usage and duration are captured: `agents/engineering-manager/CLAUDE.md:173-176` ("Set `completed:`, `actual_tokens:`, `actual_duration_minutes:`"). Protocol messages persist in `docs/inbox/*/read/`. Inbox watcher logs go to `/tmp/claude/watcher-*.log` (`skills/start/SKILL.md:85-87`).

### Req 13: Worktree/build isolation. Build artifact directories (`.next`, `dist`, `node_modules`, etc.) do not leak between workers' worktrees.

- Verdict: MISSING
- Evidence: No evidence found. Worktrees live at `<project>/.worktrees/<task-id>`. Each has its own checkout, but no documentation addresses per-worktree `node_modules` / build-cache isolation, and no provisioning logic scopes build directories.

### Req 14: Subagent permission inheritance handled. The known inheritance bug is worked around deterministically (user-scope settings, `autoAllowBashIfSandboxed`, or explicit per-subagent permission injection).

- Verdict: PARTIAL
- Evidence: All three manager `.claude/settings.json` set `"autoAllowBashIfSandboxed": true` — the workaround called out in the spec. However, these files live at `agents/<role>/.claude/settings.json` (project-scope in the toolkit repo, not user-scope). There is no documented propagation of this setting to worker worktrees, and `worker-dispatch-template.md` does not inject permissions.

### Req 15: MCP tool gating. Destructive MCP tool calls (delete_issue, merge_pull_request, etc.) are gated by hooks regardless of MCP server-level allow-lists.

- Verdict: MISSING
- Evidence: No MCP configuration or MCP-gating hooks found in any `.claude/settings.json`, `scripts/`, or `skills/`. No `hooks` key in any settings file.

### Req 16: Auditable isolation. The posture of every worker (container image, network policy, credential scope, permission set) is queryable and logged.

- Verdict: MISSING
- Evidence: No evidence found. `skills/status/SKILL.md` exists but no audit-log emission of sandbox state, permission set, or credential scope is present in the EM dispatch path. Task files record `actual_tokens` and `actual_duration_minutes` (`agents/engineering-manager/CLAUDE.md:173-176`) but no isolation posture.

## Surprises

- **`excludedCommands` in the sandbox block removes protection for the most sensitive commands.** All three settings.json files contain `"excludedCommands": ["git push", "git commit"]` inside the sandbox block. Combined with `"autoAllowBashIfSandboxed": true`, this explicitly routes `git push` and `git commit` back through per-command prompting — arguably the right call, but noteworthy: destructive git operations are *less* auto-allowed than routine bash in the Triad posture.
- **`allowWrite` is the user's entire `/Users/deuley/code` tree**, not the target project directory. Any manager can write to any sibling project. Intentional per `skills/start/SKILL.md:61`: "all project repos get read/write (agents need cross-project access for the toolkit, templates, and sibling repos)" — but worker isolation by path is very coarse.
- **`docs/specs/2026-03-22-three-agent-system-design.md` describes a much stronger isolation posture** (NanoClaw LXC containers with `mount-allowlist.json`, Firewalla-based egress rules, per-agent mount permissions, `GIT_TOKEN` injection) that is *not reflected* in the shipped `scripts/` or `.claude/settings.json`. That spec appears to describe an aspirational/parallel deployment target, not what `/triad:start` actually provisions.
- **The three manager settings.json files are byte-identical.** No differentiation of posture by role (PM vs PgM vs EM), despite different blast radii.
- **Host-side inbox watchers** (`scripts/com.deuleyville.inbox-watcher.plist`, `scripts/inbox-watcher.service`) run outside any sandbox as launchd/systemd user services and send keystrokes to tmux panes via `tmux send-keys`. This is a trust-boundary-spanning channel not covered by the sandbox.

## Open Questions for Trial

- Does `safehouse` actually apply to a Claude Code sub-task (worker) dispatched from within a sandboxed manager pane, or does the worker get fresh context with no sandbox applied?
- When safehouse is absent and the harness falls back to plain `claude` (no `--dangerously-skip-permissions`), does the triad still function, or does every tool call gate on user approval?
- How are worktrees cleaned up in practice? Manual `git worktree remove`? Orphaned `.worktrees/T-*` accumulation?
- Does `node_modules` / `.next` leak across worktrees on projects that check in a single `package.json` at repo root?
- Is there any credential handling at all beyond the parent shell's inherited environment?

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/scripts/init-project.sh`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/scripts/inbox-watcher.service`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/scripts/com.deuleyville.inbox-watcher.plist`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/settings.json`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/worker-dispatch-template.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/worker-context.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/engineering-manager/.claude/skills/assign-task/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/product-manager/.claude/settings.json`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/agents/program-manager/.claude/settings.json`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/skills/start/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/skills/kick/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/specs/2026-03-22-three-agent-system-design.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/specs/2026-03-23-agent-triad-protocol-design.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/docs/ORIGINAL_README.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/triad-source/templates/workspace-layout/` (directory listing)
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/09-environment-isolation.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md`
