#!/usr/bin/env bash
# Pre-bash firewall — blocks destructive shell patterns before execution.
# Adapted from the sandbox ergonomics report (Section 3).
#
# Hook type: PreToolUse (matcher: Bash)
# Exit 2 = deny the tool call
# Exit 0 = no opinion (defer to permission system)
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Nothing to check if command is empty
if [ -z "$COMMAND" ]; then exit 0; fi

DENY_PATTERNS=(
  # Filesystem destruction
  'rm -rf /'
  'rm -rf ~'
  'rm -rf \$HOME'
  'rm -rf \.$'
  'rm -rf \. '

  # Git object store protection (shared across all worktrees)
  'rm -rf \.git/objects'
  'rm -rf \.git/refs'

  # Git history rewriting / force push
  'git push.*--force'
  'git push.*-f '
  'git reset --hard'
  'git clean -fd'

  # Database destruction
  'DROP TABLE'
  'DROP DATABASE'
  'TRUNCATE '

  # Permission footguns
  'chmod 777'
  'chmod -R 777'

  # Remote code execution
  'curl.*\| ?sh'
  'curl.*\| ?bash'
  'wget.*\| ?sh'
  'wget.*\| ?bash'
  '\| sh$'
  '\| bash$'

  # Package registry writes
  'npm publish'
  'npm login'
  'npm adduser'
  'pnpm publish'
)

for pattern in "${DENY_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qEi "$pattern"; then
    echo "BLOCKED by pre-bash-firewall: matches pattern '$pattern'. Rephrase or use a safer alternative." >&2
    exit 2
  fi
done

exit 0
