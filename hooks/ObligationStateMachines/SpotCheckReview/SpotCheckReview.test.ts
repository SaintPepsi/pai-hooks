import { describe, expect, it } from "bun:test";
import type { PaiError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import type { BlockOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import {
  SpotCheckReview,
  type SpotCheckReviewDeps,
} from "@hooks/hooks/ObligationStateMachines/SpotCheckReview/SpotCheckReview.contract";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<SpotCheckReviewDeps> = {}): SpotCheckReviewDeps {
  return {
    paiDir: "/tmp/pai-test",
    stateDir: "/tmp/pai-spot-check",
    getChangedFiles: () => [],
    getFileHashes: () => new Map(),
    fileExists: () => false,
    readBlockCount: () => 0,
    writeBlockCount: () => {},
    readReviewedHashes: () => ({}),
    writeReviewedHashes: () => {},
    removeFlag: () => {},
    stderr: () => {},
    ...overrides,
  };
}

function makeStopInput(sessionId = "test-session"): StopInput {
  return {
    session_id: sessionId,
  };
}

// ─── SpotCheckReview ──────────────────────────────────────────────────────────

describe("SpotCheckReview", () => {
  it("has correct name and event", () => {
    expect(SpotCheckReview.name).toBe("SpotCheckReview");
    expect(SpotCheckReview.event).toBe("Stop");
  });

  // ── accepts ──

  it("accepts returns true for all inputs", () => {
    expect(SpotCheckReview.accepts(makeStopInput())).toBe(true);
    expect(SpotCheckReview.accepts(makeStopInput("other-session"))).toBe(true);
  });

  it("accepts returns true when no project-level hook exists", () => {
    // In test environment, no .claude/hooks/ exists
    expect(SpotCheckReview.accepts(makeStopInput())).toBe(true);
  });

  // ── no unpushed changes → silent ──

  it("returns silent when no unpushed changes", () => {
    const deps = makeDeps({ getChangedFiles: () => [] });

    const result = SpotCheckReview.execute(makeStopInput(), deps) as Result<
      BlockOutput | SilentOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  // ── unpushed changes → block ──

  it("returns block when unpushed changes exist", () => {
    const deps = makeDeps({
      getChangedFiles: () => ["src/daemon/router.ts", "src/shared/types.ts"],
    });

    const result = SpotCheckReview.execute(makeStopInput(), deps) as Result<
      BlockOutput | SilentOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("block reason includes changed file paths", () => {
    const deps = makeDeps({
      getChangedFiles: () => ["src/daemon/router.ts", "src/shared/types.ts"],
    });

    const result = SpotCheckReview.execute(makeStopInput(), deps) as Result<BlockOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason).toContain("src/daemon/router.ts");
    expect(result.value.reason).toContain("src/shared/types.ts");
  });

  it("block reason mentions sonnet", () => {
    const deps = makeDeps({
      getChangedFiles: () => ["src/index.ts"],
    });

    const result = SpotCheckReview.execute(makeStopInput(), deps) as Result<BlockOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason.toLowerCase()).toContain("sonnet");
  });

  it("block reason mentions review", () => {
    const deps = makeDeps({
      getChangedFiles: () => ["src/index.ts"],
    });

    const result = SpotCheckReview.execute(makeStopInput(), deps) as Result<BlockOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason.toLowerCase()).toContain("review");
  });

  it("block reason mentions CLAUDE.md", () => {
    const deps = makeDeps({
      getChangedFiles: () => ["src/app.ts"],
    });
    const result = SpotCheckReview.execute(makeStopInput(), deps) as Result<BlockOutput, PaiError>;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason).toContain("CLAUDE.md");
  });

  // ── block count ──

  it("increments block count when blocking", () => {
    let writtenCount = -1;
    const deps = makeDeps({
      getChangedFiles: () => ["src/index.ts"],
      readBlockCount: () => 0,
      writeBlockCount: (_path: string, count: number) => {
        writtenCount = count;
      },
    });

    SpotCheckReview.execute(makeStopInput(), deps);

    expect(writtenCount).toBe(1);
  });

  // ── escape valve: MAX_BLOCKS=1 ──

  it("returns silent when block limit reached (blockCount >= MAX_BLOCKS)", () => {
    const deps = makeDeps({
      getChangedFiles: () => ["src/index.ts"],
      readBlockCount: () => 1,
    });

    const result = SpotCheckReview.execute(makeStopInput(), deps) as Result<
      BlockOutput | SilentOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("cleans up state files when block limit reached", () => {
    const removedPaths: string[] = [];
    const deps = makeDeps({
      getChangedFiles: () => ["src/index.ts"],
      readBlockCount: () => 1,
      removeFlag: (path: string) => {
        removedPaths.push(path);
      },
    });

    SpotCheckReview.execute(makeStopInput(), deps);

    expect(removedPaths.length).toBeGreaterThanOrEqual(1);
  });

  // ── session isolation ──

  it("uses session_id in state file paths", () => {
    let writtenPath = "";
    const deps = makeDeps({
      getChangedFiles: () => ["src/index.ts"],
      readBlockCount: () => 0,
      writeBlockCount: (path: string) => {
        writtenPath = path;
      },
    });

    SpotCheckReview.execute(makeStopInput("my-session-abc"), deps);

    expect(writtenPath).toContain("my-session-abc");
  });
  // ── hash dedup: skip already-reviewed files ──

  it("returns silent when all files already reviewed with same hash", () => {
    const deps = makeDeps({
      getChangedFiles: () => ["src/index.ts", "src/app.ts"],
      getFileHashes: () =>
        new Map([
          ["src/index.ts", "hash-aaa"],
          ["src/app.ts", "hash-bbb"],
        ]),
      readReviewedHashes: () => ({
        "src/index.ts": "hash-aaa",
        "src/app.ts": "hash-bbb",
      }),
    });

    const result = SpotCheckReview.execute(makeStopInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("blocks only unreviewed files when some are already reviewed", () => {
    const deps = makeDeps({
      getChangedFiles: () => ["src/index.ts", "src/app.ts", "src/new.ts"],
      getFileHashes: () =>
        new Map([
          ["src/index.ts", "hash-aaa"],
          ["src/app.ts", "hash-bbb"],
          ["src/new.ts", "hash-ccc"],
        ]),
      readReviewedHashes: () => ({
        "src/index.ts": "hash-aaa",
        "src/app.ts": "hash-bbb",
      }),
    });

    const result = SpotCheckReview.execute(makeStopInput(), deps) as Result<BlockOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
    expect(result.value.reason).toContain("src/new.ts");
    expect(result.value.reason).not.toContain("src/index.ts");
    expect(result.value.reason).not.toContain("src/app.ts");
  });

  it("blocks file when its hash changed since last review", () => {
    const deps = makeDeps({
      getChangedFiles: () => ["src/index.ts"],
      getFileHashes: () => new Map([["src/index.ts", "hash-new"]]),
      readReviewedHashes: () => ({ "src/index.ts": "hash-old" }),
    });

    const result = SpotCheckReview.execute(makeStopInput(), deps) as Result<BlockOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
    expect(result.value.reason).toContain("src/index.ts");
  });

  it("treats files with no hash as unreviewed", () => {
    const deps = makeDeps({
      getChangedFiles: () => ["src/index.ts"],
      getFileHashes: () => new Map(), // no hashes returned (e.g. deleted file)
      readReviewedHashes: () => ({ "src/index.ts": "hash-aaa" }),
    });

    const result = SpotCheckReview.execute(makeStopInput(), deps) as Result<BlockOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  // ── escape valve writes reviewed hashes ──

  it("writes reviewed hashes on escape valve release", () => {
    let writtenHashes: Record<string, string> = {};
    const deps = makeDeps({
      getChangedFiles: () => ["src/index.ts", "src/app.ts"],
      getFileHashes: () =>
        new Map([
          ["src/index.ts", "hash-aaa"],
          ["src/app.ts", "hash-bbb"],
        ]),
      readBlockCount: () => 1, // at limit
      readReviewedHashes: () => ({}),
      writeReviewedHashes: (_path: string, hashes: Record<string, string>) => {
        writtenHashes = hashes;
      },
    });

    SpotCheckReview.execute(makeStopInput(), deps);

    expect(writtenHashes["src/index.ts"]).toBe("hash-aaa");
    expect(writtenHashes["src/app.ts"]).toBe("hash-bbb");
  });

  it("prunes stale entries not in current unpushed diff on release", () => {
    let writtenHashes: Record<string, string> = {};
    const deps = makeDeps({
      getChangedFiles: () => ["src/new.ts"],
      getFileHashes: () => new Map([["src/new.ts", "hash-ccc"]]),
      readBlockCount: () => 1,
      readReviewedHashes: () => ({ "src/old.ts": "hash-old" }),
      writeReviewedHashes: (_path: string, hashes: Record<string, string>) => {
        writtenHashes = hashes;
      },
    });

    SpotCheckReview.execute(makeStopInput(), deps);

    expect(writtenHashes["src/old.ts"]).toBeUndefined();
    expect(writtenHashes["src/new.ts"]).toBe("hash-ccc");
  });

  it("retains existing entries for files still in unpushed diff on release", () => {
    let writtenHashes: Record<string, string> = {};
    const deps = makeDeps({
      getChangedFiles: () => ["src/kept.ts", "src/new.ts"],
      getFileHashes: () =>
        new Map([
          ["src/kept.ts", "hash-kept"],
          ["src/new.ts", "hash-new"],
        ]),
      readBlockCount: () => 1,
      readReviewedHashes: () => ({ "src/kept.ts": "hash-kept", "src/gone.ts": "hash-gone" }),
      writeReviewedHashes: (_path: string, hashes: Record<string, string>) => {
        writtenHashes = hashes;
      },
    });

    SpotCheckReview.execute(makeStopInput(), deps);

    expect(writtenHashes["src/kept.ts"]).toBe("hash-kept");
    expect(writtenHashes["src/new.ts"]).toBe("hash-new");
    expect(writtenHashes["src/gone.ts"]).toBeUndefined();
  });

  it("uses stateDir for reviewed hashes path", () => {
    let hashPath = "";
    const deps = makeDeps({
      getChangedFiles: () => ["src/index.ts"],
      getFileHashes: () => new Map([["src/index.ts", "hash-aaa"]]),
      readReviewedHashes: (path: string) => {
        hashPath = path;
        return {};
      },
    });

    SpotCheckReview.execute(makeStopInput(), deps);

    expect(hashPath).toContain("spot-check");
    expect(hashPath).toContain("reviewed-hashes");
  });
});

// ─── defaultDeps coverage ─────────────────────────────────────────────────────

describe("SpotCheckReview defaultDeps", () => {
  it("defaultDeps.stateDir is a string path containing spot-check", () => {
    expect(typeof SpotCheckReview.defaultDeps.stateDir).toBe("string");
    expect(SpotCheckReview.defaultDeps.stateDir).toContain("spot-check");
  });

  it("defaultDeps.fileExists returns a boolean", () => {
    expect(typeof SpotCheckReview.defaultDeps.fileExists("/tmp")).toBe("boolean");
  });

  it("defaultDeps.readBlockCount returns 0 for nonexistent file", () => {
    const result = SpotCheckReview.defaultDeps.readBlockCount(
      "/tmp/nonexistent-pai-scr-bc-12345.txt",
    );
    expect(result).toBe(0);
  });

  it("defaultDeps.writeBlockCount writes without throwing", () => {
    const tmpPath = `/tmp/pai-test-scr-bc-${Date.now()}.txt`;
    expect(() => SpotCheckReview.defaultDeps.writeBlockCount(tmpPath, 1)).not.toThrow();
  });

  it("defaultDeps.removeFlag does not throw for nonexistent file", () => {
    expect(() =>
      SpotCheckReview.defaultDeps.removeFlag("/tmp/nonexistent-pai-scr-12345.txt"),
    ).not.toThrow();
  });

  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => SpotCheckReview.defaultDeps.stderr("test")).not.toThrow();
  });

  it("defaultDeps.getChangedFiles returns an array", () => {
    // This calls git diff — will return [] if not in a git repo or no upstream
    const result = SpotCheckReview.defaultDeps.getChangedFiles();
    expect(Array.isArray(result)).toBe(true);
  });

  it("defaultDeps.getFileHashes returns a Map", () => {
    const result = SpotCheckReview.defaultDeps.getFileHashes([]);
    expect(result instanceof Map).toBe(true);
  });

  it("defaultDeps.readReviewedHashes returns object for nonexistent file", () => {
    const result = SpotCheckReview.defaultDeps.readReviewedHashes(
      "/tmp/nonexistent-pai-rh-12345.json",
    );
    expect(typeof result).toBe("object");
  });

  it("defaultDeps.writeReviewedHashes writes without throwing", () => {
    const tmpPath = `/tmp/pai-test-rh-${Date.now()}.json`;
    expect(() =>
      SpotCheckReview.defaultDeps.writeReviewedHashes(tmpPath, { "test.ts": "abc" }),
    ).not.toThrow();
  });

  it("defaultDeps.getFileHashes returns hashes for existing files", () => {
    const tmpPath = `/tmp/pai-test-hash-${Date.now()}.ts`;
    require("fs").writeFileSync(tmpPath, "test content");
    const hashes = SpotCheckReview.defaultDeps.getFileHashes([tmpPath]);
    expect(hashes.has(tmpPath)).toBe(true);
    expect(hashes.get(tmpPath)!.length).toBeGreaterThan(0);
    require("fs").unlinkSync(tmpPath);
  });

  it("defaultDeps.getFileHashes skips missing files", () => {
    const hashes = SpotCheckReview.defaultDeps.getFileHashes(["/tmp/pai-nonexistent-xyz.ts"]);
    expect(hashes.has("/tmp/pai-nonexistent-xyz.ts")).toBe(false);
  });
});
