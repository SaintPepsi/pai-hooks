import { describe, it, expect } from "bun:test";
import {
  type ObligationDeps,
  type ObligationConfig,
  pendingPath,
  blockCountPath,
  addPending,
  clearMatching,
  checkObligation,
  buildBlockLimitReview,
} from "@hooks/lib/obligation-machine";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_CONFIG: ObligationConfig = {
  name: "Test",
  stateSubdir: "test-obligation",
  pendingPrefix: "test-pending",
  blockCountPrefix: "test-block-count",
  maxBlocks: 2,
};

function makeDeps(overrides: Partial<ObligationDeps> = {}): ObligationDeps {
  return {
    stateDir: "/tmp/obligation-test",
    fileExists: () => false,
    readPending: () => [],
    writePending: () => {},
    removeFlag: () => {},
    readBlockCount: () => 0,
    writeBlockCount: () => {},
    writeReview: () => {},
    stderr: () => {},
    ...overrides,
  };
}

// ─── pendingPath / blockCountPath ─────────────────────────────────────────────

describe("pendingPath", () => {
  it("includes prefix and session id", () => {
    const p = pendingPath("/state", "docs-pending", "sess-123");
    expect(p).toContain("docs-pending");
    expect(p).toContain("sess-123");
    expect(p).toEndWith(".json");
  });
});

describe("blockCountPath", () => {
  it("includes prefix and session id", () => {
    const p = blockCountPath("/state", "docs-block-count", "sess-123");
    expect(p).toContain("docs-block-count");
    expect(p).toContain("sess-123");
    expect(p).toEndWith(".txt");
  });
});

// ─── addPending ───────────────────────────────────────────────────────────────

describe("addPending", () => {
  it("adds a file to the pending list", () => {
    let written: string[] = [];
    const deps = makeDeps({
      readPending: () => [],
      writePending: (_p, files) => { written = files; },
    });

    addPending(deps, "/flag.json", "/src/a.ts");
    expect(written).toContain("/src/a.ts");
  });

  it("does not duplicate existing entries", () => {
    let written: string[] = [];
    const deps = makeDeps({
      readPending: () => ["/src/a.ts"],
      writePending: (_p, files) => { written = files; },
    });

    addPending(deps, "/flag.json", "/src/a.ts");
    expect(written).toEqual(["/src/a.ts"]);
  });

  it("appends to existing entries", () => {
    let written: string[] = [];
    const deps = makeDeps({
      readPending: () => ["/src/a.ts"],
      writePending: (_p, files) => { written = files; },
    });

    addPending(deps, "/flag.json", "/src/b.ts");
    expect(written).toEqual(["/src/a.ts", "/src/b.ts"]);
  });
});

// ─── clearMatching ────────────────────────────────────────────────────────────

describe("clearMatching", () => {
  it("returns cleared=false when flag file does not exist", () => {
    const deps = makeDeps({ fileExists: () => false });
    const result = clearMatching(deps, "/flag.json", () => true);
    expect(result).toEqual({ remaining: 0, cleared: false });
  });

  it("removes flag when all entries match", () => {
    let removed = false;
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/src/a.ts", "/src/b.ts"],
      removeFlag: () => { removed = true; },
    });

    const result = clearMatching(deps, "/flag.json", () => true);
    expect(result).toEqual({ remaining: 0, cleared: true });
    expect(removed).toBe(true);
  });

  it("keeps non-matching entries", () => {
    let written: string[] = [];
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/src/a.ts", "/lib/b.ts"],
      writePending: (_p, files) => { written = files; },
    });

    const result = clearMatching(deps, "/flag.json", (p) => p.startsWith("/src/"));
    expect(result).toEqual({ remaining: 1, cleared: true });
    expect(written).toEqual(["/lib/b.ts"]);
  });
});

// ─── checkObligation ──────────────────────────────────────────────────────────

describe("checkObligation", () => {
  it("returns silent when no flag file exists", () => {
    const deps = makeDeps({ fileExists: () => false });
    const result = checkObligation(deps, TEST_CONFIG, "sess-1");
    expect(result).toEqual({ action: "silent" });
  });

  it("returns silent when pending list is empty", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => [],
    });
    const result = checkObligation(deps, TEST_CONFIG, "sess-1");
    expect(result).toEqual({ action: "silent" });
  });

  it("returns block with pending files on first attempt", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/src/a.ts"],
      readBlockCount: () => 0,
    });
    const result = checkObligation(deps, TEST_CONFIG, "sess-1");
    expect(result.action).toBe("block");
    if (result.action === "block") {
      expect(result.pending).toEqual(["/src/a.ts"]);
    }
  });

  it("increments block count when blocking", () => {
    let writtenCount = -1;
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/src/a.ts"],
      readBlockCount: () => 0,
      writeBlockCount: (_p, count) => { writtenCount = count; },
    });
    checkObligation(deps, TEST_CONFIG, "sess-1");
    expect(writtenCount).toBe(1);
  });

  it("returns release when block limit reached", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/src/a.ts"],
      readBlockCount: () => 2, // maxBlocks = 2
    });
    const result = checkObligation(deps, TEST_CONFIG, "sess-1");
    expect(result.action).toBe("release");
  });

  it("writes review and cleans up on release", () => {
    let reviewWritten = false;
    let removedPaths: string[] = [];
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/src/a.ts"],
      readBlockCount: () => 2,
      writeReview: () => { reviewWritten = true; },
      removeFlag: (p) => { removedPaths.push(p); },
    });

    checkObligation(deps, TEST_CONFIG, "sess-1");
    expect(reviewWritten).toBe(true);
    expect(removedPaths.length).toBeGreaterThanOrEqual(2); // flag + count
  });

  it("uses config maxBlocks (blocks at count < maxBlocks)", () => {
    const config: ObligationConfig = { ...TEST_CONFIG, maxBlocks: 3 };
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/src/a.ts"],
      readBlockCount: () => 2,
    });
    const result = checkObligation(deps, config, "sess-1");
    expect(result.action).toBe("block"); // 2 < 3
  });
});

// ─── buildBlockLimitReview ────────────────────────────────────────────────────

describe("buildBlockLimitReview", () => {
  it("includes obligation name", () => {
    const review = buildBlockLimitReview("HookDoc", ["/a.ts"], 1);
    expect(review).toContain("HookDoc");
  });

  it("includes pending files", () => {
    const review = buildBlockLimitReview("Test", ["/a.ts", "/b.ts"], 2);
    expect(review).toContain("/a.ts");
    expect(review).toContain("/b.ts");
  });

  it("includes block count", () => {
    const review = buildBlockLimitReview("Doc", ["/a.ts"], 3);
    expect(review).toContain("3");
  });
});
