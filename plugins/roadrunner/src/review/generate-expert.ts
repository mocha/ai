import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GenerateExpert } from '../orchestrator/commands.js';
import type { GenerateExpertResult, ReviewConfig, SubAgentResult } from './types.js';
import { buildExpertMetaprompt } from './prompts/expert-metaprompt.js';

const execFileAsync = promisify(execFile);

/**
 * Invoke claude CLI as a sub-agent to generate a vocabulary-routed expert prompt.
 *
 * Returns the path to the written expert prompt and the number of vocabulary
 * clusters detected in the output.
 */
export async function generateExpert(
  command: GenerateExpert,
  mode: 'build' | 'critique',
  config: ReviewConfig,
  /** Injectable CLI dispatcher for testing */
  dispatcher?: (prompt: string, config: ReviewConfig) => Promise<SubAgentResult>,
): Promise<GenerateExpertResult> {
  const metaprompt = buildExpertMetaprompt(command, mode, config.methodology_path);

  // Invoke sub-agent
  const result = dispatcher
    ? await dispatcher(metaprompt, config)
    : await invokeClaudeCli(metaprompt, config);

  if (result.exit_code !== 0 && !result.stdout.trim()) {
    throw new Error(
      `Expert generation failed (exit ${result.exit_code}): ${result.stderr}`,
    );
  }

  const expertContent = result.stdout.trim();

  // Count vocabulary clusters (headings like "## Domain Vocabulary" or "### Cluster:")
  const clusterCount = countVocabularyClusters(expertContent);
  if (clusterCount < 3) {
    console.warn(
      `[review] Expert prompt for task ${command.task_id} has ${clusterCount} vocabulary clusters (expected 3-5)`,
    );
  }

  // Write expert prompt to disk
  const expertsDir = path.join(config.artifact_root, 'experts');
  fs.mkdirSync(expertsDir, { recursive: true });

  const filename = mode === 'critique'
    ? `TASK-${command.task_id}-reviewer.md`
    : `TASK-${command.task_id}.md`;
  const expertPath = path.join(expertsDir, filename);
  fs.writeFileSync(expertPath, expertContent, 'utf8');

  return {
    expert_prompt_path: expertPath,
    vocabulary_cluster_count: clusterCount,
  };
}

/**
 * Count vocabulary clusters in the expert prompt output.
 * Looks for markdown headings that indicate vocabulary sections.
 */
export function countVocabularyClusters(content: string): number {
  // Strategy 1: Count ### sub-headings inside a ## Vocabulary section
  const vocabSection = content.match(
    /^#{2}\s+(?:Domain\s+)?Vocabulary\b.*$[\s\S]*?(?=\n## (?!#)|$)/im,
  );
  if (vocabSection) {
    const subHeadings = vocabSection[0].match(/^###\s+/gm);
    if (subHeadings && subHeadings.length > 0) return subHeadings.length;
  }

  // Strategy 2: Count ## headings containing "Cluster" (e.g., "## Vocabulary Cluster: ...")
  const clusterHeadings = content.match(/^#{2,3}\s+.*\bcluster\b.*$/gim);
  if (clusterHeadings && clusterHeadings.length > 0) return clusterHeadings.length;

  // Strategy 3: Count numbered ### headings (e.g., "### 1. Event Architecture")
  const numberedHeadings = content.match(/^#{2,3}\s+\d+\.\s+/gm);
  if (numberedHeadings && numberedHeadings.length > 0) return numberedHeadings.length;

  return 0;
}

/** Invoke the claude CLI with the given prompt. */
async function invokeClaudeCli(
  prompt: string,
  config: ReviewConfig,
): Promise<SubAgentResult> {
  try {
    const { stdout, stderr } = await execFileAsync(config.claude_bin, [
      '--print',
      '-p',
      prompt,
    ], {
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 300_000, // 5 minutes
    });

    return { stdout, stderr, exit_code: 0 };
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: execErr.stdout ?? '',
      stderr: execErr.stderr ?? String(err),
      exit_code: execErr.code ?? 1,
    };
  }
}
