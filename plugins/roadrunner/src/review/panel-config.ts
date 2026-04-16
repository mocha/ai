import type { RiskLevel } from '../orchestrator/types.js';
import type { PanelConfig } from './types.js';

/**
 * Get panel review configuration for a given risk level.
 * Encodes the risk matrix from spec section 10.
 */
export function getPanelConfig(risk: RiskLevel): PanelConfig {
  switch (risk) {
    case 'trivial':
      return {
        panel_size: 0,
        model: 'sonnet',
        max_rounds: 0,
        adaptive_narrowing: false,
      };
    case 'standard':
      return {
        panel_size: 3,
        model: 'sonnet',
        max_rounds: 2,
        adaptive_narrowing: false,
      };
    case 'elevated':
      return {
        panel_size: 4,
        model: 'sonnet',
        max_rounds: 2,
        adaptive_narrowing: false,
      };
    case 'critical':
      return {
        panel_size: 4,
        model: 'opus',
        max_rounds: 2,
        adaptive_narrowing: true,
      };
  }
}

/**
 * Get round-1 panel size for adaptive narrowing (critical risk only).
 * Uses 5 experts in round 1, narrows to 3 in round 2.
 */
export function getAdaptiveRound1Size(): number {
  return 5;
}

/**
 * Get the narrowed panel size for round 2 in adaptive narrowing.
 */
export function getAdaptiveRound2Size(): number {
  return 3;
}
