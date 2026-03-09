import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { LearningActioner, type LearningActionerDeps } from "./LearningActioner";
import type { SessionEndInput } from "../core/types/hook-inputs";

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
    mkdirSync(join(TEST_DIR, "MEMORY/LEARNING/REFLECTIONS"), { recursive: true });
    mkdirSync(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/pending"), { recursive: true });
    mkdirSync(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/applied"), { recursive: true });
    mkdirSync(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/rejected"), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates lock + prompt files and calls spawnBackground when reflections exist", () => {
    writeFileSync(
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
    expect(result.value.type).toBe("silent");
    expect(spawnedCmd).toBe("bun");
    expect(spawnedArgs[0]).toContain("learning-agent-runner.ts");
    expect(existsSync(join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/.analyzing"))).toBe(true);
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
    writeFileSync(
      join(TEST_DIR, "MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl"),
      '{"timestamp":"2026-01-01"}\n'
    );
    writeFileSync(
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
    writeFileSync(
      join(TEST_DIR, "MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl"),
      '{"timestamp":"2026-01-01"}\n'
    );
    const lockPath = join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/.analyzing");
    writeFileSync(lockPath, "stale");
    // Backdate the lock file mtime by 15 minutes
    const past = new Date(Date.now() - 15 * 60 * 1000);
    const { utimesSync } = require("fs");
    utimesSync(lockPath, past, past);

    let spawned = false;
    const deps = makeLiveDeps({
      spawnBackground: () => { spawned = true; return { ok: true, value: undefined }; },
    });

    const result = LearningActioner.execute({ session_id: "int-test" }, deps);

    expect(result.ok).toBe(true);
    expect(spawned).toBe(true);
  });

  it("respects cooldown on real filesystem", () => {
    writeFileSync(
      join(TEST_DIR, "MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl"),
      '{"timestamp":"2026-01-01"}\n'
    );
    // Write a fresh cooldown file
    writeFileSync(
      join(TEST_DIR, "MEMORY/LEARNING/PROPOSALS/.last-analysis"),
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

  it("detects learning sources in LEARNING_DIRS with real files", () => {
    mkdirSync(join(TEST_DIR, "MEMORY/LEARNING/ALGORITHM"), { recursive: true });
    writeFileSync(
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
