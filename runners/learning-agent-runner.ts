/**
 * Learning Agent Runner — Wrapper that runs claude synchronously and handles cleanup.
 *
 * Spawned by LearningActioner as a detached bun process.
 * Imports buildAgentPrompt directly, runs claude -p, then deterministically
 * cleans up lock/cooldown files regardless of claude's exit status.
 *
 * This ensures infrastructure cleanup is code-based (guaranteed) rather than
 * prompt-based (unreliable). It also prevents recursive spawning: while claude
 * runs synchronously inside this wrapper, the .analyzing lock file still exists,
 * so any SessionEnd hooks in the child claude session will see the lock and skip.
 */

import { execSyncSafe } from "@hooks/core/adapters/process";
import { writeFile, removeFile } from "@hooks/core/adapters/fs";
import { join } from "path";
import { buildAgentPrompt } from "@hooks/contracts/LearningActioner";

const defaultDeps = {
  processEnv: process.env as Record<string, string | undefined>,
};

export function run(baseDir: string, cmd: string = "claude"): void {
  const proposalsDir = join(baseDir, "MEMORY/LEARNING/PROPOSALS");
  const lockPath = join(proposalsDir, ".analyzing");
  const cooldownPath = join(proposalsDir, ".last-analysis");

  const prompt = buildAgentPrompt(baseDir);

  const env = { ...defaultDeps.processEnv, CLAUDECODE: undefined };
  const args = `${cmd} -p ${JSON.stringify(prompt)} --max-turns 10`;
  execSyncSafe(args, { timeout: 10 * 60 * 1000 });

  // Cleanup — always runs after exec completes (success or failure)
  writeFile(cooldownPath, new Date().toISOString());
  removeFile(lockPath);
}

// Script entry point
if (import.meta.main) {
  const baseDir = process.argv[2];
  if (!baseDir) {
    process.stderr.write("[learning-agent-runner] Missing baseDir argument\n");
    process.exit(1);
  }
  run(baseDir);
}
