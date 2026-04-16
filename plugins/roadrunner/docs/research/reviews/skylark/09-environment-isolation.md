# Skylark — Environment Isolation Conformance Evaluation

## Summary

- Conformance at a glance: 1 MEETS, 3 PARTIAL, 12 MISSING, 0 N/A (out of 16)
- Headline: Skylark's only isolation primitive is the git worktree; every other aspect of the domain (containers, sandbox, permissions, allow-lists, credential scoping, hooks, MCP gating, audit) is either unaddressed or silently delegated to the host harness with no explicit contract.

## Plugin boundary (read first)

Skylark ships as a Claude Code plugin consisting solely of `skills/*/SKILL.md` instruction files plus `skills/_shared/` methodology. There is:

- No `.claude/settings.json`, `settings.local.json`, or any permission/sandbox/hook configuration anywhere in the plugin (verified: `find ... -name "settings*.json"` returns empty; there is no `.claude/` directory at the plugin root).
- No `permissionMode`, `tools:`, or `isolation:` field in any skill's YAML frontmatter (the only matches for these keywords across `skills/` are prose references in `skills/develop/SKILL.md:95` and `skills/_shared/prompt-template.md:65`; `skills/_shared/artifact-conventions.md:85` uses `model: sonnet | opus` for report metadata).
- No Dockerfile, devcontainer config, provisioning script, hook scripts, or firewall rules in the repository.
- No references to `autoAllowBashIfSandboxed`, `--dangerously-skip-permissions`, iptables, or allow-lists in any instructional content — although the `docs/research/claude-code-sandbox-ergonomics-report.md` research file documents these as host-harness best practices.

`CLAUDE.md` explicitly states: "Do not add external dependencies" and "Every skill must be self-contained or reference `_shared/` methodology explicitly." The plugin is pure prompt/instruction content.

## Per-Requirement Findings

### Req 1: Per-worker isolation unit. Each worker executes in a dedicated isolation unit — at minimum a git worktree, preferably also a container or microVM for unattended runs.

- Verdict: PARTIAL
- Evidence: `skills/develop/SKILL.md:69-73`: "Create an isolated worktree for this task: `git worktree add <worktree-path> -b <task-branch-name>`". `skills/develop/SKILL.md:339-340` Red Flags: "Execute in the main working tree — always uses a worktree". `skills/_shared/risk-matrix.md:29` shows `DEVELOP worktree` as `no` (trivial), `yes` (standard/elevated/critical). `skills/dispatch-with-mux/SKILL.md:133` specifies `"runtimeConfig": { "type": "worktree" }` for Mux dispatch.
- Notes: The git-worktree minimum is clearly met at standard+ risk. No container/microVM layer is defined anywhere; `skills/implement/SKILL.md:88-92` specifies trivial risk runs "directly in the main working tree — No worktree". No unattended-mode container guidance.

### Req 2: Orchestrator-managed provisioning. Containers/VMs are instantiated by an orchestrator-managed script, not by workers calling `docker` or cloud provisioning APIs directly. The script is the only sanctioned path.

- Verdict: PARTIAL
- Evidence: Worktree provisioning is orchestrator-managed. `skills/develop/SKILL.md:67-73` and `skills/dispatch-with-mux/SKILL.md:122-135` (the ORPC call to `/api/workspace.create`) both instantiate isolation from the orchestrator side. `skills/develop/SKILL.md:344` Red Flag: "Merge branches or create PRs — implement handles that".
- Notes: Applies only to worktrees; no container provisioning script exists. Mux is an external server Skylark calls via HTTP — `skills/dispatch-with-mux/SKILL.md:29-31`: "This skill does NOT start the server — it connects to one that's already running."

### Req 3: Deterministic environment setup. The same provisioning call produces the same tooling, env vars, and network policy, every time. Reproducible.

- Verdict: MISSING
- Evidence: No environment setup logic is specified anywhere in `skills/`. No env vars, tooling installation, or network policy are defined at worker-dispatch time. `skills/develop/SKILL.md:93` writes a generated `CLAUDE.md` into the worktree root, but this is prompt content, not environment configuration.
- Notes: `skills/dispatch-with-mux/SKILL.md:47-51` maps model shorthand to provider IDs via `.muxrc`, but this is LLM routing, not environment determinism.

### Req 4: Explicit network allow-list. Egress is gated by an allow-list of domains. Default-deny at the iptables/firewall layer, not only at the application layer.

- Verdict: MISSING
- Evidence: No evidence found in `skills/`, plugin root, or `.claude-plugin/`. The only discussion of network allow-lists is in the research input `docs/research/claude-code-sandbox-ergonomics-report.md` (describing host-harness best practice), not in Skylark itself.

### Req 5: Filesystem allow-list. Workers write only to the project directory plus explicit scratch paths. Read-access to secrets (`.env`, `.ssh`, `.aws`, `secrets/`) is denied by path rule.

- Verdict: MISSING
- Evidence: No filesystem allow-list or deny rule is defined. The grep for `.env` / `secrets` in `skills/` produces only a single vocabulary-cluster mention in `skills/prepare/SKILL.md:39` ("secrets management, environment variables") as a `infra` domain example — no enforcement rule.

### Req 6: Sandbox + permissions layered. Sandbox is the security boundary; permissions are ergonomic policy. Inside a sandbox, per-command prompts auto-resolve. Outside, they gate.

- Verdict: MISSING
- Evidence: No `permissionMode`, `autoAllowBashIfSandboxed`, or related sandbox concept appears in any skill file. The research input documents this best practice but it is not surfaced in Skylark's instructional content.

### Req 7: Fail-closed on sandbox failure. If the sandbox cannot start or its policy cannot load, execution fails rather than falling back to unsandboxed.

- Verdict: MISSING
- Evidence: No sandbox startup/failure semantics defined. `skills/dispatch-with-mux/SKILL.md:60-66` defines a `status: fallback` when the Mux server is unreachable, but this is explicit degradation to sequential execution on the same host, not sandbox policy.

### Req 8: Pre-tool-use deny patterns. Hooks deny destructive patterns (`rm -rf /`, `git push --force`, `curl | sh`, credential exfiltration shapes) independent of the permission allow-list.

- Verdict: MISSING
- Evidence: No hooks configuration exists in the plugin. No PreToolUse rules anywhere. `skills/finish/SKILL.md:284` has a Red Flag "Force-push without explicit user request" — prose guidance to the agent, not a PreToolUse hook.

### Req 9: Per-worker credential scoping. API keys, tokens, and session credentials are scoped to the worker that needs them. Never shared across isolation units.

- Verdict: MISSING
- Evidence: No credential-scoping mechanism is described. The one token reference is `skills/dispatch-with-mux/SKILL.md:43`: `auth_token_env: MUX_SERVER_AUTH_TOKEN` — a single shared token read from the orchestrator's env to reach the Mux server. Workers do not receive scoped credentials.

### Req 10: Unattended = container-only. Unattended pipelines (`--dangerously-skip-permissions` or equivalent) run only inside a container or VM. The harness enforces this coupling.

- Verdict: MISSING
- Evidence: No mention of `--dangerously-skip-permissions` or an unattended/container coupling in any skill. The risk matrix gates user confirmation by risk (`skills/_shared/risk-matrix.md:34`: "User confirm gates") but does not tie this to isolation boundaries.

### Req 11: On-demand provisioning. The orchestrator can spin up a fresh isolation unit when a task dispatches and tear it down after completion, with no manual setup.

- Verdict: MEETS
- Evidence: `skills/develop/SKILL.md:69-73` creates a fresh worktree per task; `skills/finish/SKILL.md:215-227` tears it down: "Remove worktree and branch... `git worktree remove <worktree-path>`". `skills/dispatch-with-mux/SKILL.md:339-343`: "Clean up worktrees for completed tasks: `git worktree remove <worktree-path>`". Automatic per-task spin-up and teardown with no manual steps (within the worktree isolation layer).

### Req 12: Persisted outputs after teardown. Artifacts (logs, diffs, decision notes, cost metrics) persist outside the isolation unit so they survive teardown.

- Verdict: PARTIAL
- Evidence: `skills/_shared/artifact-conventions.md:7-19` places specs, plans, tasks, reports, notes in `docs/` at the project root — which is shared across worktrees because each worktree branches from the same repo. `skills/finish/SKILL.md:200-203` covers session notes; changelog entries per `skills/_shared/artifact-conventions.md:116-146` capture per-stage events.
- Notes: Covers documentation artifacts. No provisions for log capture, diff archival beyond git, or cost metrics. Whether `docs/` on a branched worktree propagates to the merged main is a git-level concern; the conventions assume it does via normal branch merge.

### Req 13: Worktree/build isolation. Build artifact directories (`.next`, `dist`, `node_modules`, etc.) do not leak between workers' worktrees.

- Verdict: MISSING
- Evidence: No worktree-build-isolation guidance in any skill. `.gitignore` (17 bytes) was not inspected for explicit ignored paths but no skill-level rule addresses cross-worktree contamination of build outputs.
- Notes: Git worktrees inherently share `.git/` but have separate working trees; build artifacts in git-ignored paths are per-worktree by default. Whether a worker's `pnpm install` pollutes a sibling worktree depends on the host filesystem and how the project is configured, not on Skylark.

### Req 14: Subagent permission inheritance handled. The known inheritance bug is worked around deterministically (user-scope settings, `autoAllowBashIfSandboxed`, or explicit per-subagent permission injection).

- Verdict: MISSING
- Evidence: No mention of subagent permission inheritance, GitHub issue #37730, `autoAllowBashIfSandboxed`, or user-scope settings in any skill file. The sandbox ergonomics research file (`docs/research/claude-code-sandbox-ergonomics-report.md:13-15`) documents the bug and workarounds, but the instructions Skylark gives to orchestrators and subagents do not encode those workarounds.

### Req 15: MCP tool gating. Destructive MCP tool calls (delete_issue, merge_pull_request, etc.) are gated by hooks regardless of MCP server-level allow-lists.

- Verdict: MISSING
- Evidence: `skills/linear/SKILL.md` handles Linear MCP interactions by convention, but no PreToolUse hook or gating mechanism restricts destructive MCP calls. No hooks exist in the plugin at all.

### Req 16: Auditable isolation. The posture of every worker (container image, network policy, credential scope, permission set) is queryable and logged.

- Verdict: PARTIAL
- Evidence: `skills/_shared/artifact-conventions.md:116-146` defines in-file changelogs: "Every artifact maintains a changelog section at the bottom of the file. This is the primary audit trail — no external system required." `skills/develop/SKILL.md:298-302` records "Task complete. Tests pass. Branch: task/TASK-NNN-slug."
- Notes: Changelogs capture task completion events and branch names. They do not record container image, network policy, credential scope, or permission set (none of which Skylark configures). Worker model selection is logged only implicitly via artifact and report `model:` frontmatter.

## Surprises

- **Prose reference to a non-existent frontmatter shape.** `skills/develop/SKILL.md:95` says "Dispatch using the `Agent` tool with `isolation: "worktree"` or into the created worktree." No Skylark skill uses `isolation:` in its own frontmatter — this is a directive for the orchestrator agent to pass to the Task/Agent tool at dispatch time. The contract is purely prose-to-LLM, not declarative.
- **The `dispatch-with-mux` skill introduces a second isolation runtime via an external server.** `skills/dispatch-with-mux/SKILL.md:45` `runtime: worktree` — Mux's own runtime selector is hard-coded to worktree in the example `.muxrc`, not container.
- **Credentials model assumes single shared auth.** `auth_token_env: MUX_SERVER_AUTH_TOKEN` in `.muxrc` is read once by the orchestrator; worker subagents dispatched via `workspace.sendMessage` share this token implicitly.
- **`CLAUDE.md` written into each worktree root** (`skills/develop/SKILL.md:93`) is both a context-injection mechanism and a potential cross-contamination vector if the orchestrator misroutes it — no guardrail prevents writing the wrong expert prompt into a sibling worktree.
- **No `.claude/` directory at plugin root.** Many comparable Claude Code plugins ship a `.claude/settings.json` to declare permissions/hooks; Skylark does not. The full delegation to host harness is intentional ("Do not add external dependencies" — `CLAUDE.md:22`).

## Open Questions for Trial

- Does `git worktree add` on a project with a stateful build cache (`.next`, `node_modules` symlinks, Turborepo cache) actually produce clean per-worker state, or do workers end up sharing caches through git-ignored paths?
- Does the parent Claude Code orchestrator actually honor `isolation: "worktree"` when the subagent Task tool is invoked, given that this directive appears only in prose inside `skills/develop/SKILL.md` and not in any declarative frontmatter?
- What happens when the Mux-dispatched workspaces each need project-scoped permissions — does inheritance from `~/.claude/settings.json` propagate through the Mux ORPC dispatch?
- How are credentials like `GITHUB_TOKEN`, `LINEAR_API_KEY`, or database URLs expected to reach workers — inherited from the orchestrator's env, or somehow scoped?
- On trivial risk (no worktree), does the direct in-main-tree execution cause any isolation concerns when pipeline steps run in sequence on the same working tree?

## Source Index

- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/09-environment-isolation.md` (spec)
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/criteria-review/evaluation-prompts.md` (method + format)
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/claude-code-sandbox-ergonomics-report.md` (best-practice baseline; cited for contrast, not conformance)
- `/Users/deuley/code/mocha/ai/plugins/skylark/docs/research/2026-04-15-eng-180-retrospective.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/CLAUDE.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/.claude-plugin/plugin.json`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/implement/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/develop/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/dispatch-with-mux/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/finish/SKILL.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/risk-matrix.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/artifact-conventions.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/_shared/prompt-template.md`
- `/Users/deuley/code/mocha/ai/plugins/skylark/skills/prepare/SKILL.md`
- Commands: `find ... -name "settings*.json" -o -name ".muxrc"` (both returned empty); `ls .claude` (no such directory); `grep -r permissionMode|tools:|isolation:|model:` across `skills/`
