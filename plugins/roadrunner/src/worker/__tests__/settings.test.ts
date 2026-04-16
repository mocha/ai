import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generateWorkerSettings, installWorkerSettings } from '../settings.js';
import type { WorkerSettings } from '../settings.js';
import type { WorkerConfig } from '../types.js';
import type { RiskLevel } from '../../orchestrator/types.js';

function makeConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    base_branch: 'main',
    worktree_root: '.worktrees',
    artifact_root: '.roadrunner',
    claude_bin: 'claude',
    methodology_path: null,
    timeout_overrides: null,
    ...overrides,
  };
}

// ─── generateWorkerSettings ───────────────────────────────────────────────────

describe('generateWorkerSettings', () => {
  const config = makeConfig();

  describe('trivial risk — Bash is denied', () => {
    let settings: WorkerSettings;
    beforeEach(() => {
      settings = generateWorkerSettings('trivial', config, 1);
    });

    it('includes Bash in deny list', () => {
      expect(settings.permissions.deny).toContain('Bash');
    });

    it('does not include Bash in allow list', () => {
      expect(settings.permissions.allow).not.toContain('Bash');
    });

    it('includes core read/write tools in allow list', () => {
      expect(settings.permissions.allow).toContain('Read');
      expect(settings.permissions.allow).toContain('Write');
      expect(settings.permissions.allow).toContain('Edit');
      expect(settings.permissions.allow).toContain('Glob');
      expect(settings.permissions.allow).toContain('Grep');
    });
  });

  describe.each(['standard', 'elevated', 'critical'] as RiskLevel[])(
    '%s risk — Bash is allowed',
    (risk) => {
      let settings: WorkerSettings;
      beforeEach(() => {
        settings = generateWorkerSettings(risk, config, 1);
      });

      it('includes Bash in allow list', () => {
        expect(settings.permissions.allow).toContain('Bash');
      });

      it('does not include Bash in deny list', () => {
        expect(settings.permissions.deny).not.toContain('Bash');
      });

      it('includes core read/write tools in allow list', () => {
        expect(settings.permissions.allow).toContain('Read');
        expect(settings.permissions.allow).toContain('Write');
        expect(settings.permissions.allow).toContain('Edit');
        expect(settings.permissions.allow).toContain('Glob');
        expect(settings.permissions.allow).toContain('Grep');
      });
    },
  );

  describe('always-denied tools', () => {
    it.each(['trivial', 'standard', 'elevated', 'critical'] as RiskLevel[])(
      'WebSearch is denied for %s',
      (risk) => {
        const s = generateWorkerSettings(risk, config, 1);
        expect(s.permissions.deny).toContain('WebSearch');
      },
    );

    it.each(['trivial', 'standard', 'elevated', 'critical'] as RiskLevel[])(
      'WebFetch is denied for %s',
      (risk) => {
        const s = generateWorkerSettings(risk, config, 1);
        expect(s.permissions.deny).toContain('WebFetch');
      },
    );

    it.each(['trivial', 'standard', 'elevated', 'critical'] as RiskLevel[])(
      'Skill is denied for %s',
      (risk) => {
        const s = generateWorkerSettings(risk, config, 1);
        expect(s.permissions.deny).toContain('Skill');
      },
    );

    it.each(['trivial', 'standard', 'elevated', 'critical'] as RiskLevel[])(
      'NotebookEdit is denied for %s',
      (risk) => {
        const s = generateWorkerSettings(risk, config, 1);
        expect(s.permissions.deny).toContain('NotebookEdit');
      },
    );
  });

  describe('hook entries', () => {
    it('PostToolUse references budget-monitor.sh', () => {
      const s = generateWorkerSettings('standard', config, 1);
      expect(s.hooks.PostToolUse).toHaveLength(1);
      expect(s.hooks.PostToolUse[0].command).toBe('bash hooks/budget-monitor.sh');
    });

    it('PreCompact references compaction-detector.sh', () => {
      const s = generateWorkerSettings('standard', config, 1);
      expect(s.hooks.PreCompact).toHaveLength(1);
      expect(s.hooks.PreCompact[0].command).toBe('bash hooks/compaction-detector.sh');
    });

    it('Stop references budget-report.sh', () => {
      const s = generateWorkerSettings('standard', config, 1);
      expect(s.hooks.Stop).toHaveLength(1);
      expect(s.hooks.Stop[0].command).toBe('bash hooks/budget-report.sh');
    });

    it('SessionStart is empty', () => {
      const s = generateWorkerSettings('standard', config, 1);
      expect(s.hooks.SessionStart).toEqual([]);
    });

    it('PreToolUse is empty', () => {
      const s = generateWorkerSettings('standard', config, 1);
      expect(s.hooks.PreToolUse).toEqual([]);
    });
  });

  describe('MCP servers', () => {
    it('includes context-mode MCP server', () => {
      const s = generateWorkerSettings('standard', config, 1);
      expect(s.mcpServers).toHaveProperty('context-mode');
      expect(s.mcpServers['context-mode'].command).toBe('npx');
      expect(s.mcpServers['context-mode'].args).toEqual(['-y', '@anthropic/context-mode']);
    });
  });

  describe('pure function', () => {
    it('produces identical output for identical inputs', () => {
      const a = generateWorkerSettings('standard', config, 5);
      const b = generateWorkerSettings('standard', config, 5);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('output is JSON-parseable', () => {
      const s = generateWorkerSettings('elevated', config, 3);
      expect(() => JSON.parse(JSON.stringify(s))).not.toThrow();
    });
  });
});

// ─── installWorkerSettings ────────────────────────────────────────────────────

describe('installWorkerSettings', () => {
  let tmpDir: string;
  const config = makeConfig();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates .claude/ directory', () => {
    installWorkerSettings(tmpDir, 'standard', config, 1);
    expect(fs.existsSync(path.join(tmpDir, '.claude'))).toBe(true);
  });

  it('writes settings.json inside .claude/', () => {
    installWorkerSettings(tmpDir, 'standard', config, 1);
    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);
  });

  it('settings.json is valid JSON', () => {
    installWorkerSettings(tmpDir, 'standard', config, 1);
    const raw = fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('settings.json content matches generateWorkerSettings output', () => {
    installWorkerSettings(tmpDir, 'elevated', config, 7);
    const raw = fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw) as WorkerSettings;
    const expected = generateWorkerSettings('elevated', config, 7);
    expect(parsed).toEqual(expected);
  });

  it('creates hooks/ directory', () => {
    installWorkerSettings(tmpDir, 'standard', config, 1);
    expect(fs.existsSync(path.join(tmpDir, 'hooks'))).toBe(true);
  });

  it('is idempotent — running twice produces identical settings.json', () => {
    installWorkerSettings(tmpDir, 'standard', config, 1);
    const first = fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8');

    installWorkerSettings(tmpDir, 'standard', config, 1);
    const second = fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8');

    expect(first).toBe(second);
  });

  it('does not throw when hook source scripts are missing', () => {
    // Source scripts in src/worker/hooks/ don't exist yet — should warn but not fail
    expect(() => installWorkerSettings(tmpDir, 'standard', config, 1)).not.toThrow();
  });

  it('trivial risk: settings.json has Bash in deny list', () => {
    installWorkerSettings(tmpDir, 'trivial', config, 2);
    const raw = fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw) as WorkerSettings;
    expect(parsed.permissions.deny).toContain('Bash');
    expect(parsed.permissions.allow).not.toContain('Bash');
  });

  it('standard risk: settings.json has Bash in allow list', () => {
    installWorkerSettings(tmpDir, 'standard', config, 3);
    const raw = fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw) as WorkerSettings;
    expect(parsed.permissions.allow).toContain('Bash');
    expect(parsed.permissions.deny).not.toContain('Bash');
  });
});
