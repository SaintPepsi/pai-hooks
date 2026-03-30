import { describe, expect, it } from "bun:test";
import type { PaiError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { StopInput, ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { BlockOutput, ContinueOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import { TestObligationEnforcer } from "@hooks/hooks/ObligationStateMachines/TestObligationEnforcer/TestObligationEnforcer.contract";
import type { TestObligationDeps } from "@hooks/hooks/ObligationStateMachines/TestObligationStateMachine.shared";
import { readTestExcludePatterns } from "@hooks/hooks/ObligationStateMachines/TestObligationStateMachine.shared";
import {
  TestObligationTracker,
  type TestTrackerDeps,
} from "@hooks/hooks/ObligationStateMachines/TestObligationTracker/TestObligationTracker.contract";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTrackerDeps(overrides: Partial<TestTrackerDeps> = {}): TestTrackerDeps {
  return {
    stateDir: "/tmp/pai-test-obligation",
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

function makeToolInput(toolName: string, toolInput: Record<string, unknown> = {}): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: toolName,
    tool_input: toolInput,
  };
}

function makeStopInput(): StopInput {
  return {
    session_id: "test-session",
  };
}

// ─── TestObligationTracker ────────────────────────────────────────────────────

describe("TestObligationTracker", () => {
  it("has correct name and event", () => {
    expect(TestObligationTracker.name).toBe("TestObligationTracker");
    expect(TestObligationTracker.event).toBe("PostToolUse");
  });

  // ── accepts ──

  it("accepts Edit tool with code file", () => {
    expect(TestObligationTracker.accepts(makeToolInput("Edit", { file_path: "/src/app.ts" }))).toBe(
      true,
    );
  });

  it("accepts Write tool with code file", () => {
    expect(
      TestObligationTracker.accepts(makeToolInput("Write", { file_path: "/src/app.tsx" })),
    ).toBe(true);
  });

  it("accepts Bash tool", () => {
    expect(TestObligationTracker.accepts(makeToolInput("Bash", { command: "bun test" }))).toBe(
      true,
    );
  });

  it("rejects Read tool", () => {
    expect(TestObligationTracker.accepts(makeToolInput("Read"))).toBe(false);
  });

  it("rejects Edit with non-code file", () => {
    expect(
      TestObligationTracker.accepts(makeToolInput("Edit", { file_path: "/docs/README.md" })),
    ).toBe(false);
  });

  it("rejects Write with non-code file", () => {
    expect(
      TestObligationTracker.accepts(makeToolInput("Write", { file_path: "/config.json" })),
    ).toBe(false);
  });

  it("rejects Edit with test file", () => {
    expect(
      TestObligationTracker.accepts(makeToolInput("Edit", { file_path: "/src/app.test.ts" })),
    ).toBe(false);
  });

  it("rejects Edit with spec file", () => {
    expect(
      TestObligationTracker.accepts(makeToolInput("Edit", { file_path: "/src/app.spec.tsx" })),
    ).toBe(false);
  });

  // ── PHP/Laravel test file patterns ──

  it("rejects Edit with PHP Test file (FooTest.php)", () => {
    expect(
      TestObligationTracker.accepts(
        makeToolInput("Edit", {
          file_path: "/app/Console/Commands/SeedTestIneligibleMatterTest.php",
        }),
      ),
    ).toBe(false);
  });

  it("rejects Write with PHP Test file in tests/Feature/", () => {
    expect(
      TestObligationTracker.accepts(
        makeToolInput("Write", {
          file_path: "/tests/Feature/Console/SeedTestIneligibleMatterTest.php",
        }),
      ),
    ).toBe(false);
  });

  it("rejects Edit with PHP Test file in tests/Unit/", () => {
    expect(
      TestObligationTracker.accepts(
        makeToolInput("Edit", { file_path: "/tests/Unit/Models/UserTest.php" }),
      ),
    ).toBe(false);
  });

  it("accepts Edit with PHP production file (not a test)", () => {
    expect(
      TestObligationTracker.accepts(
        makeToolInput("Edit", { file_path: "/app/Console/Commands/SeedTestIneligibleMatter.php" }),
      ),
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

    const result = TestObligationTracker.execute(
      makeToolInput("Edit", { file_path: "/src/handler.ts" }),
      deps,
    ) as Result<ContinueOutput, PaiError>;

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

    const result = TestObligationTracker.execute(
      makeToolInput("Write", { file_path: "/src/utils.ts" }),
      deps,
    ) as Result<ContinueOutput, PaiError>;

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

    TestObligationTracker.execute(makeToolInput("Edit", { file_path: "/src/handler.ts" }), deps);

    expect(writtenFiles).toEqual(["/src/handler.ts"]);
  });

  // ── Bare test commands clear all pending ──

  it("clears all files when Bash runs bare bun test", () => {
    let removed = false;
    const deps = makeTrackerDeps({
      fileExists: () => true,
      removeFlag: () => {
        removed = true;
      },
    });

    const result = TestObligationTracker.execute(
      makeToolInput("Bash", { command: "bun test" }),
      deps,
    ) as Result<ContinueOutput, PaiError>;

    expect(result.ok).toBe(true);
    expect(removed).toBe(true);
  });

  it("clears all files when Bash runs npm test", () => {
    let removed = false;
    const deps = makeTrackerDeps({
      fileExists: () => true,
      removeFlag: () => {
        removed = true;
      },
    });

    TestObligationTracker.execute(makeToolInput("Bash", { command: "npm test" }), deps);

    expect(removed).toBe(true);
  });

  // ── PHP/Laravel test commands ──

  it("clears all files when Bash runs phpunit", () => {
    let removed = false;
    const deps = makeTrackerDeps({
      fileExists: () => true,
      removeFlag: () => {
        removed = true;
      },
    });

    TestObligationTracker.execute(makeToolInput("Bash", { command: "phpunit" }), deps);

    expect(removed).toBe(true);
  });

  it("clears all files when Bash runs sail phpunit", () => {
    let removed = false;
    const deps = makeTrackerDeps({
      fileExists: () => true,
      removeFlag: () => {
        removed = true;
      },
    });

    TestObligationTracker.execute(
      makeToolInput("Bash", { command: "sail phpunit --filter SeedTestIneligibleMatterTest" }),
      deps,
    );

    expect(removed).toBe(true);
  });

  it("clears all files when Bash runs sail test", () => {
    let removed = false;
    const deps = makeTrackerDeps({
      fileExists: () => true,
      removeFlag: () => {
        removed = true;
      },
    });

    TestObligationTracker.execute(makeToolInput("Bash", { command: "sail test" }), deps);

    expect(removed).toBe(true);
  });

  it("clears all files when Bash runs php artisan test", () => {
    let removed = false;
    const deps = makeTrackerDeps({
      fileExists: () => true,
      removeFlag: () => {
        removed = true;
      },
    });

    TestObligationTracker.execute(makeToolInput("Bash", { command: "php artisan test" }), deps);

    expect(removed).toBe(true);
  });

  it("clears all files when Bash runs bare vitest", () => {
    let removed = false;
    const deps = makeTrackerDeps({
      fileExists: () => true,
      removeFlag: () => {
        removed = true;
      },
    });

    TestObligationTracker.execute(makeToolInput("Bash", { command: "npx vitest run" }), deps);

    expect(removed).toBe(true);
  });

  // ── Specific test file clears only matching source file ──

  it("clears only matching file when specific test run", () => {
    let writtenFiles: string[] = [];
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts", "/src/utils.ts"],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
    });

    TestObligationTracker.execute(
      makeToolInput("Bash", { command: "bun test src/handler.test.ts" }),
      deps,
    );

    expect(writtenFiles).toEqual(["/src/utils.ts"]);
  });

  it("keeps non-matching files when specific test run", () => {
    let writtenFiles: string[] = [];
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts", "/src/utils.ts", "/src/app.ts"],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
    });

    TestObligationTracker.execute(
      makeToolInput("Bash", { command: "bun test src/utils.test.ts" }),
      deps,
    );

    expect(writtenFiles).toEqual(["/src/handler.ts", "/src/app.ts"]);
  });

  it("removes flag file when last pending file cleared by specific test", () => {
    let removed = false;
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts"],
      writePending: () => {},
      removeFlag: () => {
        removed = true;
      },
    });

    TestObligationTracker.execute(
      makeToolInput("Bash", { command: "bun test src/handler.test.ts" }),
      deps,
    );

    expect(removed).toBe(true);
  });

  it("matches test file with absolute path to pending file", () => {
    let writtenFiles: string[] = [];
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/Users/dev/project/src/handler.ts", "/Users/dev/project/src/utils.ts"],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
    });

    TestObligationTracker.execute(
      makeToolInput("Bash", { command: "bun test src/handler.test.ts" }),
      deps,
    );

    expect(writtenFiles).toEqual(["/Users/dev/project/src/utils.ts"]);
  });

  it("matches spec file pattern in test command", () => {
    let writtenFiles: string[] = [];
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts", "/src/utils.ts"],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
    });

    TestObligationTracker.execute(
      makeToolInput("Bash", { command: "bun test src/handler.spec.ts" }),
      deps,
    );

    expect(writtenFiles).toEqual(["/src/utils.ts"]);
  });

  // ── Non-test commands ──

  it("does not clear flag for non-test Bash command", () => {
    let removed = false;
    let writtenFiles: string[] | null = null;
    const deps = makeTrackerDeps({
      fileExists: () => true,
      removeFlag: () => {
        removed = true;
      },
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
    });

    TestObligationTracker.execute(makeToolInput("Bash", { command: "git status" }), deps);

    expect(removed).toBe(false);
    expect(writtenFiles).toBeNull();
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

    TestObligationTracker.execute(makeToolInput("Edit", { file_path: "/src/handler.ts" }), deps);

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

    TestObligationTracker.execute(
      { session_id: "session-aaa", tool_name: "Edit", tool_input: { file_path: "/src/a.ts" } },
      deps,
    );
    TestObligationTracker.execute(
      { session_id: "session-bbb", tool_name: "Edit", tool_input: { file_path: "/src/b.ts" } },
      deps,
    );

    expect(paths[0]).not.toEqual(paths[1]);
    expect(paths[0]).toContain("session-aaa");
    expect(paths[1]).toContain("session-bbb");
  });

  it("does not clear flag when no flag exists", () => {
    let removed = false;
    const deps = makeTrackerDeps({
      fileExists: () => false,
      removeFlag: () => {
        removed = true;
      },
    });

    TestObligationTracker.execute(makeToolInput("Bash", { command: "bun test" }), deps);

    expect(removed).toBe(false);
  });
});

// ─── TestObligationEnforcer ───────────────────────────────────────────────────

describe("TestObligationEnforcer", () => {
  it("has correct name and event", () => {
    expect(TestObligationEnforcer.name).toBe("TestObligationEnforcer");
    expect(TestObligationEnforcer.event).toBe("Stop");
  });

  it("accepts all inputs", () => {
    expect(TestObligationEnforcer.accepts(makeStopInput())).toBe(true);
  });

  it("returns silent when no pending flag exists", () => {
    const deps = makeTrackerDeps({ fileExists: () => false });

    const result = TestObligationEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput | SilentOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("returns block when pending flag exists", () => {
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts", "/src/utils.ts"],
    });

    const result = TestObligationEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput | SilentOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("block reason includes file paths", () => {
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts"],
    });

    const result = TestObligationEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason).toContain("/src/handler.ts");
  });

  it("block reason mentions tests", () => {
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/app.ts"],
    });

    const result = TestObligationEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason.toLowerCase()).toContain("test");
  });

  // ── Differentiated messages: write vs run ──

  it("says 'write' for files without existing test files", () => {
    const flagPath = "/tmp/pai-test-obligation/tests-pending-test-session.json";
    const deps = makeTrackerDeps({
      fileExists: (path: string) => path === flagPath,
      readPending: () => ["/src/handler.ts"],
    });

    const result = TestObligationEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason.toLowerCase()).toContain("write");
    expect(result.value.reason).toContain("/src/handler.ts");
  });

  it("says 'run' for files with existing test files", () => {
    const flagPath = "/tmp/pai-test-obligation/tests-pending-test-session.json";
    const deps = makeTrackerDeps({
      fileExists: (path: string) => {
        if (path === flagPath) return true;
        if (path === "/src/handler.test.ts") return true;
        return false;
      },
      readPending: () => ["/src/handler.ts"],
    });

    const result = TestObligationEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason.toLowerCase()).toContain("run");
    // Should NOT say write for this file
    expect(result.value.reason.toLowerCase()).not.toMatch(/write.*handler/);
  });

  it("matches PHP Test variant (FooTest.php) as existing test file", () => {
    const flagPath = "/tmp/pai-test-obligation/tests-pending-test-session.json";
    const deps = makeTrackerDeps({
      fileExists: (path: string) => {
        if (path === flagPath) return true;
        if (path === "/app/Console/Commands/SeedTestIneligibleMatterTest.php") return true;
        return false;
      },
      readPending: () => ["/app/Console/Commands/SeedTestIneligibleMatter.php"],
    });

    const result = TestObligationEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Has a test (FooTest.php), so should say run, not write
    expect(result.value.reason.toLowerCase()).not.toMatch(/write.*seedtest/i);
  });

  it("matches .spec. variant as existing test file", () => {
    const flagPath = "/tmp/pai-test-obligation/tests-pending-test-session.json";
    const deps = makeTrackerDeps({
      fileExists: (path: string) => {
        if (path === flagPath) return true;
        if (path === "/src/handler.spec.ts") return true;
        return false;
      },
      readPending: () => ["/src/handler.ts"],
    });

    const result = TestObligationEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Has a test (.spec.), so should say run, not write
    expect(result.value.reason.toLowerCase()).not.toMatch(/write.*handler/);
  });

  it("separates write and run instructions in mixed scenario", () => {
    const flagPath = "/tmp/pai-test-obligation/tests-pending-test-session.json";
    const deps = makeTrackerDeps({
      fileExists: (path: string) => {
        if (path === flagPath) return true;
        if (path === "/src/handler.test.ts") return true;
        return false;
      },
      readPending: () => ["/src/handler.ts", "/src/utils.ts"],
    });

    const result = TestObligationEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reason = result.value.reason;
    // handler.ts has a test → run instruction
    // utils.ts has no test → write instruction
    expect(reason).toContain("/src/handler.ts");
    expect(reason).toContain("/src/utils.ts");
    expect(reason.toLowerCase()).toContain("write");
    expect(reason.toLowerCase()).toContain("run");
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

    const result = TestObligationEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput | SilentOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("blocks on second stop attempt (blockCount=1)", () => {
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => ["/src/handler.ts"],
      readBlockCount: () => 1,
      writeBlockCount: () => {},
      writeReview: () => {},
    });

    const result = TestObligationEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput | SilentOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
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

    const result = TestObligationEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput | SilentOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
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

    TestObligationEnforcer.execute(makeStopInput(), deps);

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

    TestObligationEnforcer.execute(makeStopInput(), deps);

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

    TestObligationEnforcer.execute(makeStopInput(), deps);

    // Should clean up pending flag and block count file
    expect(removedPaths.length).toBeGreaterThanOrEqual(1);
  });

  it("returns silent when pending list is empty", () => {
    const deps = makeTrackerDeps({
      fileExists: () => true,
      readPending: () => [],
    });

    const result = TestObligationEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput | SilentOutput,
      PaiError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });
});

// ─── TestObligationTracker excludePatterns ────────────────────────────────────

describe("TestObligationTracker excludePatterns", () => {
  it("does not add file to pending when it matches an exclude pattern", () => {
    let writtenFiles: string[] | null = null;
    const deps = makeTrackerDeps({
      readPending: () => [],
      writePending: (_path: string, files: string[]) => {
        writtenFiles = files;
      },
      getExcludePatterns: () => ["**/generated/**"],
    });

    TestObligationTracker.execute(
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

    TestObligationTracker.execute(
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

    TestObligationTracker.execute(
      makeToolInput("Edit", { file_path: "/src/app.ts" }),
      deps,
    );

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

    TestObligationTracker.execute(
      makeToolInput("Edit", { file_path: "/src/proto/types.pb.ts" }),
      deps,
    );

    expect(writtenFiles).toBeNull();
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────────

describe("TestObligationTracker edge cases", () => {
  it("returns continue when Edit has no file_path in tool_input", () => {
    const deps = makeTrackerDeps();
    // Bypass accepts() by calling execute directly with Edit but no file_path
    const input: ToolHookInput = {
      session_id: "test-session",
      tool_name: "Edit",
      tool_input: {},
    };
    const result = TestObligationTracker.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });
});

// ─── defaultDeps coverage ───────────────────────────────────────────────────

describe("TestObligationTracker defaultDeps", () => {
  it("defaultDeps.fileExists returns a boolean", () => {
    expect(typeof TestObligationTracker.defaultDeps.fileExists("/tmp")).toBe("boolean");
  });

  it("defaultDeps.readPending returns an array for nonexistent file", () => {
    const result = TestObligationTracker.defaultDeps.readPending(
      "/tmp/nonexistent-pai-tosm-12345.json",
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  it("defaultDeps.writePending writes without throwing", () => {
    const tmpPath = `/tmp/pai-test-tosm-wp-${Date.now()}.json`;
    expect(() =>
      TestObligationTracker.defaultDeps.writePending(tmpPath, ["/src/a.ts"]),
    ).not.toThrow();
  });

  it("defaultDeps.removeFlag does not throw for nonexistent file", () => {
    expect(() =>
      TestObligationTracker.defaultDeps.removeFlag("/tmp/nonexistent-pai-tosm-12345.json"),
    ).not.toThrow();
  });

  it("defaultDeps.readBlockCount returns 0 for nonexistent file", () => {
    const result = TestObligationTracker.defaultDeps.readBlockCount(
      "/tmp/nonexistent-pai-tosm-bc-12345.txt",
    );
    expect(result).toBe(0);
  });

  it("defaultDeps.writeBlockCount writes without throwing", () => {
    const tmpPath = `/tmp/pai-test-tosm-bc-${Date.now()}.txt`;
    expect(() => TestObligationTracker.defaultDeps.writeBlockCount(tmpPath, 1)).not.toThrow();
  });

  it("defaultDeps.writeReview writes without throwing", () => {
    const tmpPath = `/tmp/pai-test-tosm-rv-${Date.now()}.md`;
    expect(() => TestObligationTracker.defaultDeps.writeReview(tmpPath, "# Review")).not.toThrow();
  });

  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => TestObligationTracker.defaultDeps.stderr("test")).not.toThrow();
  });

  it("defaultDeps.stateDir is a string path", () => {
    expect(typeof TestObligationTracker.defaultDeps.stateDir).toBe("string");
    expect(TestObligationTracker.defaultDeps.stateDir).toContain("test-obligation");
  });

  it("defaultDeps.readPending handles corrupt state file", () => {
    const tmpPath = `/tmp/pai-test-tosm-corrupt-${Date.now()}.json`;
    require("fs").writeFileSync(tmpPath, "{ broken json !!!");
    const result = TestObligationTracker.defaultDeps.readPending(tmpPath);
    expect(result).toEqual([]);
    require("fs").unlinkSync(tmpPath);
  });

  it("defaultDeps.readPending returns parsed array for valid file", () => {
    const tmpPath = `/tmp/pai-test-tosm-rp-${Date.now()}.json`;
    require("fs").writeFileSync(tmpPath, JSON.stringify(["/src/a.ts"]));
    const result = TestObligationTracker.defaultDeps.readPending(tmpPath);
    expect(result).toEqual(["/src/a.ts"]);
    require("fs").unlinkSync(tmpPath);
  });

  it("defaultDeps.readBlockCount parses numeric content", () => {
    const tmpPath = `/tmp/pai-test-tosm-bc-${Date.now()}.txt`;
    require("fs").writeFileSync(tmpPath, "42");
    const result = TestObligationTracker.defaultDeps.readBlockCount(tmpPath);
    expect(result).toBe(42);
    require("fs").unlinkSync(tmpPath);
  });
});

// ─── readTestExcludePatterns ────────────────────────────────────────────────

describe("readTestExcludePatterns", () => {
  it("returns empty array for nonexistent settings", () => {
    expect(readTestExcludePatterns("/tmp/nonexistent-tosm-12345.json")).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    const tmpPath = `/tmp/pai-test-tosm-excl-bad-${Date.now()}.json`;
    require("fs").writeFileSync(tmpPath, "{ broken !!!");
    expect(readTestExcludePatterns(tmpPath)).toEqual([]);
    require("fs").unlinkSync(tmpPath);
  });

  it("returns patterns when present", () => {
    const tmpPath = `/tmp/pai-test-tosm-excl-${Date.now()}.json`;
    require("fs").writeFileSync(
      tmpPath,
      JSON.stringify({
        hookConfig: { testObligation: { excludePatterns: ["**/vendor/**"] } },
      }),
    );
    expect(readTestExcludePatterns(tmpPath)).toEqual(["**/vendor/**"]);
    require("fs").unlinkSync(tmpPath);
  });

  it("returns empty array when no testObligation config", () => {
    const tmpPath = `/tmp/pai-test-tosm-excl-none-${Date.now()}.json`;
    require("fs").writeFileSync(tmpPath, JSON.stringify({ hookConfig: {} }));
    expect(readTestExcludePatterns(tmpPath)).toEqual([]);
    require("fs").unlinkSync(tmpPath);
  });
});

// ─── defaultDeps write-failure branches ─────────────────────────────────────

describe("TestObligationTracker defaultDeps — write failures", () => {
  it("defaultDeps.writePending does not throw on write failure", () => {
    // /proc is read-only on all platforms, triggering the error branch
    expect(() =>
      TestObligationTracker.defaultDeps.writePending("/proc/pai-test-write-fail.json", ["/a.ts"]),
    ).not.toThrow();
  });

  it("defaultDeps.writeBlockCount does not throw on write failure", () => {
    expect(() =>
      TestObligationTracker.defaultDeps.writeBlockCount("/proc/pai-test-bc-fail.txt", 1),
    ).not.toThrow();
  });
});
