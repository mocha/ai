# Claude Code Sandbox & Permission Ergonomics Report

**Date:** April 14, 2026  
**Audience:** Skylark pipeline operators running multi-stage agentic workflows  
**Sources:** Anthropic official docs (code.claude.com), Claude Code GitHub issues, community configs, engineering blogs. Items older than 6 months flagged as potentially stale.

---

## TL;DR — Actionable Summary

1. **Enable `autoAllowBashIfSandboxed: true`** — this is the single biggest friction eliminator. With sandbox on, every bash command runs automatically inside the sandbox boundary. No per-command prompts. The sandbox is the security gate, not the approval prompt.

2. **Subagent permission inheritance is a known bug** (GitHub issue #37730, March 2026). Subagents do NOT reliably inherit the parent's permission allow-list — each subagent re-prompts. Workaround: put permissions in `~/.claude/settings.json` (user scope), not just project scope. Worktree-scoped project settings (`~/.claude/projects/<path>/settings.json`) fail for worktrees because the resolved path differs.

3. **The devcontainer approach has won** for walkaway-able long pipelines. Anthropic's official reference devcontainer + Trail of Bits' hardened variant both provide container isolation that makes `--dangerously-skip-permissions` genuinely safe. The community consensus in early 2026 is: local sandbox for interactive work, container for unattended pipelines.

4. **Hooks are guardrails, not walls** — use PreToolUse hooks to auto-deny known-dangerous patterns (rm -rf, force push, reset --hard) and to log all tool calls for audit. Don't rely on hooks to auto-allow things the permission system already handles.

5. **MCP servers default to "allow everything."** There is no per-tool gating built in. You must use PreToolUse hooks or permission deny rules to restrict specific MCP tool calls. The Linear MCP and similar first-party servers have not had public security incidents, but the OWASP MCP Top 10 (2026) treats tool poisoning and over-permissioned MCP connections as top-tier risks.

---

## 1. Permission Allow-List Design

### Current consensus

The permission system evaluates in order: **deny rules first** (they always win), then allow rules, then interactive prompt for anything unmatched. Arrays merge across scopes (managed → user → project → local), meaning each layer can add but not override denies from higher layers.

### Starter pack for Node/pnpm + Git + GitHub CLI

```jsonc
// ~/.claude/settings.json (user scope — applies everywhere)
{
  "permissions": {
    "allow": [
      // Git read operations — safe
      "Bash(git status)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git branch *)",
      "Bash(git show *)",
      "Bash(git stash *)",
      "Bash(git worktree *)",     // RISK: can create worktrees in unexpected locations
      
      // Git write operations — moderate risk
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(git checkout *)",
      "Bash(git switch *)",
      "Bash(git merge *)",        // RISK: can introduce merge conflicts
      "Bash(git rebase *)",       // RISK: can rewrite history on local branches
      
      // Package management — safe within sandbox
      "Bash(pnpm *)",
      "Bash(npm run *)",
      "Bash(npx *)",             // RISK: npx can download and execute arbitrary packages
      "Bash(node *)",
      
      // GitHub CLI — moderate risk
      "Bash(gh pr *)",
      "Bash(gh issue *)",
      "Bash(gh repo view *)",
      
      // Common dev tools
      "Bash(cat *)",
      "Bash(head *)",
      "Bash(tail *)",
      "Bash(wc *)",
      "Bash(ls *)",
      "Bash(find *)",
      "Bash(grep *)",
      "Bash(rg *)",
      "Bash(fd *)",
      "Bash(jq *)",
      "Bash(sed *)",              // RISK: sed -i can modify files in-place
      "Bash(awk *)",
      "Bash(sort *)",
      "Bash(uniq *)",
      "Bash(tr *)",
      "Bash(cut *)",
      "Bash(tee *)",
      "Bash(mkdir *)",
      "Bash(cp *)",
      "Bash(mv *)",              // RISK: mv can overwrite files
      "Bash(touch *)",
      "Bash(echo *)",
      "Bash(printf *)",
      "Bash(which *)",
      "Bash(env *)",
      "Bash(pwd)",
      "Bash(date *)",
      
      // Python — for scripts and tooling
      "Bash(python3 *)",
      "Bash(python *)",
      "Bash(pip *)",
      "Bash(uv *)",
      
      // Go
      "Bash(go build *)",
      "Bash(go test *)",
      "Bash(go run *)",
      "Bash(go mod *)",
      "Bash(go vet *)",
      
      // Testing
      "Bash(vitest *)",
      "Bash(jest *)",
      "Bash(playwright *)",
      
      // File tools — always allow
      "Read(*)",
      "Edit(*)",
      "Write(*)",
      "MultiEdit(*)",
      "Grep(*)",
      "Glob(*)"
    ],
    "deny": [
      // Destructive operations — ALWAYS block
      "Bash(rm -rf *)",
      "Bash(rm -r /*)"),
      "Bash(git push --force*)",
      "Bash(git push -f *)",
      "Bash(git reset --hard*)",
      "Bash(git clean -fd*)",
      
      // Sensitive file reads
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "Read(//*/.ssh/**)",
      "Read(//*/.aws/**)",
      
      // Network exfiltration vectors (when NOT using sandbox network isolation)
      // Uncomment if sandbox is disabled:
      // "Bash(curl *)",
      // "Bash(wget *)"
    ]
  }
}
```

### Patterns people regret

- **`Bash(npm *)`** — too broad. Matches `npm publish`, `npm login`, `npm access`. Use `Bash(npm run *)`, `Bash(npm install *)`, `Bash(npm test *)` separately.
- **`Bash(git push *)`** — allows force push to any branch. Use `Bash(git push origin *)` and deny force-push patterns explicitly.
- **`Bash(docker *)`** — allows `docker run` with arbitrary images, volume mounts, and `--privileged`. If you need Docker, use `sandbox.excludedCommands: ["docker"]` and accept the prompt, or scope to `Bash(docker compose *)`.
- **`Bash(curl *)`** with sandbox disabled — allows arbitrary data exfiltration. Only safe when sandbox network isolation is active.
- **Glob `**` in file paths** — `Edit(./*)` only matches one level. Use `Edit(./**)` for recursive. But `Edit(**)` without `./` prefix in project settings resolves relative to `~/.claude/`, not the project.

### Scope layering strategy

| Scope | File | Purpose |
|-------|------|---------|
| User | `~/.claude/settings.json` | Safe-everywhere rules: read tools, git read ops, common CLI. **This is where subagent permissions must live due to issue #37730.** |
| Project | `.claude/settings.json` | Stack-specific: pnpm, vitest, playwright. Commit to repo. |
| Local | `.claude/settings.local.json` | Machine-specific: paths, MCP server credentials, `allowWrite` for temp dirs. Git-ignored. |

Key insight: array settings **merge** across all scopes. If user scope allows `Bash(git status)` and project scope allows `Bash(pnpm *)`, both are active. But a deny at any scope wins over an allow at any scope.

---

## 2. Sandbox Network Allow-List Curation

### Discovery techniques

**Logging hook approach** (recommended): Add a PostToolUse hook that logs every bash command and its network activity:

```jsonc
// .claude/settings.json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "echo \"$(date -Iseconds) | $CLAUDE_TOOL_INPUT\" >> ~/.claude/tool-audit.log",
          "async": true
        }]
      }
    ]
  }
}
```

Then after a session, grep the log for network-touching commands (curl, fetch, npm install, etc.) and identify missing domains.

**Sandbox violation logging**: When the sandbox blocks a network request, the error surfaces in the agent's output. Run a session, collect the errors, and add missing domains. The `x-deny-reason` header from the egress proxy indicates the blocked domain.

**mitmproxy approach**: Some teams run mitmproxy between the sandbox and the internet to capture all egress, then curate the allow-list from the traffic log. This is the most complete approach but requires setup.

### Recommended network allow-list for your stack

```jsonc
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "network": {
      "allowedDomains": [
        // Package registries — SAFE, always allow
        "registry.npmjs.org",
        "*.npmjs.org",
        "registry.yarnpkg.com",
        "pypi.org",
        "files.pythonhosted.org",
        "proxy.golang.org",
        "sum.golang.org",
        "storage.googleapis.com",
        
        // Git hosting — SAFE
        "github.com",
        "api.github.com",
        "*.githubusercontent.com",
        
        // Your deployment/infra stack — MODERATE RISK (can deploy)
        "railway.app",
        "*.railway.app",
        "api.cloudflare.com",
        "neon.tech",
        "*.neon.tech",
        "api.upstash.com",
        "*.upstash.io",
        
        // Auth/billing — MODERATE RISK
        "api.stripe.com",
        "api.workos.com",
        
        // Project management
        "api.linear.app",
        "linear.app",
        
        // Secrets management
        "*.1password.com",
        
        // Claude Code itself
        "api.anthropic.com",
        "*.claude.ai",
        
        // Docs sites agents commonly fetch — LOW RISK (read-only)
        "docs.github.com",
        "nodejs.org",
        "developer.mozilla.org"
      ]
    }
  }
}
```

### Safe-to-permanently-allow vs. interactive

**Permanently allow:** Package registries, git hosts, docs sites, your own API domains. These are read-heavy, well-known, and the sandbox filesystem restrictions already prevent writing secrets to disk.

**Keep interactive:** Any domain the agent reaches for ad-hoc (random blog, Stack Overflow, arbitrary API endpoints). If you're using Context7 or web research tools, those need broad access and fight against tight allow-lists — this is a real tension. The community solution is to run research-mode tasks with a looser sandbox profile or in a devcontainer.

### Tail of low-traffic hosts

The npm registry has mirrors (npmmirror.com, etc.) that some packages redirect to. CDNs like `cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com` get hit by postinstall scripts. Rather than chasing each one, add `*.jsdelivr.net`, `*.unpkg.com`, `*.cloudflare.com` preemptively for Node projects.

---

## 3. Hooks as an Ergonomics Layer

### Current state (April 2026)

Claude Code supports **12+ lifecycle events** with **4 handler types** (command, http, prompt, agent). The most useful for permission ergonomics:

- **PreToolUse**: Fire before any tool. Can return `allow`, `deny`, or `ask`. Can modify tool inputs.
- **PostToolUse**: Fire after completion. Good for auto-formatting and logging.
- **PermissionRequest**: Fire when Claude is about to show a permission dialog. Can auto-approve/deny.
- **SessionStart**: Inject context at session start. Good for loading env info.
- **SubagentStop**: Fire when subagents complete. Added for orchestration workflows.

### Recommended hook set

#### Pre-bash firewall (auto-deny dangerous patterns)

```bash
#!/usr/bin/env bash
# ~/.claude/hooks/pre-bash-firewall.sh
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Block destructive operations
DENY_PATTERNS=(
  'rm -rf /'
  'rm -rf ~'
  'rm -rf \.'
  'git push.*--force'
  'git push.*-f '
  'git reset --hard'
  'git clean -fd'
  'DROP TABLE'
  'DROP DATABASE'
  'chmod 777'
  'curl.*\| ?sh'
  'curl.*\| ?bash'
  'wget.*\| ?sh'
)

for pattern in "${DENY_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qEi "$pattern"; then
    echo "BLOCKED by pre-bash-firewall: matches pattern '$pattern'. Rephrase or use a safer alternative." >&2
    exit 2
  fi
done

exit 0
```

#### Audit logger (log all tool calls)

```bash
#!/usr/bin/env bash
# ~/.claude/hooks/audit-logger.sh
set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')
SESSION=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

echo "$(date -Iseconds) | session=$SESSION | tool=$TOOL | input=$TOOL_INPUT" >> ~/.claude/audit.log

exit 0
```

#### Hook configuration in settings.json

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/pre-bash-firewall.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/audit-logger.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

### Key constraints to know

- **Hooks can tighten but not loosen restrictions.** A PreToolUse hook returning `allow` does NOT bypass deny rules from settings. But a hook returning `deny` blocks even in `bypassPermissions` mode. This is by design.
- **Hooks fire in parallel.** If multiple hooks match, the most restrictive result wins.
- **Performance matters.** Hooks that fire on every tool call (e.g., the audit logger above) should use `"async": true` to avoid slowing the agent loop. Anthropic's ClaudeLog warns that unnecessarily-firing hooks can extremely slow down the agent.
- **v2.1.80 fix**: A bug where PreToolUse hooks returning `allow` could bypass deny rules was fixed in March 2026. Defense-in-depth is still recommended.

---

## 4. Subagent + Worktree Permissions

### The core problem

**Subagents do NOT reliably inherit the parent's permission allow-list.** This is a confirmed bug (GitHub issue #37730, filed March 2026, tagged `area:agents` + `area:permissions` + `has repro`).

Specific failure modes:

1. Permissions set in project-scoped settings (`.claude/settings.json`) are loaded by the parent but not by worktree-isolated subagents, because the worktree has a different filesystem path and the project-scoped user settings (`~/.claude/projects/<path>/settings.json`) don't resolve.

2. Even with global settings (`~/.claude/settings.json`), subagents sometimes re-prompt for commands that the parent had already allowed.

3. "Yes, and don't ask again" in a subagent only persists for that subagent's session. The next subagent prompts again.

### Best workarounds (as of v2.1.101)

1. **Put ALL critical permissions in `~/.claude/settings.json` (user scope)**, not project scope. User-scope settings are loaded regardless of the working directory path.

2. **Use `autoAllowBashIfSandboxed: true`** — this sidesteps the per-command permission problem entirely for bash commands. If the sandbox is on, bash commands run without prompting.

3. **Use agent definition frontmatter** to set `permissionMode` and `tools`:

```yaml
---
name: implementer
description: Implements code changes in an isolated worktree
tools: Read, Edit, Write, Bash, Grep, Glob
isolation: worktree
permissionMode: acceptEdits
model: sonnet
---
```

The `tools` field restricts which tools the subagent can use (narrowing rather than broadening). The `permissionMode` field sets the subagent's mode independently.

4. **v2.1.72 added ExitWorktree** and **v2.1.75+ model inheritance** — team agents now correctly inherit the permission patterns of their leader. But single subagents via the Task/Agent tool may still exhibit the inheritance bug.

### Worktree-specific sandbox behavior

The sandbox `allowWrite` list automatically includes git worktree paths (`.claude/worktrees/`). The sandbox's `denyWrite` list automatically protects `.git/` metadata (HEAD, objects, refs, hooks, config) to prevent RCE via crafted git hooks. Worktree sessions share project configs and auto-memory across worktrees of the same repository.

---

## 5. MCP Server Permission Patterns

### Current guidance

Anthropic's position: "We encourage either writing your own MCP servers or using MCP servers from providers that you trust. Anthropic does not manage or audit any MCP servers."

**There is no built-in per-tool gating for MCP servers.** When you connect a Linear MCP server, all of its tools are available. Claude Code uses Tool Search (on-demand discovery) so not all tools are loaded into context simultaneously, but any tool can be invoked when the model decides it's relevant.

### How to scope MCP tools

1. **Use `allowedMcpServers` / `deniedMcpServers` in settings** to control which servers can be connected at all:

```jsonc
{
  "allowedMcpServers": [
    { "serverName": "linear" },
    { "serverName": "github" },
    { "serverUrl": "https://mcp.linear.app/*" }
  ],
  "deniedMcpServers": [
    { "serverName": "dangerous-server" }
  ]
}
```

2. **Use PreToolUse hooks to gate specific MCP tool calls.** The `tool_name` in hook input for MCP tools is the MCP tool name (e.g., `mcp__linear__create_issue`). You can deny specific tools:

```bash
#!/usr/bin/env bash
# Block destructive MCP operations
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')

DENIED_MCP_TOOLS=(
  "mcp__linear__delete_issue"
  "mcp__github__delete_repository"
  "mcp__github__merge_pull_request"
)

for denied in "${DENIED_MCP_TOOLS[@]}"; do
  if [ "$TOOL" = "$denied" ]; then
    echo "BLOCKED: $TOOL requires explicit approval. Use the Linear/GitHub UI directly." >&2
    exit 2
  fi
done

exit 0
```

3. **Credential scoping**: Give MCP servers the narrowest credential possible. A Linear API key should be scoped to the specific team/workspace. A GitHub token should use fine-grained PATs with repository-level permissions.

### Known incidents and risks

- **CVE-2025-68143/68144/68145**: Three vulnerabilities in `mcp-server-git` (arbitrary file read, command injection, SSRF). These were in a community MCP server, not an Anthropic product.
- **OWASP MCP Top 10 (2026)**: Tool poisoning, prompt injection via tool descriptions, command injection through tool parameters, shadow MCP servers, and secret exposure are all catalogued risks.
- **No public incidents with Linear MCP specifically**, but the general risk pattern is clear: any MCP server that can write (create issues, modify records, send messages) is a potential vector for prompt injection to cause side effects.

### Recommendation for your setup

For Linear MCP: allow all read tools, hook-gate write tools (create/update/delete). For GitHub MCP via `gh` CLI: already gated by your permission allow-list patterns for `Bash(gh *)`.

---

## 6. `skipDangerousModePermissionPrompt` and Auto-Approval Trade-offs

### What it actually does

This flag (`--dangerously-skip-permissions` or `skipPermissionsMode: true` in settings) bypasses ALL permission prompts. Claude runs every tool call without asking. It does NOT disable the sandbox — sandbox and permissions are separate layers.

### Community consensus (April 2026)

**For local interactive work: don't use it.** The approval prompts are annoying but they're your last line of defense against prompt injection. A Reddit thread cited by Apigene found that developers using this flag daily reported incidents including getting locked out of servers, the agent committing and pushing to main without review, and DEV/LIVE confusion after context compression.

**For unattended pipelines: use it ONLY inside a container/VM.** This is the near-universal recommendation from Anthropic's docs, Trail of Bits, and the community. The container IS the security boundary; the permission system is redundant inside it.

### Auto Mode (March 2026)

Anthropic released **Auto mode** as a safer alternative. A Sonnet 4.6-based classifier evaluates risk per tool call, auto-approving safe operations and blocking dangerous ones. Available for Team/Enterprise plans. This is closer to what you want: a smart layer that approves routine operations and flags risky ones. However, as of April 2026 it's still new and the classifier's behavior isn't fully documented.

### Guardrails teams use around auto-accept

1. **Dedicated devcontainer** — mount only the project directory, nothing else
2. **Ephemeral VM** — Firecracker, Fly.io Sprites, or Daytona; destroyed after each session
3. **Git pre-commit hooks** — lint, test, and security scan before any commit lands
4. **Branch protection** — the agent can only commit to feature branches, never main
5. **Test gates via Stop hooks** — block the agent from finishing until tests pass:

```jsonc
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "npm test || (echo 'Tests failing. Fix before completing.' >&2 && exit 2)"
      }]
    }]
  }
}
```

---

## 7. Container / VM Isolation as an Alternative

### The field has moved toward containers — decisively

The early-2026 consensus is clear: for long, unattended, walkaway-able pipelines, container isolation is the recommended approach, not trying to perfect the local sandbox allow-list.

### Options from most to least overhead

| Approach | Isolation Level | Boot Time | Best For |
|----------|----------------|-----------|----------|
| **Anthropic reference devcontainer** | Docker container + firewall | ~30s | Teams wanting official support |
| **Trail of Bits devcontainer** | Docker + hardened security | ~30s | Security-sensitive projects |
| **Sandcat** | Docker Compose + WireGuard + MITM proxy | ~60s | Secret hiding, domain allowlists |
| **Docker Desktop Sandboxes** (v4.58+) | MicroVM per agent | ~5s | macOS/Windows with Docker Desktop |
| **Daytona** | Dedicated kernel per sandbox, open-source | ~90ms | Self-hosted, high-volume |
| **E2B** | Firecracker microVM | ~150ms | SaaS, LangChain/Anthropic SDK integration |
| **Fly.io Sprites** | Firecracker + 100GB NVMe | ~1-12s | Persistent multi-day agent projects |
| **Matchlock** | Firecracker (Linux) / Apple Virtualization (macOS) | — | Self-hosted on bare metal |

### Recommended approach for your Proxmox homelab

Given you already have Proxmox with LXC containers, the most natural fit is:

1. Create an LXC container (or a lightweight VM) dedicated to Claude Code pipelines
2. Mount your project repo via bind mount (read-write)
3. Install Claude Code, pnpm, node, git, gh CLI inside the container
4. Set the container's firewall rules to mirror your `allowedDomains` list
5. Run `claude --dangerously-skip-permissions` inside the container
6. After the pipeline completes, review changes via `git diff` from the host

This gives you the same security posture as Anthropic's reference devcontainer but without Docker-in-Docker overhead. Your Firewalla Gold can handle the network isolation at the router level if needed.

### Anthropic's reference devcontainer config (key excerpts)

The official devcontainer at `code.claude.com/docs/en/devcontainer` consists of three files:

- **devcontainer.json**: Container settings, VS Code extensions, volume mounts
- **Dockerfile**: Image with Claude Code pre-installed
- **init-firewall.sh**: iptables rules that restrict outbound to whitelisted domains only, with a default-deny policy

The firewall script is the critical piece. It allows: npm registry, GitHub, Claude API, and a few others. Everything else is blocked at the iptables level, not the application level.

---

## Proposed Configuration for Your Environment

### `~/.claude/settings.json` (user scope)

```jsonc
{
  "$schema": "https://json-schema.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      // File tools — always allow
      "Read(*)",
      "Edit(*)",
      "Write(*)",
      "MultiEdit(*)",
      "Grep(*)",
      "Glob(*)",
      
      // Git operations
      "Bash(git *)",             // RISK: broad, but sandbox constrains filesystem
      
      // Node/pnpm
      "Bash(pnpm *)",
      "Bash(npm run *)",
      "Bash(npm test *)",
      "Bash(npm install *)",
      "Bash(npx *)",            // RISK: can download+execute packages. Sandbox network limits exposure.
      "Bash(node *)",
      "Bash(tsx *)",
      "Bash(vitest *)",
      "Bash(playwright *)",
      
      // Python/Go
      "Bash(python3 *)",
      "Bash(python *)",
      "Bash(uv *)",
      "Bash(go *)",
      
      // GitHub CLI
      "Bash(gh *)",             // RISK: can create PRs, merge, delete. Hook-gate destructive ops.
      
      // Common CLI
      "Bash(cat *)", "Bash(head *)", "Bash(tail *)", "Bash(wc *)",
      "Bash(ls *)", "Bash(find *)", "Bash(grep *)", "Bash(rg *)",
      "Bash(fd *)", "Bash(jq *)", "Bash(sed *)", "Bash(awk *)",
      "Bash(sort *)", "Bash(uniq *)", "Bash(tr *)", "Bash(cut *)",
      "Bash(tee *)", "Bash(mkdir *)", "Bash(cp *)", "Bash(mv *)",
      "Bash(touch *)", "Bash(echo *)", "Bash(printf *)",
      "Bash(which *)", "Bash(env *)", "Bash(pwd)",
      "Bash(date *)", "Bash(realpath *)", "Bash(dirname *)",
      "Bash(basename *)", "Bash(xargs *)", "Bash(diff *)",
      "Bash(curl *)",           // RISK: network access. Sandbox domain list is the guard.
      "Bash(tree *)"
    ],
    "deny": [
      // Secrets — never read
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "Read(//*/.ssh/**)",
      "Read(//*/.aws/**)"
    ]
  },
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["docker"],    // Docker needs host access; keep prompted
    "allowUnsandboxedCommands": false,
    "failIfUnavailable": true,         // Fail-closed if sandbox can't start
    "filesystem": {
      "allowWrite": [
        "~/.claude",
        "/tmp"
        // Project dir is allowed by default
      ]
    },
    "network": {
      "allowedDomains": [
        // Package registries
        "registry.npmjs.org",
        "*.npmjs.org",
        "registry.yarnpkg.com",
        "pypi.org",
        "files.pythonhosted.org",
        "proxy.golang.org",
        "sum.golang.org",
        "storage.googleapis.com",
        "cdn.jsdelivr.net",
        "unpkg.com",
        "*.cloudflare.com",
        
        // Git
        "github.com",
        "api.github.com",
        "*.githubusercontent.com",
        
        // Your infra
        "*.railway.app",
        "api.cloudflare.com",
        "*.neon.tech",
        "api.upstash.com",
        "*.upstash.io",
        "*.supabase.co",
        "*.supabase.in",
        "api.stripe.com",
        "api.workos.com",
        
        // MCP + project management
        "api.linear.app",
        "linear.app",
        
        // Secrets
        "*.1password.com",
        
        // Claude/Anthropic
        "api.anthropic.com",
        "*.claude.ai",
        
        // Docs (for Context7, find-docs, etc.)
        "developer.mozilla.org",
        "nodejs.org",
        "docs.github.com"
      ]
    }
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "~/.claude/hooks/pre-bash-firewall.sh"
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [{
          "type": "command",
          "command": "~/.claude/hooks/audit-logger.sh",
          "async": true
        }]
      }
    ],
    "Notification": [
      {
        "hooks": [{
          "type": "command",
          "command": "notify-send 'Claude Code' 'Awaiting input' 2>/dev/null || true"
        }]
      }
    ]
  }
}
```

### `~/.claude/hooks/pre-bash-firewall.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Hard deny list — patterns that should never run unattended
DENY_PATTERNS=(
  'rm -rf /'
  'rm -rf ~'
  'rm -rf \$HOME'
  'git push.*--force'
  'git push.*-f '
  'git reset --hard'
  'git clean -fd'
  'DROP TABLE'
  'DROP DATABASE'
  'TRUNCATE '
  'chmod 777'
  'chmod -R 777'
  '| ?sh$'
  '| ?bash$'
  'curl.*| ?sh'
  'wget.*| ?sh'
  'npm publish'
  'npm login'
  'npm adduser'
  'pnpm publish'
)

for pattern in "${DENY_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qEi "$pattern"; then
    echo "BLOCKED by firewall: matches '$pattern'. Use a safer alternative or run manually." >&2
    exit 2
  fi
done

exit 0
```

### `~/.claude/hooks/audit-logger.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
SESSION=$(echo "$INPUT" | jq -r '.session_id // "?"')
SUMMARY=$(echo "$INPUT" | jq -c '.tool_input // {}' | head -c 500)

echo "$(date -Iseconds)|$SESSION|$TOOL|$SUMMARY" >> ~/.claude/audit.log
exit 0
```

Make both executable: `chmod +x ~/.claude/hooks/*.sh`

---

## What's Worth Rebuilding — Fundamentally Unsolvable in Current Model

### Problems the config above fixes (~80% of friction)

- ✅ Per-command bash prompts → eliminated by `autoAllowBashIfSandboxed`
- ✅ Missing network domains → comprehensive allow-list covers Node/Python/Go/your-infra
- ✅ Dangerous commands running unnoticed → PreToolUse firewall hook blocks them deterministically
- ✅ No audit trail → PostToolUse logger captures everything
- ✅ Missing domains surfacing as opaque errors → `failIfUnavailable: true` makes sandbox failures explicit

### Problems that require workarounds (partial solutions exist)

- ⚠️ **Subagent permission re-prompting** — Bug #37730, partially mitigated by user-scope settings + `autoAllowBashIfSandboxed`. No full fix yet. Watch the issue.
- ⚠️ **MCP per-tool gating** — No native support. Hook-based gating works but requires maintaining a deny list of tool names that can change with MCP server updates.
- ⚠️ **Context7 / web research vs. tight network allow-list** — Irreconcilable tension. Research tools need broad internet access; the sandbox wants a tight list. Solution: run research-mode tasks with a separate, looser profile, or in a container.

### Problems that need a harness change or external wrapper

- ❌ **Dynamic domain approval during a run** — When the agent hits a new domain mid-pipeline, the sandbox blocks it with no way to approve without restarting the session. This needs an interactive domain-approval flow built into the sandbox, which doesn't exist. External wrapper: run a proxy that logs blocked domains and can be live-updated.
- ❌ **Permission inheritance for subagents in worktrees** — The path-based project settings resolution is architecturally mismatched with worktrees. This needs a fix in Claude Code's settings loader to resolve permissions relative to the git root, not the worktree path.
- ❌ **Granular MCP tool permissions** — The settings system has `allowedMcpServers`/`deniedMcpServers` for server-level control but nothing for tool-level control. This needs either (a) an `allowedMcpTools` setting or (b) the MCP protocol itself to support tool-level authorization scopes.
- ❌ **Sandbox network allow-list for subprocesses vs. MCP servers** — MCP servers run outside the sandbox (they're separate processes). Network restrictions on MCP servers must be configured at the MCP server level or via container networking. The sandbox's `allowedDomains` only applies to bash subprocesses.

---

## Primary Sources

| Source | URL | Recency |
|--------|-----|---------|
| Claude Code Settings (official) | code.claude.com/docs/en/settings | April 2026 |
| Claude Code Sandboxing (official) | code.claude.com/docs/en/sandboxing | April 2026 |
| Claude Code Security (official) | code.claude.com/docs/en/security | April 2026 |
| Claude Code Hooks Guide (official) | code.claude.com/docs/en/hooks-guide | April 2026 |
| Claude Code Devcontainer (official) | code.claude.com/docs/en/devcontainer | April 2026 |
| Subagent permission inheritance bug | github.com/anthropics/claude-code/issues/37730 | March 2026 |
| Trail of Bits devcontainer | github.com/trailofbits/claude-code-devcontainer | January 2026 |
| Steve Kinney hook examples | stevekinney.com/courses/ai-development/claude-code-hook-examples | March 2026 |
| MicroVM isolation landscape | emirb.github.io/blog/microvm-2026/ | March 2026 |
| everything-claude-code security guide | github.com/affaan-m/everything-claude-code | February 2026 |
| SmartScope auto-approve guide | smartscope.blog/en/generative-ai/claude/claude-code-auto-permission-guide/ | April 2026 |
| Neon subagent isolation guide | neon.com/guides/isolated-subagents-neon-branching | March 2026 |
| OWASP MCP Top 10 | Referenced in multiple sources | 2026 |
| Anthropic April 2026 changelog analysis | help.apiyi.com/en/claude-code-changelog-2026-april-updates-en.html | April 2026 |
