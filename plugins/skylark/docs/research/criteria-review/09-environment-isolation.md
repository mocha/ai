# 09 — Environment Isolation

## Purpose

Defines the sandbox + container + permission posture under which workers
execute: filesystem and network boundaries, credential scoping,
provisioning pattern, and the division between ergonomic permission
policy and hard security boundaries. This domain is what makes unattended
execution genuinely safe.

## Key forces

- Field consensus (April 2026): local sandbox for interactive work,
  container for unattended pipelines.
  `--dangerously-skip-permissions` is only safe inside a container or
  VM boundary.
- Anthropic's own reference devcontainer and Trail of Bits' hardened
  variant use iptables default-deny egress rules — application-layer
  allow-lists are not sufficient.
- Subagent permission inheritance is buggy (GitHub \#37730).
  Project-scoped settings don't resolve in worktrees. User-scope
  settings are the reliable workaround.
- `autoAllowBashIfSandboxed: true` is the single biggest ergonomic win
  — the sandbox is the security gate; per-command prompts are
  redundant inside one.
- MCP servers default to "allow everything" and have no native
  per-tool gating. PreToolUse hooks must fill the gap.
- Workers calling `docker` directly with arbitrary images, volume
  mounts, and `--privileged` is a foot-gun. Provisioning should go
  through an orchestrator-managed script that constrains the shape.
- Orphaned worktrees and build-artifact contamination between worktrees
  are real production failure modes.

## Best-practice requirements

1. **Per-worker isolation unit.** Each worker executes in a dedicated
   isolation unit — at minimum a git worktree, preferably also a
   container or microVM for unattended runs.
2. **Orchestrator-managed provisioning.** Containers/VMs are instantiated
   by an orchestrator-managed script, not by workers calling `docker`
   or cloud provisioning APIs directly. The script is the only
   sanctioned path.
3. **Deterministic environment setup.** The same provisioning call
   produces the same tooling, env vars, and network policy, every
   time. Reproducible.
4. **Explicit network allow-list.** Egress is gated by an allow-list of
   domains. Default-deny at the iptables/firewall layer, not only at
   the application layer.
5. **Filesystem allow-list.** Workers write only to the project
   directory plus explicit scratch paths. Read-access to secrets
   (`.env`, `.ssh`, `.aws`, `secrets/`) is denied by path rule.
6. **Sandbox + permissions layered.** Sandbox is the security
   boundary; permissions are ergonomic policy. Inside a sandbox,
   per-command prompts auto-resolve. Outside, they gate.
7. **Fail-closed on sandbox failure.** If the sandbox cannot start or
   its policy cannot load, execution fails rather than falling back to
   unsandboxed.
8. **Pre-tool-use deny patterns.** Hooks deny destructive patterns
   (`rm -rf /`, `git push --force`, `curl | sh`, credential
   exfiltration shapes) independent of the permission allow-list.
9. **Per-worker credential scoping.** API keys, tokens, and session
   credentials are scoped to the worker that needs them. Never shared
   across isolation units.
10. **Unattended = container-only.** Unattended pipelines
    (`--dangerously-skip-permissions` or equivalent) run only inside a
    container or VM. The harness enforces this coupling.
11. **On-demand provisioning.** The orchestrator can spin up a fresh
    isolation unit when a task dispatches and tear it down after
    completion, with no manual setup.
12. **Persisted outputs after teardown.** Artifacts (logs, diffs,
    decision notes, cost metrics) persist outside the isolation unit so
    they survive teardown.
13. **Worktree/build isolation.** Build artifact directories (`.next`,
    `dist`, `node_modules`, etc.) do not leak between workers' worktrees.
14. **Subagent permission inheritance handled.** The known inheritance
    bug is worked around deterministically (user-scope settings,
    `autoAllowBashIfSandboxed`, or explicit per-subagent permission
    injection).
15. **MCP tool gating.** Destructive MCP tool calls (delete_issue,
    merge_pull_request, etc.) are gated by hooks regardless of MCP
    server-level allow-lists.
16. **Auditable isolation.** The posture of every worker
    (container image, network policy, credential scope, permission
    set) is queryable and logged.

## Open questions

- Container runtime choice — Docker, Podman, LXC, Firecracker, Apple
  Virtualization? Trade-offs on boot time, isolation level, and
  operational overhead.
- Where does the orchestrator-managed provisioning script live —
  committed to the project repo, or supplied by the harness?
- How does isolation interact with MCP servers (which run outside the
  sandbox as separate processes)?
- Research-mode tooling (Context7, web fetches) needs broad network
  access; how does it coexist with a tight allow-list?
- Credential injection mechanism — env vars from a secret manager,
  mounted secrets file, or runtime credential broker?

## Trial considerations

- Provision a fresh isolation unit for a realistic task; measure boot
  time and teardown cleanliness.
- Attempt a blocked operation (write to `.env`, egress to a
  non-allowlisted domain) and verify the sandbox catches it.
- Run a worker with a crashed state mid-task; verify its isolation
  unit can be torn down without affecting peers.
- Measure network allow-list completeness against a realistic Node +
  Python + Go pipeline; identify missing domains.
