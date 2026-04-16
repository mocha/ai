import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../bus.js';
import type { OrchestratorCommand } from '../commands.js';

// Mock actor with just a send method
function mockActor() {
  return { send: vi.fn() } as any;
}

// A valid command for testing
function testCommand(): OrchestratorCommand {
  return { type: 'QUERY_NEXT_TASK', filter: { status: 'pending', dependencies_met: true } };
}

describe('EventBus', () => {
  describe('sendEvent', () => {
    it('forwards events to the actor', () => {
      const actor = mockActor();
      const bus = createEventBus(actor);
      const event = { type: 'START' as const, input: { type: 'raw-idea', content: 'test', user_risk_override: null } };
      bus.sendEvent(event);
      expect(actor.send).toHaveBeenCalledWith(event);
    });
  });

  describe('dispatch', () => {
    it('calls registered handlers', () => {
      const actor = mockActor();
      const bus = createEventBus(actor);
      const handler = vi.fn();
      bus.onCommand(handler);
      const cmd = testCommand();
      bus.dispatch(cmd);
      expect(handler).toHaveBeenCalledWith(cmd);
    });

    it('logs when no handlers registered', () => {
      const actor = mockActor();
      const bus = createEventBus(actor);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      bus.dispatch(testCommand());
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('retries on transient failure and succeeds', () => {
      const actor = mockActor();
      const bus = createEventBus(actor);
      let calls = 0;
      bus.onCommand(() => { calls++; if (calls === 1) throw new Error('transient'); });
      bus.dispatch(testCommand());
      expect(calls).toBe(2);
      expect(actor.send).not.toHaveBeenCalled(); // No error escalated
    });

    it('sends DISPATCH_ERROR after exhausting retries', () => {
      const actor = mockActor();
      const bus = createEventBus(actor);
      bus.onCommand(() => { throw new Error('persistent'); });
      bus.dispatch(testCommand());
      expect(actor.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'DISPATCH_ERROR',
        failed_command: 'QUERY_NEXT_TASK',
        attempts: 3,
      }));
    });

    it('calls multiple handlers', () => {
      const actor = mockActor();
      const bus = createEventBus(actor);
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.onCommand(h1);
      bus.onCommand(h2);
      bus.dispatch(testCommand());
      expect(h1).toHaveBeenCalled();
      expect(h2).toHaveBeenCalled();
    });
  });
});
