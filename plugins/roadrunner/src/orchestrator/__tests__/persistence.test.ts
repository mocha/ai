import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createPersistence } from '../persistence.js';

describe('Persistence', () => {
  let tmpDir: string;

  function setup() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persistence-test-'));
    return createPersistence(tmpDir);
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('persist', () => {
    it('writes valid JSON to state file via atomic rename', () => {
      const p = setup();
      // Mock actor with getPersistedSnapshot
      const mockActor = {
        getPersistedSnapshot: () => ({ value: 'idle', context: { risk: 'standard' } }),
      } as any;
      p.persist(mockActor);

      const stateFile = path.join(tmpDir, 'state.json');
      expect(fs.existsSync(stateFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      expect(content.value).toBe('idle');
    });

    it('does not leave tmp file after successful write', () => {
      const p = setup();
      const mockActor = {
        getPersistedSnapshot: () => ({ value: 'triage' }),
      } as any;
      p.persist(mockActor);

      const tmpFile = path.join(tmpDir, 'state.json.tmp');
      expect(fs.existsSync(tmpFile)).toBe(false);
    });

    it('creates base directory if it does not exist', () => {
      const nestedDir = path.join(tmpDir, 'nested', 'dir');
      const p = createPersistence(nestedDir);
      const mockActor = {
        getPersistedSnapshot: () => ({ value: 'idle' }),
      } as any;
      p.persist(mockActor);

      expect(fs.existsSync(path.join(nestedDir, 'state.json'))).toBe(true);
    });
  });

  describe('restore', () => {
    it('returns parsed snapshot when state file exists', () => {
      const p = setup();
      fs.writeFileSync(path.join(tmpDir, 'state.json'), JSON.stringify({ value: 'triage', context: {} }));
      const result = p.restore();
      expect(result).toEqual({ value: 'triage', context: {} });
    });

    it('returns null when no state file exists', () => {
      const p = setup();
      expect(p.restore()).toBeNull();
    });

    it('archives corrupt file and returns null', () => {
      const p = setup();
      fs.writeFileSync(path.join(tmpDir, 'state.json'), 'not valid json {{{');
      const result = p.restore();
      expect(result).toBeNull();

      // Corrupt file should be archived
      const files = fs.readdirSync(tmpDir);
      const corruptFiles = files.filter(f => f.startsWith('state.json.corrupt.'));
      expect(corruptFiles.length).toBe(1);

      // Original should be gone
      expect(fs.existsSync(path.join(tmpDir, 'state.json'))).toBe(false);
    });
  });

  describe('cleanTmp', () => {
    it('removes tmp file if it exists', () => {
      const p = setup();
      const tmpFile = path.join(tmpDir, 'state.json.tmp');
      fs.writeFileSync(tmpFile, 'leftover');
      p.cleanTmp();
      expect(fs.existsSync(tmpFile)).toBe(false);
    });

    it('does nothing if tmp file does not exist', () => {
      const p = setup();
      // Should not throw
      p.cleanTmp();
    });
  });
});
