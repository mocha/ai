import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RiskLevel } from '../orchestrator/types.js';
import type { WorkerConfig } from './types.js';

export interface WorkerSettings {
  permissions: {
    allow: string[];
    deny: string[];
  };
  hooks: {
    SessionStart: HookEntry[];
    PreToolUse: HookEntry[];
    PostToolUse: HookEntry[];
    PreCompact: HookEntry[];
    Stop: HookEntry[];
  };
  mcpServers: Record<string, McpServerEntry>;
}

interface HookEntry {
  matcher: string;
  command: string;
}

interface McpServerEntry {
  command: string;
  args: string[];
}

/** Tools always denied regardless of risk level. */
const ALWAYS_DENIED = ['WebSearch', 'WebFetch', 'Skill', 'NotebookEdit'];

/** Tools allowed only for standard/elevated/critical (not trivial). */
const BASH_ALLOWED_RISKS: RiskLevel[] = ['standard', 'elevated', 'critical'];

/** Hook scripts to install (relative to worktree root). */
const HOOK_SCRIPTS = ['budget-monitor.sh', 'compaction-detector.sh', 'budget-report.sh'];

/**
 * Generate settings.json content for a worker session.
 * Pure function — no I/O.
 */
export function generateWorkerSettings(
  risk: RiskLevel,
  _config: WorkerConfig,
  _taskId: number,
): WorkerSettings {
  const allowedTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
  if (BASH_ALLOWED_RISKS.includes(risk)) {
    allowedTools.push('Bash');
  }

  const deniedTools = [...ALWAYS_DENIED];
  if (!BASH_ALLOWED_RISKS.includes(risk)) {
    deniedTools.push('Bash');
  }

  return {
    permissions: {
      allow: allowedTools,
      deny: deniedTools,
    },
    hooks: {
      SessionStart: [],
      PreToolUse: [],
      PostToolUse: [{ matcher: '', command: 'bash hooks/budget-monitor.sh' }],
      PreCompact: [{ matcher: '', command: 'bash hooks/compaction-detector.sh' }],
      Stop: [{ matcher: '', command: 'bash hooks/budget-report.sh' }],
    },
    mcpServers: {
      'context-mode': {
        command: 'npx',
        args: ['-y', '@anthropic/context-mode'],
      },
    },
  };
}

/**
 * Write settings.json and install hook scripts into a worktree.
 * Idempotent — running twice produces identical results.
 */
export function installWorkerSettings(
  worktreePath: string,
  risk: RiskLevel,
  config: WorkerConfig,
  taskId: number,
): void {
  // 1. Create .claude/ directory
  const claudeDir = path.join(worktreePath, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });

  // 2. Write settings.json
  const settings = generateWorkerSettings(risk, config, taskId);
  const settingsPath = path.join(claudeDir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  // 3. Create hooks/ directory
  const hooksDir = path.join(worktreePath, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  // 4. Copy hook scripts from src/worker/hooks/ relative to this module
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);
  const sourceHooksDir = path.join(thisDir, 'hooks');

  for (const script of HOOK_SCRIPTS) {
    const srcPath = path.join(sourceHooksDir, script);
    const destPath = path.join(hooksDir, script);

    if (!fs.existsSync(srcPath)) {
      process.stderr.write(
        `[settings] Warning: hook script not found at ${srcPath} — skipping\n`,
      );
      continue;
    }

    fs.copyFileSync(srcPath, destPath);

    // 5. Make hook scripts executable
    fs.chmodSync(destPath, 0o755);
  }
}
