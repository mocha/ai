import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AnyActorRef, Snapshot } from 'xstate';

export interface Persistence {
  persist: (actor: AnyActorRef) => void;
  restore: () => Snapshot<unknown> | null;
  cleanTmp: () => void;
}

export function createPersistence(baseDir: string): Persistence {
  const stateFile = path.join(baseDir, 'state.json');
  const tmpFile = path.join(baseDir, 'state.json.tmp');

  return {
    persist(actor: AnyActorRef): void {
      const snapshot = actor.getPersistedSnapshot();
      const json = JSON.stringify(snapshot, null, 2);

      // Ensure directory exists
      fs.mkdirSync(baseDir, { recursive: true });

      // Atomic write: write to tmp, then rename
      fs.writeFileSync(tmpFile, json, 'utf-8');
      fs.renameSync(tmpFile, stateFile);
    },

    restore(): Snapshot<unknown> | null {
      try {
        if (!fs.existsSync(stateFile)) return null;
        const raw = fs.readFileSync(stateFile, 'utf-8');
        return JSON.parse(raw);
      } catch (err) {
        // Corrupt state file — archive and start fresh
        const timestamp = Date.now();
        const corruptPath = path.join(baseDir, `state.json.corrupt.${timestamp}`);
        try {
          fs.renameSync(stateFile, corruptPath);
        } catch {
          // If rename fails too, just try to delete
          try { fs.unlinkSync(stateFile); } catch { /* ignore */ }
        }
        console.warn(`[persistence] Corrupt state file archived to ${corruptPath}. Starting fresh.`);
        return null;
      }
    },

    cleanTmp(): void {
      try {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      } catch {
        // Ignore
      }
    },
  };
}
