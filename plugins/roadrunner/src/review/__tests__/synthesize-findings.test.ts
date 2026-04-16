import { describe, it, expect } from 'vitest';
import { synthesizeFindings } from '../synthesize-findings.js';
import type { ExpertResult } from '../types.js';

function makeExpert(overrides: Partial<ExpertResult> = {}): ExpertResult {
  return {
    expert_id: 'expert-0',
    identity: 'Test expert',
    verdict: 'SHIP',
    findings: [],
    report_path: '/tmp/report.md',
    ...overrides,
  };
}

describe('synthesizeFindings', () => {
  describe('verdict consolidation', () => {
    it('all SHIP → consolidated SHIP', () => {
      const results = [
        makeExpert({ expert_id: 'e0', verdict: 'SHIP' }),
        makeExpert({ expert_id: 'e1', verdict: 'SHIP' }),
        makeExpert({ expert_id: 'e2', verdict: 'SHIP' }),
      ];
      expect(synthesizeFindings(results).verdict).toBe('SHIP');
    });

    it('one RETHINK vetoes → consolidated RETHINK', () => {
      const results = [
        makeExpert({ expert_id: 'e0', verdict: 'SHIP' }),
        makeExpert({ expert_id: 'e1', verdict: 'RETHINK' }),
        makeExpert({ expert_id: 'e2', verdict: 'SHIP' }),
      ];
      expect(synthesizeFindings(results).verdict).toBe('RETHINK');
    });

    it('mixed SHIP and REVISE → consolidated REVISE', () => {
      const results = [
        makeExpert({ expert_id: 'e0', verdict: 'SHIP' }),
        makeExpert({ expert_id: 'e1', verdict: 'REVISE' }),
        makeExpert({ expert_id: 'e2', verdict: 'SHIP' }),
      ];
      expect(synthesizeFindings(results).verdict).toBe('REVISE');
    });

    it('all REVISE → consolidated REVISE', () => {
      const results = [
        makeExpert({ expert_id: 'e0', verdict: 'REVISE' }),
        makeExpert({ expert_id: 'e1', verdict: 'REVISE' }),
      ];
      expect(synthesizeFindings(results).verdict).toBe('REVISE');
    });

    it('RETHINK wins even with REVISE present', () => {
      const results = [
        makeExpert({ expert_id: 'e0', verdict: 'REVISE' }),
        makeExpert({ expert_id: 'e1', verdict: 'RETHINK' }),
      ];
      expect(synthesizeFindings(results).verdict).toBe('RETHINK');
    });

    it('empty panel → SHIP', () => {
      expect(synthesizeFindings([]).verdict).toBe('SHIP');
    });
  });

  describe('finding classification', () => {
    it('identifies consensus findings (flagged by 2+ experts)', () => {
      const sharedFinding = {
        severity: 'major' as const,
        description: 'Missing error handling',
        file: 'src/handler.ts',
        line: 42,
      };

      const results = [
        makeExpert({
          expert_id: 'e0',
          verdict: 'REVISE',
          findings: [sharedFinding],
        }),
        makeExpert({
          expert_id: 'e1',
          verdict: 'REVISE',
          findings: [{ ...sharedFinding }],
        }),
      ];

      const synthesis = synthesizeFindings(results);
      expect(synthesis.consensus).toHaveLength(1);
      expect(synthesis.consensus[0].description).toBe('Missing error handling');
      expect(synthesis.unique).toHaveLength(0);
    });

    it('identifies unique findings (flagged by exactly 1 expert)', () => {
      const results = [
        makeExpert({
          expert_id: 'e0',
          verdict: 'REVISE',
          findings: [{
            severity: 'minor',
            description: 'Naming could be clearer',
            file: 'src/a.ts',
            line: 10,
          }],
        }),
        makeExpert({
          expert_id: 'e1',
          verdict: 'REVISE',
          findings: [{
            severity: 'major',
            description: 'Missing validation',
            file: 'src/b.ts',
            line: 20,
          }],
        }),
      ];

      const synthesis = synthesizeFindings(results);
      expect(synthesis.unique).toHaveLength(2);
      expect(synthesis.consensus).toHaveLength(0);
    });

    it('uses highest severity when merging consensus findings', () => {
      const results = [
        makeExpert({
          expert_id: 'e0',
          findings: [{
            severity: 'minor',
            description: 'Missing error handling',
            file: 'src/handler.ts',
            line: 42,
          }],
        }),
        makeExpert({
          expert_id: 'e1',
          findings: [{
            severity: 'blocking',
            description: 'Missing error handling',
            file: 'src/handler.ts',
            line: 42,
          }],
        }),
      ];

      const synthesis = synthesizeFindings(results);
      expect(synthesis.consensus[0].severity).toBe('blocking');
    });

    it('all_findings contains every finding from every expert', () => {
      const results = [
        makeExpert({
          expert_id: 'e0',
          findings: [
            { severity: 'minor', description: 'A', file: '', line: null },
            { severity: 'major', description: 'B', file: '', line: null },
          ],
        }),
        makeExpert({
          expert_id: 'e1',
          findings: [
            { severity: 'suggestion', description: 'C', file: '', line: null },
          ],
        }),
      ];

      expect(synthesizeFindings(results).all_findings).toHaveLength(3);
    });
  });

  describe('disagreement detection', () => {
    it('reports verdict disagreement when experts disagree', () => {
      const results = [
        makeExpert({ expert_id: 'e0', verdict: 'SHIP' }),
        makeExpert({ expert_id: 'e1', verdict: 'REVISE' }),
      ];

      const synthesis = synthesizeFindings(results);
      expect(synthesis.disagreements).toHaveLength(1);
      expect(synthesis.disagreements[0]).toContain('Verdict disagreement');
    });

    it('no disagreement when all experts agree', () => {
      const results = [
        makeExpert({ expert_id: 'e0', verdict: 'SHIP' }),
        makeExpert({ expert_id: 'e1', verdict: 'SHIP' }),
      ];

      expect(synthesizeFindings(results).disagreements).toHaveLength(0);
    });
  });
});
