/**
 * Learning Agent Runner — Spawns a Claude agent to analyze learnings and produce proposals.
 *
 * Uses spawnAgent() from lib/spawn-agent.ts for lock management,
 * traceability logging, and background spawning.
 *
 * Thin wrapper: builds prompt, configures agent, delegates to spawnAgent().
 */

import { join } from "node:path";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import { buildAgentPrompt } from "@hooks/hooks/LearningFeedback/LearningActioner/LearningActioner.contract";
import type { SpawnAgentConfig, SpawnAgentDeps } from "@hooks/lib/spawn-agent";
import { spawnAgent } from "@hooks/lib/spawn-agent";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RunLearningAgentDeps {
  spawnAgent: (config: SpawnAgentConfig, deps?: SpawnAgentDeps) => Result<void, ResultError>;
  stderr: (msg: string) => void;
  baseDir: string;
}

// ─── Defaults ──────────────────────────────────────────────────────────────

const defaultDeps: RunLearningAgentDeps = {
  spawnAgent,
  stderr: (msg) => process.stderr.write(`${msg}\n`),
  baseDir: join(process.env.HOME ?? "", ".claude"),
};

// ─── Public API ────────────────────────────────────────────────────────────

export function runLearningAgent(
  deps: RunLearningAgentDeps = defaultDeps,
): Result<void, ResultError> {
  const prompt = buildAgentPrompt(deps.baseDir);
  const lockPath = join(deps.baseDir, "MEMORY/LEARNING/PROPOSALS/.analyzing");
  const logPath = join(deps.baseDir, "MEMORY/LEARNING/learning-agent-log.jsonl");

  deps.stderr("[run-learning-agent] Spawning learning agent");

  return deps.spawnAgent({
    prompt,
    lockPath,
    logPath,
    source: "LearningActioner",
    reason: "credit-threshold-reached",
    model: "opus",
    maxTurns: 25,
    timeout: 1_800_000,
  });
}
