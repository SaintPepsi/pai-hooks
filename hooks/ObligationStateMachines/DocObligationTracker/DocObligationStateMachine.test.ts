import { describe, expect, it } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { ResultError } from "@hooks/core/error";
import { fileReadFailed } from "@hooks/core/error";
import { err, ok, type Result } from "@hooks/core/result";
import { DocObligationEnforcer } from "@hooks/hooks/ObligationStateMachines/DocObligationEnforcer/DocObligationEnforcer.contract";
import {
  projectHasHook,
  readDocExcludePatterns,
} from "@hooks/hooks/ObligationStateMachines/DocObligationStateMachine.shared";
import {
  DocObligationTracker,
  type DocTrackerDeps,
} from "@hooks/hooks/ObligationStateMachines/DocObligationTracker/DocObligationTracker.contract";
import {
  getReasonFromBlock,
  isSilentNoOp,
  buildStopInput as makeStopInput,
  buildToolInput as makeToolInput,
} from "@hooks/lib/test-helpers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTrackerDeps(overrides: Partial<DocTrackerDeps> = {}): DocTrackerDeps {
  return {
    stateDir: "/tmp/pai-doc-obligation",
    fileExists: () => false,
    readPending: () => [],
    writePending: () => {},
    removeFlag: () => {},
    readBlockCount: () => 0,
    writeBlockCount: () => {},
    writeReview: () => {},
    stderr: () => {},
    getExcludePatterns: () => [],
    ...overrides,
  };
}

// ─── DocObligationTracker ────────────────────────────────────────────────────

describe("DocObligationTracker", () => {
  it("has correct name and event", () => {
    expect(DocObligationTracker.name).toBe("DocObligationTracker");
    expect(DocObligationTracker.event).toBe("PostToolUse");
  });

  // ── accepts ──

  it("accepts Edit tool with code file", () => {
    expect(DocObligationTracker.accepts(makeToolInput("Edit", { file_path: "/src/app.ts" }))).toBe(
      true,
    );
  });

  it("accepts Write tool with code file", () => {
    expect(
      DocObligationTracker.accepts(makeToolInput("Write", { file_path: "/src/app.tsx" })),
    ).toBe(true);
  });

  it("rejects Read tool", () => {
    expect(DocObligationTracker.accepts(makeToolInput("Read"))).toBe(false);
  });

  it("rejects Edit with config file", () => {
    expect(DocObligationTracker.accepts(makeToolInput("Edit", { file_path: "/config.json" }))).toBe(
      false,
    );
  });

  it("rejects Write with yaml file", () => {
    expect(
      DocObligationTracker.accepts(makeToolInput("Write", { file_path: "/config.yaml" })),
    ).toBe(false);
  });

  it("rejects Edit with test file", () => {
    expect(
      DocObligationTracker.accepts(makeToolInput("Edit", { file_path: "/src/app.test.ts" })),
    ).toBe(false);
  });

  it("rejects Edit with spec file", () => {
    expect(
      DocObligationTracker.accepts(makeToolInput("Edit", { file_path: "/src/app.spec.tsx" })),
    ).toBe(false);
  });

  it("accepts Edit on .md file for clearing", () => {
    expect(
      DocObligationTracker.accepts(makeToolInput("Edit", { file_path: "/src/README.md" })),
    ).toBe(true);
  });

  it("accepts Write on .md file for clearing", () => {
    expect(
      DocObligationTracker.accepts(makeToolInput("Write", { file_path: "/docs/guide.md" })),
    ).toBe(true);
  });

  // ── Edit/Write sets pending ──

  it("sets pending flag when Edit on code file", () => {
    let writtenFiles: string[] = [];
    const deps = makeTrackerDeps({
      readPending: () => [],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
    });

    const result = DocObligationTracker.execute(
      makeToolInput("Edit", { file_path: "/src/handler.ts" }),
      deps,
    ) as Result<SyncHookJSONOutput, ResultError>;

    expect(result.ok).toBe(true);
    expect(writtenFiles).toContain("/src/handler.ts");
  });

  it("sets pending flag when Write on code file", () => {
    let writtenFiles: string[] = [];
    const deps = makeTrackerDeps({
      readPending: () => [],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
    });

    const result = DocObligationTracker.execute(
      makeToolInput("Write", { file_path: "/src/utils.ts" }),
      deps,
    ) as Result<SyncHookJSONOutput, ResultError>;

    expect(result.ok).toBe(true);
    expect(writtenFiles).toContain("/src/utils.ts");
  });

  it("does not duplicate already-pending files", () => {
    let writtenFiles: string[] = [];
    const deps = makeTrackerDeps({
      readPending: () => ["/src/handler.ts"],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
    });

    DocObligationTracker.execute(makeToolInput("Edit", { file_path: "/src/handler.ts" }), deps);

    expect(writtenFiles).toEqual(["/src/handler.ts"]);
  });

  // ── .md edits clear related pending files ──

  it("clears pending file in same directory when .md edited", () => {
    let removed = false;
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts"],
      writePending: () => {},
      removeFlag: () => {
        removed = true;
      },
    });

    DocObligationTracker.execute(makeToolInput("Edit", { file_path: "/src/README.md" }), deps);

    expect(removed).toBe(true);
  });

  it("clears only files in same directory subtree", () => {
    let writtenFiles: string[] = [];
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/auth/middleware.ts", "/src/utils/helpers.ts"],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
    });

    DocObligationTracker.execute(makeToolInput("Edit", { file_path: "/src/auth/README.md" }), deps);

    expect(writtenFiles).toEqual(["/src/utils/helpers.ts"]);
  });

  it("keeps unrelated pending files when .md edited in different directory", () => {
    let writtenFiles: string[] = [];
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts", "/lib/parser.ts"],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
    });

    DocObligationTracker.execute(makeToolInput("Write", { file_path: "/src/CHANGELOG.md" }), deps);

    expect(writtenFiles).toEqual(["/lib/parser.ts"]);
  });

  it("removes flag file when all pending files cleared by .md edit", () => {
    let removed = false;
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts", "/src/utils.ts"],
      removeFlag: () => {
        removed = true;
      },
    });

    DocObligationTracker.execute(makeToolInput("Edit", { file_path: "/src/README.md" }), deps);

    expect(removed).toBe(true);
  });

  it("clears subdirectory files when parent .md edited", () => {
    let removed = false;
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/auth/login.ts", "/src/auth/session.ts"],
      removeFlag: () => {
        removed = true;
      },
    });

    DocObligationTracker.execute(
      makeToolInput("Edit", { file_path: "/src/auth/docs/architecture.md" }),
      deps,
    );

    // docs/architecture.md is in /src/auth/docs/ — the code files are in /src/auth/
    // The doc dir shares /src/auth as ancestor, so it should clear
    expect(removed).toBe(true);
  });

  // ── Session-scoped state ──

  it("uses session_id in pending file path", () => {
    let writtenPath = "";
    const deps = makeTrackerDeps({
      readPending: () => [],
      writePending: (path: string) => {
        writtenPath = path;
      },
    });

    DocObligationTracker.execute(makeToolInput("Edit", { file_path: "/src/handler.ts" }), deps);

    expect(writtenPath).toContain("test-session");
  });

  it("different sessions write to different state files", () => {
    const paths: string[] = [];
    const deps = makeTrackerDeps({
      readPending: () => [],
      writePending: (path: string) => {
        paths.push(path);
      },
    });

    DocObligationTracker.execute(
      {
        session_id: "session-aaa",
        tool_name: "Edit",
        tool_input: { file_path: "/src/a.ts" },
      },
      deps,
    );
    DocObligationTracker.execute(
      {
        session_id: "session-bbb",
        tool_name: "Edit",
        tool_input: { file_path: "/src/b.ts" },
      },
      deps,
    );

    expect(paths[0]).not.toEqual(paths[1]);
    expect(paths[0]).toContain("session-aaa");
    expect(paths[1]).toContain("session-bbb");
  });

  it("does not clear when no pending flag exists for .md edit", () => {
    let writeCalled = false;
    const deps = makeTrackerDeps({
      fileExists: () => false,
      writePending: () => {
        writeCalled = true;
      },
    });

    DocObligationTracker.execute(makeToolInput("Edit", { file_path: "/src/README.md" }), deps);

    expect(writeCalled).toBe(false);
  });
});

// ─── DocObligationEnforcer ───────────────────────────────────────────────────

describe("DocObligationEnforcer", () => {
  it("has correct name and event", () => {
    expect(DocObligationEnforcer.name).toBe("DocObligationEnforcer");
    expect(DocObligationEnforcer.event).toBe("Stop");
  });

  it("accepts all inputs", () => {
    expect(DocObligationEnforcer.accepts(makeStopInput())).toBe(true);
  });

  it("returns silent when no pending flag exists", () => {
    const deps = makeTrackerDeps({ fileExists: () => false });

    const result = DocObligationEnforcer.execute(makeStopInput(), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isSilentNoOp(result.value)).toBe(true);
  });

  it("returns silent when pending list is empty", () => {
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => [],
    });

    const result = DocObligationEnforcer.execute(makeStopInput(), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isSilentNoOp(result.value)).toBe(true);
  });

  it("returns block when pending flag exists", () => {
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts", "/src/utils.ts"],
    });

    const result = DocObligationEnforcer.execute(makeStopInput(), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getReasonFromBlock(result.value)).toBeDefined();
  });

  it("block reason includes file paths", () => {
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts"],
    });

    const result = DocObligationEnforcer.execute(makeStopInput(), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reason = getReasonFromBlock(result.value);
    expect(reason).toBeDefined();
    expect(reason ?? "").toContain("/src/handler.ts");
  });

  it("block reason mentions documentation", () => {
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/app.ts"],
    });

    const result = DocObligationEnforcer.execute(makeStopInput(), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reason = getReasonFromBlock(result.value);
    expect(reason).toBeDefined();
    expect((reason ?? "").toLowerCase()).toContain("documentation");
  });

  // ── Actionable doc path suggestions ──

  it("suggests existing README.md when found in same directory", () => {
    const flagPath = "/tmp/pai-doc-obligation/docs-pending-test-session.json";
    const deps = makeTrackerDeps({
      fileExists: (path: string) => {
        if (path === flagPath) return true;
        if (path === "/src/README.md") return true;
        return false;
      },
      readPending: () => ["/src/handler.ts"],
    });

    const result = DocObligationEnforcer.execute(makeStopInput(), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reason = getReasonFromBlock(result.value);
    expect(reason).toBeDefined();
    expect(reason ?? "").toContain("Update `/src/README.md`");
  });

  it("suggests directory when no existing doc found", () => {
    const flagPath = "/tmp/pai-doc-obligation/docs-pending-test-session.json";
    const deps = makeTrackerDeps({
      fileExists: (path: string) => path === flagPath,
      readPending: () => ["/src/handler.ts"],
    });

    const result = DocObligationEnforcer.execute(makeStopInput(), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reason = getReasonFromBlock(result.value);
    expect(reason).toBeDefined();
    expect(reason ?? "").toContain("Create or update documentation in `/src/`");
  });

  it("groups files by directory in suggestions", () => {
    const flagPath = "/tmp/pai-doc-obligation/docs-pending-test-session.json";
    const deps = makeTrackerDeps({
      fileExists: (path: string) => path === flagPath,
      readPending: () => ["/src/auth/login.ts", "/src/auth/session.ts", "/lib/parser.ts"],
    });

    const result = DocObligationEnforcer.execute(makeStopInput(), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reason = getReasonFromBlock(result.value);
    expect(reason).toBeDefined();
    expect(reason ?? "").toContain("/src/auth/");
    expect(reason ?? "").toContain("/lib/");
  });

  it("finds CHANGELOG.md as existing doc", () => {
    const flagPath = "/tmp/pai-doc-obligation/docs-pending-test-session.json";
    const deps = makeTrackerDeps({
      fileExists: (path: string) => {
        if (path === flagPath) return true;
        if (path === "/src/CHANGELOG.md") return true;
        return false;
      },
      readPending: () => ["/src/handler.ts"],
    });

    const result = DocObligationEnforcer.execute(makeStopInput(), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reason = getReasonFromBlock(result.value);
    expect(reason).toBeDefined();
    expect(reason ?? "").toContain("Update `/src/CHANGELOG.md`");
  });

  // ── Block limit (escape valve) ──

  it("blocks on first stop attempt (blockCount=0)", () => {
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts"],
      readBlockCount: () => 0,
      writeBlockCount: () => {},
      writeReview: () => {},
    });

    const result = DocObligationEnforcer.execute(makeStopInput(), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getReasonFromBlock(result.value)).toBeDefined();
  });

  it("returns silent on second stop attempt (blockCount=1, MAX_BLOCKS=1)", () => {
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts"],
      readBlockCount: () => 1,
      writeBlockCount: () => {},
      writeReview: () => {},
    });

    const result = DocObligationEnforcer.execute(makeStopInput(), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isSilentNoOp(result.value)).toBe(true);
  });

  it("returns silent on third stop attempt (blockCount=2)", () => {
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts"],
      readBlockCount: () => 2,
      writeBlockCount: () => {},
      removeFlag: () => {},
      writeReview: () => {},
    });

    const result = DocObligationEnforcer.execute(makeStopInput(), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isSilentNoOp(result.value)).toBe(true);
  });

  it("increments block count when blocking", () => {
    let writtenCount = -1;
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts"],
      readBlockCount: () => 0,
      writeBlockCount: (_path: string, count: number) => {
        writtenCount = count;
      },
      writeReview: () => {},
    });

    DocObligationEnforcer.execute(makeStopInput(), deps);

    expect(writtenCount).toBe(1);
  });

  it("writes review doc when block limit reached", () => {
    let reviewWritten = false;
    let reviewContent = "";
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts", "/src/utils.ts"],
      readBlockCount: () => 2,
      writeBlockCount: () => {},
      removeFlag: () => {},
      writeReview: (_path: string, content: string) => {
        reviewWritten = true;
        reviewContent = content;
      },
    });

    DocObligationEnforcer.execute(makeStopInput(), deps);

    expect(reviewWritten).toBe(true);
    expect(reviewContent).toContain("/src/handler.ts");
    expect(reviewContent).toContain("/src/utils.ts");
  });

  it("cleans up state files when block limit reached", () => {
    const removedPaths: string[] = [];
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts"],
      readBlockCount: () => 2,
      writeBlockCount: () => {},
      removeFlag: (path: string) => {
        removedPaths.push(path);
      },
      writeReview: () => {},
    });

    DocObligationEnforcer.execute(makeStopInput(), deps);

    // Should clean up pending flag and block count file
    expect(removedPaths.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── DocObligationTracker excludePatterns ─────────────────────────────────────

describe("DocObligationTracker excludePatterns", () => {
  it("does not add file to pending when it matches an exclude pattern", () => {
    let writtenFiles: string[] | null = null;
    const deps = makeTrackerDeps({
      readPending: () => [],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
      getExcludePatterns: () => ["**/generated/**"],
    });

    DocObligationTracker.execute(
      makeToolInput("Edit", { file_path: "/src/generated/schema.ts" }),
      deps,
    );

    expect(writtenFiles).toBeNull();
  });

  it("still adds file when pattern does not match", () => {
    let writtenFiles: string[] = [];
    const deps = makeTrackerDeps({
      readPending: () => [],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
      getExcludePatterns: () => ["**/generated/**"],
    });

    DocObligationTracker.execute(
      makeToolInput("Edit", { file_path: "/src/handlers/user.ts" }),
      deps,
    );

    expect(writtenFiles).toContain("/src/handlers/user.ts");
  });

  it("adds file normally when excludePatterns is empty (backward compatible)", () => {
    let writtenFiles: string[] = [];
    const deps = makeTrackerDeps({
      readPending: () => [],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
      getExcludePatterns: () => [],
    });

    DocObligationTracker.execute(makeToolInput("Edit", { file_path: "/src/app.ts" }), deps);

    expect(writtenFiles).toContain("/src/app.ts");
  });

  it("excludes file when any pattern in the list matches", () => {
    let writtenFiles: string[] | null = null;
    const deps = makeTrackerDeps({
      readPending: () => [],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
      getExcludePatterns: () => ["**/vendor/**", "**/generated/**", "**/*.pb.ts"],
    });

    DocObligationTracker.execute(
      makeToolInput("Edit", { file_path: "/src/proto/types.pb.ts" }),
      deps,
    );

    expect(writtenFiles).toBeNull();
  });
});

// ─── projectHasHook ──────────────────────────────────────────────────────────

describe("projectHasHook", () => {
  it("returns false when .claude/hooks/ does not exist", () => {
    const result = projectHasHook(
      "DocObligationTracker",
      "/fake/project",
      () => false,
      () => ok([]),
    );
    expect(result).toBe(false);
  });

  it("returns true when matching hook file exists", () => {
    const result = projectHasHook(
      "DocObligationTracker",
      "/fake/project",
      () => true,
      () => ok(["DocObligationTracker.hook.js", "SpotCheckReview.hook.ts"]),
    );
    expect(result).toBe(true);
  });

  it("returns false when no matching hook file exists", () => {
    const result = projectHasHook(
      "DocObligationTracker",
      "/fake/project",
      () => true,
      () => ok(["SpotCheckReview.hook.ts"]),
    );
    expect(result).toBe(false);
  });

  it("matches any extension (.js, .ts, .mjs)", () => {
    const result = projectHasHook(
      "DocObligationTracker",
      "/fake/project",
      () => true,
      () => ok(["DocObligationTracker.hook.mjs"]),
    );
    expect(result).toBe(true);
  });

  it("returns false when readDir returns an error", () => {
    const result = projectHasHook(
      "DocObligationTracker",
      "/fake/project",
      () => true,
      () => err(fileReadFailed(".claude/hooks", new Error("EACCES"))),
    );
    expect(result).toBe(false);
  });
});

// ─── defaultDeps coverage ───────────────────────────────────────────────────

describe("DocObligationTracker defaultDeps", () => {
  it("defaultDeps.fileExists returns a boolean", () => {
    expect(typeof DocObligationTracker.defaultDeps.fileExists("/tmp")).toBe("boolean");
  });

  it("defaultDeps.readPending returns an array for nonexistent file", () => {
    const result = DocObligationTracker.defaultDeps.readPending(
      "/tmp/nonexistent-pai-dosm-12345.json",
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  it("defaultDeps.writePending writes without throwing", () => {
    const tmpPath = `/tmp/pai-test-dosm-wp-${Date.now()}.json`;
    expect(() =>
      DocObligationTracker.defaultDeps.writePending(tmpPath, ["/src/a.ts"]),
    ).not.toThrow();
  });

  it("defaultDeps.removeFlag does not throw for nonexistent file", () => {
    expect(() =>
      DocObligationTracker.defaultDeps.removeFlag("/tmp/nonexistent-pai-dosm-12345.json"),
    ).not.toThrow();
  });

  it("defaultDeps.readBlockCount returns 0 for nonexistent file", () => {
    const result = DocObligationTracker.defaultDeps.readBlockCount(
      "/tmp/nonexistent-pai-dosm-bc-12345.txt",
    );
    expect(result).toBe(0);
  });

  it("defaultDeps.writeBlockCount writes without throwing", () => {
    const tmpPath = `/tmp/pai-test-dosm-bc-${Date.now()}.txt`;
    expect(() => DocObligationTracker.defaultDeps.writeBlockCount(tmpPath, 1)).not.toThrow();
  });

  it("defaultDeps.writeReview writes without throwing", () => {
    const tmpPath = `/tmp/pai-test-dosm-rv-${Date.now()}.md`;
    expect(() => DocObligationTracker.defaultDeps.writeReview(tmpPath, "# Review")).not.toThrow();
  });

  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => DocObligationTracker.defaultDeps.stderr("test")).not.toThrow();
  });

  it("defaultDeps.stateDir is a string path", () => {
    expect(typeof DocObligationTracker.defaultDeps.stateDir).toBe("string");
    expect(DocObligationTracker.defaultDeps.stateDir).toContain("doc-obligation");
  });

  it("defaultDeps.readPending returns parsed array for valid JSON file", () => {
    const tmpPath = `/tmp/pai-test-dosm-rp-${Date.now()}.json`;
    require("node:fs").writeFileSync(tmpPath, JSON.stringify(["/src/a.ts", "/src/b.ts"]));
    const result = DocObligationTracker.defaultDeps.readPending(tmpPath);
    expect(result).toEqual(["/src/a.ts", "/src/b.ts"]);
    require("node:fs").unlinkSync(tmpPath);
  });
});

// ─── readDocExcludePatterns ─────────────────────────────────────────────────

describe("readDocExcludePatterns", () => {
  it("returns empty array for nonexistent settings file", () => {
    const result = readDocExcludePatterns("/tmp/nonexistent-settings-12345.json");
    expect(result).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    const tmpPath = `/tmp/pai-test-excl-bad-${Date.now()}.json`;
    require("node:fs").writeFileSync(tmpPath, "{ broken json !!!");
    const result = readDocExcludePatterns(tmpPath);
    expect(result).toEqual([]);
    require("node:fs").unlinkSync(tmpPath);
  });

  it("returns empty array when hookConfig has no docObligation", () => {
    const tmpPath = `/tmp/pai-test-excl-empty-${Date.now()}.json`;
    require("node:fs").writeFileSync(tmpPath, JSON.stringify({ hookConfig: {} }));
    const result = readDocExcludePatterns(tmpPath);
    expect(result).toEqual([]);
    require("node:fs").unlinkSync(tmpPath);
  });

  it("returns patterns when present in settings", () => {
    const tmpPath = `/tmp/pai-test-excl-valid-${Date.now()}.json`;
    require("node:fs").writeFileSync(
      tmpPath,
      JSON.stringify({
        hookConfig: {
          docObligation: {
            excludePatterns: ["**/generated/**", "**/vendor/**"],
          },
        },
      }),
    );
    const result = readDocExcludePatterns(tmpPath);
    expect(result).toEqual(["**/generated/**", "**/vendor/**"]);
    require("node:fs").unlinkSync(tmpPath);
  });
});
