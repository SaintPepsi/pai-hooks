import { describe, expect, it } from "bun:test";
import { processSpawnFailed } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { SpawnAgentConfig } from "@hooks/lib/spawn-agent";
import { type RunLearningAgentDeps, runLearningAgent } from "./run-learning-agent";

function fakeDeps(
  overrides: Partial<RunLearningAgentDeps> = {},
): RunLearningAgentDeps & { _captured: SpawnAgentConfig[] } {
  const captured: SpawnAgentConfig[] = [];
  return {
    spawnAgent: (config) => {
      captured.push(config);
      return ok(undefined as undefined);
    },
    stderr: () => {},
    baseDir: "/fake/pai",
    _captured: captured,
    ...overrides,
  };
}

describe("runLearningAgent", () => {
  it("calls spawnAgent with prompt containing baseDir", () => {
    const deps = fakeDeps();
    runLearningAgent(deps);

    expect(deps._captured.length).toBe(1);
    expect(deps._captured[0].prompt).toContain("/fake/pai");
  });

  it("sets correct lockPath, logPath, and source", () => {
    const deps = fakeDeps();
    runLearningAgent(deps);

    expect(deps._captured[0].lockPath).toBe("/fake/pai/MEMORY/LEARNING/PROPOSALS/.analyzing");
    expect(deps._captured[0].logPath).toBe("/fake/pai/MEMORY/LEARNING/learning-agent-log.jsonl");
    expect(deps._captured[0].source).toBe("LearningActioner");
  });

  it("sets reason to credit-threshold-reached", () => {
    const deps = fakeDeps();
    runLearningAgent(deps);

    expect(deps._captured[0].reason).toBe("credit-threshold-reached");
  });

  it("uses model opus, maxTurns 25, timeout 1800000", () => {
    const deps = fakeDeps();
    runLearningAgent(deps);

    expect(deps._captured[0].model).toBe("opus");
    expect(deps._captured[0].maxTurns).toBe(25);
    expect(deps._captured[0].timeout).toBe(1_800_000);
  });

  it("returns ok when spawnAgent succeeds", () => {
    const deps = fakeDeps();
    const result = runLearningAgent(deps);

    expect(result.ok).toBe(true);
  });

  it("returns error when spawnAgent fails", () => {
    const deps = fakeDeps({
      spawnAgent: () => err(processSpawnFailed("claude", new Error("spawn failed"))),
    });
    const result = runLearningAgent(deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Failed to spawn");
    }
  });
});
