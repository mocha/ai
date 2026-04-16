import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { TaskSpec } from '../orchestrator/types.js';
import type { DriftResult, DriftMismatch } from './types.js';

/**
 * Validate that the task spec's file references and code identifiers
 * still match the current codebase. Catches stale assumptions from
 * decomposition (ENG-180 fix).
 */
export async function validateDrift(
  task: TaskSpec,
  projectRoot: string,
): Promise<DriftResult> {
  const mismatches: DriftMismatch[] = [];

  // 1. Check file existence for relevantFiles
  for (const filePath of task.relevantFiles) {
    const fullPath = path.resolve(projectRoot, filePath);
    if (!fs.existsSync(fullPath)) {
      mismatches.push({
        type: 'file_missing',
        reference: filePath,
        expected_location: fullPath,
        actual_location: null,
        details: `File "${filePath}" listed in relevantFiles does not exist`,
      });
    }
  }

  // 2. Extract identifiers from details and acceptanceCriteria
  const allText = [task.details, ...task.acceptanceCriteria].join('\n');
  const identifiers = extractIdentifiers(allText);

  // 3. Check each identifier against the codebase
  for (const identifier of identifiers) {
    const found = grepForIdentifier(identifier, projectRoot);
    if (!found) {
      mismatches.push({
        type: 'identifier_not_found',
        reference: identifier,
        expected_location: null,
        actual_location: null,
        details: `Identifier "${identifier}" referenced in task spec not found in codebase`,
      });
    }
  }

  return {
    pass: mismatches.length === 0,
    mismatches,
  };
}

/**
 * Extract likely code identifiers from free text.
 *
 * Looks for:
 * - Backtick-quoted code: `functionName`, `TypeName`, `path/to/file.ts`
 * - CamelCase/PascalCase identifiers that look like function or type names
 * - Import-style paths: from './module'
 */
export function extractIdentifiers(text: string): string[] {
  const identifiers = new Set<string>();

  // Backtick-quoted code references
  const backtickRe = /`([A-Za-z_][\w./:]*(?:\(\))?)`/g;
  let match;
  while ((match = backtickRe.exec(text)) !== null) {
    const ref = match[1].replace(/\(\)$/, ''); // strip trailing ()
    // Skip very short identifiers and common words
    if (ref.length >= 3 && !COMMON_WORDS.has(ref.toLowerCase())) {
      identifiers.add(ref);
    }
  }

  // CamelCase/PascalCase identifiers (2+ uppercase transitions, not in prose)
  const camelRe = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
  while ((match = camelRe.exec(text)) !== null) {
    const ref = match[1];
    if (!COMMON_WORDS.has(ref.toLowerCase())) {
      identifiers.add(ref);
    }
  }

  return Array.from(identifiers);
}

/** Grep the project for an identifier. Returns true if found anywhere. */
function grepForIdentifier(identifier: string, projectRoot: string): boolean {
  // Skip file path references — they're checked via file existence
  if (identifier.includes('/') || identifier.includes('.ts') || identifier.includes('.js')) {
    return true; // handled by file existence check
  }

  try {
    execSync(
      `grep -rn --include='*.ts' --include='*.js' --include='*.tsx' --include='*.jsx' -l ${escapeShell(identifier)} .`,
      {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 10_000,
      },
    );
    return true;
  } catch {
    // grep exits 1 when no matches found
    return false;
  }
}

function escapeShell(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

const COMMON_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from',
  'not', 'but', 'all', 'are', 'was', 'were', 'been',
  'have', 'has', 'had', 'will', 'would', 'could', 'should',
  'may', 'can', 'must', 'shall', 'need', 'each', 'every',
  'true', 'false', 'null', 'undefined', 'string', 'number',
  'boolean', 'object', 'array', 'function', 'return', 'const',
  'let', 'var', 'type', 'interface', 'class', 'export', 'import',
]);
