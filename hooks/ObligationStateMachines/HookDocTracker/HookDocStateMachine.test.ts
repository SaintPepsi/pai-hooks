import { describe, expect, it } from "bun:test";
import type { PaiError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { StopInput, ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { BlockOutput, ContinueOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import { HookDocEnforcer } from "@hooks/hooks/ObligationStateMachines/HookDocEnforcer/HookDocEnforcer.contract";
import {
  buildDocSuggestions,
  getHookDirFromPath,
  isHookDocFile,
  isHookSourceFile,
  readHookDocSettings,
  validateDocSections,
} from "@hooks/hooks/ObligationStateMachines/HookDocStateMachine.shared";
import { HookDocTracker } from "@hooks/hooks/ObligationStateMachines/HookDocTracker/HookDocTracker.contract";
import type { ObligationDeps } from "@hooks/lib/obligation-machine";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<ObligationDeps> = {}): ObligationDeps {
  return {
    stateDir: "/tmp/pai-hook-doc-obligation",
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

function makeToolInput(toolName: string, toolInput: Record<string, unknown> = {}): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: toolName,
    tool_input: toolInput,
  };
}

function makeStopInput(): StopInput {
  return { session_id: "test-session" };
}

// ─── Domain Helpers ───────────────────────────────────────────────────────────

describe("isHookSourceFile", () => {
  const patterns = [/\.contract\.ts$/, /hook\.json$/, /group\.json$/];

  it("matches .contract.ts files", () => {
    expect(isHookSourceFile("/hooks/Group/Hook/Hook.contract.ts", patterns)).toBe(true);
  });

  it("matches hook.json files", () => {
    expect(isHookSourceFile("/hooks/Group/Hook/hook.json", patterns)).toBe(true);
  });

  it("matches group.json files", () => {
    expect(isHookSourceFile("/hooks/Group/group.json", patterns)).toBe(true);
  });

  it("rejects .hook.ts files", () => {
    expect(isHookSourceFile("/hooks/Group/Hook/Hook.hook.ts", patterns)).toBe(false);
  });

  it("rejects test files", () => {
    expect(isHookSourceFile("/hooks/Group/Hook/Hook.test.ts", patterns)).toBe(false);
  });

  it("rejects arbitrary files", () => {
    expect(isHookSourceFile("/src/app.ts", patterns)).toBe(false);
  });
});

describe("isHookDocFile", () => {
  it("matches doc.md at end of path", () => {
    expect(isHookDocFile("/hooks/Group/Hook/doc.md", "doc.md")).toBe(true);
  });

  it("matches bare doc.md", () => {
    expect(isHookDocFile("doc.md", "doc.md")).toBe(true);
  });

  it("rejects README.md", () => {
    expect(isHookDocFile("/hooks/Group/README.md", "doc.md")).toBe(false);
  });

  it("supports custom doc file names", () => {
    expect(isHookDocFile("/hooks/Group/Hook/docs.md", "docs.md")).toBe(true);
  });
});

describe("getHookDirFromPath", () => {
  it("returns parent directory", () => {
    expect(getHookDirFromPath("/hooks/Group/Hook/Hook.contract.ts")).toBe("/hooks/Group/Hook");
  });
});

describe("validateDocSections", () => {
  it("returns valid when all sections present", () => {
    const content = "## Overview\nfoo\n## Event\nbar\n## When It Fires\nbaz";
    const result = validateDocSections(content, ["## Overview", "## Event", "## When It Fires"]);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("returns missing sections", () => {
    const content = "## Overview\nfoo";
    const result = validateDocSections(content, ["## Overview", "## Event", "## Dependencies"]);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(["## Event", "## Dependencies"]);
  });
});

describe("buildDocSuggestions", () => {
  it("lists directories needing docs", () => {
    const settings = {
      enabled: true,
      blocking: true,
      requiredSections: ["## Overview"],
      docFileName: "doc.md",
      watchPatterns: [],
    };

    const result = buildDocSuggestions(["/hooks/G/H/H.contract.ts"], settings);
    expect(result).toContain("/hooks/G/H/doc.md");
  });

  it("deduplicates directories", () => {
    const settings = {
      enabled: true,
      blocking: true,
      requiredSections: [],
      docFileName: "doc.md",
      watchPatterns: [],
    };

    const result = buildDocSuggestions(["/hooks/G/H/a.ts", "/hooks/G/H/b.ts"], settings);
    const matches = result.match(/\/hooks\/G\/H\/doc\.md/g);
    expect(matches?.length).toBe(1);
  });

  it("includes required sections hint", () => {
    const settings = {
      enabled: true,
      blocking: true,
      requiredSections: ["## Overview", "## Event"],
      docFileName: "doc.md",
      watchPatterns: [],
    };

    const result = buildDocSuggestions(["/hooks/G/H/H.contract.ts"], settings);
    expect(result).toContain("## Overview");
    expect(result).toContain("## Event");
  });
});

describe("readHookDocSettings", () => {
  it("returns defaults when settings file is missing", () => {
    const settings = readHookDocSettings(() => null);
    expect(settings.enabled).toBe(true);
    expect(settings.blocking).toBe(true);
    expect(settings.docFileName).toBe("doc.md");
    expect(settings.requiredSections.length).toBeGreaterThan(0);
    expect(settings.watchPatterns.length).toBeGreaterThan(0);
  });

  it("returns defaults when hookConfig is missing", () => {
    const settings = readHookDocSettings(() => JSON.stringify({}));
    expect(settings.enabled).toBe(true);
  });

  it("reads custom settings", () => {
    const json = JSON.stringify({
      hookConfig: {
        hookDocEnforcer: {
          enabled: false,
          blocking: false,
          requiredSections: ["## Custom"],
          docFileName: "docs.md",
          watchPatterns: ["\\.ts$"],
        },
      },
    });
    const settings = readHookDocSettings(() => json);
    expect(settings.enabled).toBe(false);
    expect(settings.blocking).toBe(false);
    expect(settings.requiredSections).toEqual(["## Custom"]);
    expect(settings.docFileName).toBe("docs.md");
    expect(settings.watchPatterns[0].test("foo.ts")).toBe(true);
  });

  it("handles malformed JSON gracefully", () => {
    const settings = readHookDocSettings(() => "not json{{{");
    expect(settings.enabled).toBe(true); // defaults
  });
});

// ─── HookDocTracker ───────────────────────────────────────────────────────────

describe("HookDocTracker", () => {
  it("has correct name and event", () => {
    expect(HookDocTracker.name).toBe("HookDocTracker");
    expect(HookDocTracker.event).toBe("PostToolUse");
  });

  // ── accepts ──

  it("accepts Edit on .contract.ts file", () => {
    expect(
      HookDocTracker.accepts(makeToolInput("Edit", { file_path: "/hooks/G/H/H.contract.ts" })),
    ).toBe(true);
  });

  it("accepts Write on hook.json", () => {
    expect(
      HookDocTracker.accepts(makeToolInput("Write", { file_path: "/hooks/G/H/hook.json" })),
    ).toBe(true);
  });

  it("accepts Edit on doc.md (for clearing)", () => {
    expect(HookDocTracker.accepts(makeToolInput("Edit", { file_path: "/hooks/G/H/doc.md" }))).toBe(
      true,
    );
  });

  it("rejects Read tool", () => {
    expect(
      HookDocTracker.accepts(makeToolInput("Read", { file_path: "/hooks/G/H/H.contract.ts" })),
    ).toBe(false);
  });

  it("rejects non-hook files", () => {
    expect(HookDocTracker.accepts(makeToolInput("Edit", { file_path: "/src/app.ts" }))).toBe(false);
  });

  it("rejects Edit without file_path", () => {
    expect(HookDocTracker.accepts(makeToolInput("Edit", {}))).toBe(false);
  });

  // ── execute: source file tracking ──

  it("adds source file to pending when edited", () => {
    let written: string[] = [];
    const deps = makeDeps({
      readPending: () => [],
      writePending: (_p, files) => {
        written = files;
      },
    });

    const result = HookDocTracker.execute(
      makeToolInput("Edit", { file_path: "/hooks/G/H/H.contract.ts" }),
      deps,
    ) as Result<ContinueOutput, PaiError>;

    expect(result.ok).toBe(true);
    expect(written).toContain("/hooks/G/H/H.contract.ts");
  });

  it("does not duplicate pending entries", () => {
    let written: string[] = [];
    const deps = makeDeps({
      readPending: () => ["/hooks/G/H/H.contract.ts"],
      writePending: (_p, files) => {
        written = files;
      },
    });

    HookDocTracker.execute(makeToolInput("Edit", { file_path: "/hooks/G/H/H.contract.ts" }), deps);

    expect(written).toEqual(["/hooks/G/H/H.contract.ts"]);
  });

  // ── execute: doc file clearing ──

  it("clears pending when doc.md written in same directory", () => {
    let removed = false;
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/hooks/G/H/H.contract.ts"],
      removeFlag: () => {
        removed = true;
      },
    });

    HookDocTracker.execute(makeToolInput("Write", { file_path: "/hooks/G/H/doc.md" }), deps);

    expect(removed).toBe(true);
  });

  it("only clears entries from same hook directory", () => {
    let written: string[] = [];
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/hooks/G/H1/H1.contract.ts", "/hooks/G/H2/H2.contract.ts"],
      writePending: (_p, files) => {
        written = files;
      },
    });

    HookDocTracker.execute(makeToolInput("Write", { file_path: "/hooks/G/H1/doc.md" }), deps);

    expect(written).toEqual(["/hooks/G/H2/H2.contract.ts"]);
  });

  it("uses session_id in state file path", () => {
    let writtenPath = "";
    const deps = makeDeps({
      readPending: () => [],
      writePending: (path) => {
        writtenPath = path;
      },
    });

    HookDocTracker.execute(makeToolInput("Edit", { file_path: "/hooks/G/H/H.contract.ts" }), deps);

    expect(writtenPath).toContain("test-session");
  });
});

// ─── HookDocEnforcer ──────────────────────────────────────────────────────────

describe("HookDocEnforcer", () => {
  it("has correct name and event", () => {
    expect(HookDocEnforcer.name).toBe("HookDocEnforcer");
    expect(HookDocEnforcer.event).toBe("Stop");
  });

  it("returns silent when no pending flag exists", () => {
    const deps = makeDeps({ fileExists: () => false });
    const result = HookDocEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput | SilentOutput,
      PaiError
    >;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("returns silent when pending list is empty", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => [],
    });
    const result = HookDocEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput | SilentOutput,
      PaiError
    >;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("returns block when pending files exist", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/hooks/G/H/H.contract.ts"],
    });
    const result = HookDocEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput | SilentOutput,
      PaiError
    >;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("block reason includes pending file paths", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/hooks/G/H/H.contract.ts"],
    });
    const result = HookDocEnforcer.execute(makeStopInput(), deps) as Result<BlockOutput, PaiError>;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason).toContain("/hooks/G/H/H.contract.ts");
  });

  it("block reason includes doc.md suggestion", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/hooks/G/H/H.contract.ts"],
    });
    const result = HookDocEnforcer.execute(makeStopInput(), deps) as Result<BlockOutput, PaiError>;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason).toContain("doc.md");
  });

  it("block reason includes required sections", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/hooks/G/H/H.contract.ts"],
    });
    const result = HookDocEnforcer.execute(makeStopInput(), deps) as Result<BlockOutput, PaiError>;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason).toContain("## Overview");
  });

  it("returns silent after block limit reached (maxBlocks=1)", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/hooks/G/H/H.contract.ts"],
      readBlockCount: () => 1,
    });
    const result = HookDocEnforcer.execute(makeStopInput(), deps) as Result<
      BlockOutput | SilentOutput,
      PaiError
    >;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("increments block count on block", () => {
    let writtenCount = -1;
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/hooks/G/H/H.contract.ts"],
      readBlockCount: () => 0,
      writeBlockCount: (_p, count) => {
        writtenCount = count;
      },
    });

    HookDocEnforcer.execute(makeStopInput(), deps);
    expect(writtenCount).toBe(1);
  });

  it("cleans up state on release", () => {
    const removedPaths: string[] = [];
    const deps = makeDeps({
      fileExists: () => true,
      readPending: () => ["/hooks/G/H/H.contract.ts"],
      readBlockCount: () => 1,
      removeFlag: (p) => {
        removedPaths.push(p);
      },
    });

    HookDocEnforcer.execute(makeStopInput(), deps);
    expect(removedPaths.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── defaultDeps coverage ─────────────────────────────────────────────────────

describe("HookDocTracker defaultDeps", () => {
  it("defaultDeps.stateDir contains hook-doc-obligation", () => {
    expect(HookDocTracker.defaultDeps.stateDir).toContain("hook-doc-obligation");
  });

  it("defaultDeps.fileExists returns a boolean", () => {
    expect(typeof HookDocTracker.defaultDeps.fileExists("/tmp")).toBe("boolean");
  });

  it("defaultDeps.readPending returns array for nonexistent file", () => {
    const result = HookDocTracker.defaultDeps.readPending("/tmp/nonexistent-hookdoc-12345.json");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([]);
  });

  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => HookDocTracker.defaultDeps.stderr("test")).not.toThrow();
  });
});

// ─── HookDocEnforcer.accepts ────────────────────────────────────────────────

describe("HookDocEnforcer.accepts", () => {
  it("returns a boolean for any StopInput", () => {
    const result = HookDocEnforcer.accepts(makeStopInput());
    expect(typeof result).toBe("boolean");
  });
});
