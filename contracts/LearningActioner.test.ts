import { describe, it, expect } from "bun:test";
import {
  LearningActioner,
  type LearningActionerDeps,
} from "./LearningActioner";
import type { SessionEndInput } from "../core/types/hook-inputs";
import { dirCreateFailed } from "../core/error";

function makeDeps(overrides: Partial<LearningActionerDeps> = {}): LearningActionerDeps {
  return {
    ...LearningActioner.defaultDeps,
    fileExists: () => false,
    readDir: () => ({ ok: true, value: [] }),
    ensureDir: () => ({ ok: true, value: undefined }),
    writeFile: () => ({ ok: true, value: undefined }),
    removeFile: () => ({ ok: true, value: undefined }),
    stat: () => ({ ok: true, value: { mtimeMs: Date.now() } }),
    spawnBackground: () => ({ ok: true, value: undefined }),
    getISOTimestamp: () => "2026-02-27T16:30:00+11:00",
    baseDir: "/tmp/test-pai",
    stderr: () => {},
    ...overrides,
  };
}

function makeInput(overrides: Partial<SessionEndInput> = {}): SessionEndInput {
  return {
    session_id: "test-session-123",
    ...overrides,
  };
}

describe("LearningActioner contract", () => {
  it("has correct name and event", () => {
    expect(LearningActioner.name).toBe("LearningActioner");
    expect(LearningActioner.event).toBe("SessionEnd");
  });

  it("always accepts SessionEnd events", () => {
    expect(LearningActioner.accepts(makeInput())).toBe(true);
  });

  it("returns silent when no learning sources exist", () => {
    const deps = makeDeps({ fileExists: () => false });
    const result = LearningActioner.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("silent");
  });

  it("returns silent when .analyzing lock file exists and is fresh", () => {
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith(".analyzing"),
      stat: () => ({ ok: true, value: { mtimeMs: Date.now() - 1000 } }),
    });
    const result = LearningActioner.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("silent");
  });

  it("cleans up stale .analyzing lock file (>10 min old)", () => {
    let removedPath = "";
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.endsWith(".analyzing")) return true;
        if (path.endsWith("algorithm-reflections.jsonl")) return true;
        return false;
      },
      stat: (path: string) => {
        if (path.endsWith(".analyzing")) {
          return { ok: true, value: { mtimeMs: Date.now() - 11 * 60 * 1000 } };
        }
        return { ok: true, value: { mtimeMs: Date.now() } };
      },
      removeFile: (path: string) => { removedPath = path; return { ok: true, value: undefined }; },
      spawnBackground: () => ({ ok: true, value: undefined }),
    });
    LearningActioner.execute(makeInput(), deps);
    expect(removedPath).toContain(".analyzing");
  });

  it("spawns bun wrapper instead of claude directly", () => {
    let spawnedCmd = "";
    let spawnedArgs: string[] = [];
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("algorithm-reflections.jsonl"),
      spawnBackground: (cmd: string, args: string[]) => {
        spawnedCmd = cmd;
        spawnedArgs = args;
        return { ok: true, value: undefined };
      },
    });
    LearningActioner.execute(makeInput(), deps);
    expect(spawnedCmd).toBe("bun");
    expect(spawnedArgs[0]).toContain("learning-agent-runner.ts");
    expect(spawnedArgs[1]).toBe("/tmp/test-pai");
  });

  it("writes .analyzing lock file before spawning", () => {
    let writtenPath = "";
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("algorithm-reflections.jsonl"),
      writeFile: (path: string) => {
        if (path.endsWith(".analyzing")) writtenPath = path;
        return { ok: true, value: undefined };
      },
      spawnBackground: () => ({ ok: true, value: undefined }),
    });
    LearningActioner.execute(makeInput(), deps);
    expect(writtenPath).toContain(".analyzing");
  });

  it("passes baseDir as argument to wrapper", () => {
    let spawnedArgs: string[] = [];
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("algorithm-reflections.jsonl"),
      spawnBackground: (_cmd: string, args: string[]) => {
        spawnedArgs = args;
        return { ok: true, value: undefined };
      },
    });
    LearningActioner.execute(makeInput(), deps);
    expect(spawnedArgs[1]).toBe("/tmp/test-pai");
  });

  it("returns silent when cooldown file is fresh (< 6 hours)", () => {
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.endsWith(".last-analysis")) return true;
        if (path.endsWith("algorithm-reflections.jsonl")) return true;
        return false;
      },
      stat: (path: string) => {
        if (path.endsWith(".last-analysis")) {
          return { ok: true, value: { mtimeMs: Date.now() - 3600 * 1000 } }; // 1 hour ago
        }
        return { ok: true, value: { mtimeMs: Date.now() } };
      },
    });
    const result = LearningActioner.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("silent");
  });

  it("runs when cooldown file is stale (> 6 hours)", () => {
    let spawned = false;
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.endsWith(".last-analysis")) return true;
        if (path.endsWith("algorithm-reflections.jsonl")) return true;
        return false;
      },
      stat: (path: string) => {
        if (path.endsWith(".last-analysis")) {
          return { ok: true, value: { mtimeMs: Date.now() - 7 * 3600 * 1000 } }; // 7 hours ago
        }
        return { ok: true, value: { mtimeMs: Date.now() } };
      },
      spawnBackground: () => { spawned = true; return { ok: true, value: undefined }; },
    });
    LearningActioner.execute(makeInput(), deps);
    expect(spawned).toBe(true);
  });

  it("returns silent without spawning when ensureDir fails", () => {
    let spawned = false;
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("algorithm-reflections.jsonl"),
      ensureDir: () => ({ ok: false, error: dirCreateFailed("/tmp/test-pai/MEMORY/LEARNING/PROPOSALS/pending", new Error("permission denied")) }),
      spawnBackground: () => { spawned = true; return { ok: true, value: undefined }; },
    });
    const result = LearningActioner.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("silent");
    expect(spawned).toBe(false);
  });

  it("returns silent without spawning when lock file write fails", () => {
    let spawned = false;
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("algorithm-reflections.jsonl"),
      writeFile: () => ({ ok: false, error: dirCreateFailed("/tmp/test-pai/MEMORY/LEARNING/PROPOSALS/.analyzing", new Error("read-only filesystem")) }),
      spawnBackground: () => { spawned = true; return { ok: true, value: undefined }; },
    });
    const result = LearningActioner.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("silent");
    expect(spawned).toBe(false);
  });
});
