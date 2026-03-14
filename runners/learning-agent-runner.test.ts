import { describe, it, expect, beforeEach } from "bun:test";
import { writeFileSafe, pathExists, readFileSafe, ensureDirSafe, join } from "@pai/adapters/fs";
import { run } from "@hooks/runners/learning-agent-runner";

const TEST_DIR = join(import.meta.dir, "__test-learning-runner__");
const PROPOSALS_DIR = join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS");

beforeEach(() => {
  ensureDirSafe(PROPOSALS_DIR);
});

describe("learning-agent-runner", () => {
  it("removes lock file after process exits", () => {
    writeFileSafe(join(PROPOSALS_DIR, ".analyzing"), new Date().toISOString());

    // "true" is a command that exits 0 immediately
    run(TEST_DIR, "true");

    expect(pathExists(join(PROPOSALS_DIR, ".analyzing"))).toBe(false);
  });

  it("writes cooldown file after process exits", () => {
    writeFileSafe(join(PROPOSALS_DIR, ".analyzing"), new Date().toISOString());

    run(TEST_DIR, "true");

    const cooldownPath = join(PROPOSALS_DIR, ".last-analysis");
    expect(pathExists(cooldownPath)).toBe(true);
    const content = readFileSafe(cooldownPath);
    expect(content).not.toBeNull();
    expect(new Date(content!).getTime()).not.toBeNaN();
  });

  it("cleans up even when the process fails", () => {
    writeFileSafe(join(PROPOSALS_DIR, ".analyzing"), new Date().toISOString());

    // "false" is a command that exits 1 (failure)
    run(TEST_DIR, "false");

    expect(pathExists(join(PROPOSALS_DIR, ".analyzing"))).toBe(false);
    expect(pathExists(join(PROPOSALS_DIR, ".last-analysis"))).toBe(true);
  });
});
