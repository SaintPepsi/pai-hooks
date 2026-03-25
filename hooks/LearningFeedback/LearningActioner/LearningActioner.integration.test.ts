import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { LearningActioner, type LearningActionerDeps } from "./LearningActioner.contract";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import { ensureDir, writeFile, fileExists, removeDir, setFileTimes } from "@hooks/core/adapters/fs";

const TEST_DIR = join(import.meta.dir, "__test-learning-actioner__");

function makeLiveDeps(overrides: Partial<LearningActionerDeps> = {}): LearningActionerDeps {
  return {
    ...LearningActioner.defaultDeps,
    baseDir: TEST_DIR,
    spawnBackground: () => ({ ok: true, value: undefined }),
    stderr: () => {},
    ...overrides,
  };
}

describe("LearningActioner integration", () => {
  beforeEach(() => {
    ensureDir(join(TEST_DIR, "MEMORY/LEARNING/REFLECTIONS"));
    ensureDir(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending"));
    ensureDir(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/applied"));
    ensureDir(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/rejected"));
    // Seed credit state so evaluateCredit() returns shouldSpawn: true
    // SPAWN_CREDIT_THRESHOLD is 10 (LearningActioner.contract.ts:54)
    ensureDir(join(TEST_DIR, "MEMORY/STATE"));
    writeFile(
      join(TEST_DIR, "MEMORY/STATE/learning-agent-credit.json"),
      JSON.stringify({ credit: 10, last_updated: new Date().toISOString() }),
    );
  });

  afterEach(() => {
    removeDir(TEST_DIR);
  });

  it("creates lock + prompt files and calls spawnBackground when reflections exist", () => {
    writeFile(
      join(TEST_DIR, "MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl"),
      '{"timestamp":"2026-01-01","reflection_q1":"test"}\n'
    );

    let spawnedCmd = "";
    let spawnedArgs: string[] = [];
    const deps = makeLiveDeps({
      spawnBackground: (cmd: string, args: string[]) => {
        spawnedCmd = cmd;
        spawnedArgs = args;
        return { ok: true, value: undefined };
      },
    });

    const result = LearningActioner.execute({ session_id: "int-test" }, deps);

    expect(result.ok).toBe(true);
    expect(result.value!.type).toBe("silent");
    expect(spawnedCmd).toBe("bun");
    expect(spawnedArgs[0]).toContain("learning-agent-runner.ts");
    expect(fileExists(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/.analyzing"))).toBe(true);
  });

  it("skips when no learning sources exist", () => {
    let spawned = false;
    const deps = makeLiveDeps({
      spawnBackground: () => { spawned = true; return { ok: true, value: undefined }; },
    });

    const result = LearningActioner.execute({ session_id: "int-test" }, deps);

    expect(result.ok).toBe(true);
    expect(spawned).toBe(false);
  });

  it("skips when fresh lock file exists on real filesystem", () => {
    writeFile(
      join(TEST_DIR, "MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl"),
      '{"timestamp":"2026-01-01"}\n'
    );
    writeFile(
      join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/.analyzing"),
      new Date().toISOString()
    );

    let spawned = false;
    const deps = makeLiveDeps({
      spawnBackground: () => { spawned = true; return { ok: true, value: undefined }; },
    });

    const result = LearningActioner.execute({ session_id: "int-test" }, deps);

    expect(result.ok).toBe(true);
    expect(spawned).toBe(false);
  });

  it("cleans stale lock and proceeds on real filesystem", () => {
    writeFile(
      join(TEST_DIR, "MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl"),
      '{"timestamp":"2026-01-01"}\n'
    );
    const lockPath = join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/.analyzing");
    writeFile(lockPath, "stale");
    // Backdate lock mtime past LOCK_STALE_MS (45min, contract.ts:53)
    const past = new Date(Date.now() - 46 * 60 * 1000);
    setFileTimes(lockPath, past, past);

    let spawned = false;
    const deps = makeLiveDeps({
      spawnBackground: () => { spawned = true; return { ok: true, value: undefined }; },
    });

    const result = LearningActioner.execute({ session_id: "int-test" }, deps);

    expect(result.ok).toBe(true);
    expect(spawned).toBe(true);
  });

  it("skips when credit is below spawn threshold", () => {
    writeFile(
      join(TEST_DIR, "MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl"),
      '{"timestamp":"2026-01-01"}\n'
    );
    // Override credit to below SPAWN_CREDIT_THRESHOLD (10, contract.ts:54)
    writeFile(
      join(TEST_DIR, "MEMORY/STATE/learning-agent-credit.json"),
      JSON.stringify({ credit: 2, last_updated: new Date().toISOString() }),
    );

    let spawned = false;
    const deps = makeLiveDeps({
      spawnBackground: () => { spawned = true; return { ok: true, value: undefined }; },
    });

    const result = LearningActioner.execute({ session_id: "int-test" }, deps);

    expect(result.ok).toBe(true);
    expect(spawned).toBe(false);
  });

  it("detects learning sources in LEARNING_DIRS with real files", () => {
    ensureDir(join(TEST_DIR, "MEMORY/LEARNING/ALGORITHM"));
    writeFile(
      join(TEST_DIR, "MEMORY/LEARNING/ALGORITHM/test-learning.md"),
      "# Test learning"
    );

    let spawned = false;
    const deps = makeLiveDeps({
      spawnBackground: () => { spawned = true; return { ok: true, value: undefined }; },
    });

    LearningActioner.execute({ session_id: "int-test" }, deps);

    expect(spawned).toBe(true);
  });
});
