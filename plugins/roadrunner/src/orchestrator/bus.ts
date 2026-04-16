import type { AnyActorRef } from 'xstate';
import type { OrchestratorEvent } from './events.js';
import type { OrchestratorCommand } from './commands.js';

export type CommandHandler = (command: OrchestratorCommand) => void;

export interface EventBus {
  sendEvent: (event: OrchestratorEvent) => void;
  onCommand: (handler: CommandHandler) => void;
  dispatch: (command: OrchestratorCommand) => void;
}

export function createEventBus(actor: AnyActorRef): EventBus {
  const handlers: CommandHandler[] = [];
  const MAX_RETRIES = 2;
  const BACKOFF_MS = [500, 2000];

  function sleepSync(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // Busy-wait for short retry delays
    }
  }

  return {
    sendEvent(event: OrchestratorEvent) {
      actor.send(event);
    },

    onCommand(handler: CommandHandler) {
      handlers.push(handler);
    },

    dispatch(command: OrchestratorCommand) {
      if (handlers.length === 0) {
        console.log(`[orchestrator] command: ${command.type}`, JSON.stringify(command, null, 2));
        return;
      }
      for (const handler of handlers) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            handler(command);
            break;
          } catch (err) {
            if (attempt < MAX_RETRIES) {
              sleepSync(BACKOFF_MS[attempt]);
              continue;
            }
            console.error(`[orchestrator] dispatch failed for ${command.type} after ${attempt + 1} attempts:`, err);
            actor.send({
              type: 'DISPATCH_ERROR' as const,
              failed_command: command.type,
              error_message: err instanceof Error ? err.message : String(err),
              attempts: attempt + 1,
            } as OrchestratorEvent);
          }
        }
      }
    },
  };
}
