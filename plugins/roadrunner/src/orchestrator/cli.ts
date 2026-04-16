#!/usr/bin/env node

import { createActor } from 'xstate';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { orchestratorMachine } from './machine.js';
import { createPersistence } from './persistence.js';
import { createEventBus } from './bus.js';
import { setDispatcher } from './actions.js';
import type { OrchestratorEvent } from './events.js';

const baseDir = process.env.ROADRUNNER_STATE_DIR || '.roadrunner';
const persistence = createPersistence(baseDir);

// Restore or create fresh
const snapshot = persistence.restore();
persistence.cleanTmp();

const actor = createActor(
  orchestratorMachine,
  snapshot ? { snapshot } : {}
);

// Wire up event bus
const bus = createEventBus(actor);
setDispatcher(bus.dispatch);

// Persist after every transition
actor.subscribe((state) => {
  persistence.persist(actor);
  // Log current state value (handles nested compound states)
  const stateValue = typeof state.value === 'string'
    ? state.value
    : JSON.stringify(state.value);
  console.log(`[state] ${stateValue}`);
});

// Start
actor.start();
const initialState = actor.getSnapshot().value;
const initialValue = typeof initialState === 'string'
  ? initialState
  : JSON.stringify(initialState);
console.log(`[orchestrator] started in state: ${initialValue}`);

// Read events from file or stdin
const eventFile = process.argv[2];
if (eventFile) {
  try {
    const content = fs.readFileSync(eventFile, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as OrchestratorEvent;
        console.log(`[input] ${event.type}`);
        bus.sendEvent(event);
      } catch (err) {
        console.error(`[error] invalid JSON: ${line}`);
      }
    }
  } catch (err) {
    console.error(`[error] could not read file: ${eventFile}`);
    process.exit(1);
  }
} else {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event = JSON.parse(trimmed) as OrchestratorEvent;
      console.log(`[input] ${event.type}`);
      bus.sendEvent(event);
    } catch {
      console.error(`[error] invalid JSON: ${trimmed}`);
    }
  });
  console.log('[orchestrator] reading events from stdin (one JSON per line)');
}
