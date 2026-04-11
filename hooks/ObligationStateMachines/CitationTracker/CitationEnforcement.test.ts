import { describe, expect, it } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { CitationEnforcement } from "@hooks/hooks/ObligationStateMachines/CitationEnforcement/CitationEnforcement.contract";
import type { CitationEnforcementDeps } from "@hooks/hooks/ObligationStateMachines/CitationEnforcement.shared";
import { CitationTracker } from "@hooks/hooks/ObligationStateMachines/CitationTracker/CitationTracker.contract";

/** Narrow SyncHookJSONOutput to PostToolUse additionalContext (R2 channel). */
function getInjectedContext(output: SyncHookJSONOutput): string | undefined {
  const hs = output.hookSpecificOutput;
  if (!hs || hs.hookEventName !== "PostToolUse") return undefined;
  return "additionalContext" in hs ? hs.additionalContext : undefined;
}

const TEST_STATE_DIR = "/tmp/pai-citation-test";

function makeDeps(overrides: Partial<CitationEnforcementDeps> = {}): CitationEnforcementDeps {
  return {
    stateDir: TEST_STATE_DIR,
    fileExists: () => false,
    writeFlag: () => {},
    readReminded: () => [],
    writeReminded: () => {},
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

describe("CitationTracker", () => {
  it("has correct name and event", () => {
    expect(CitationTracker.name).toBe("CitationTracker");
    expect(CitationTracker.event).toBe("PostToolUse");
  });

  it("accepts WebSearch tool", () => {
    expect(CitationTracker.accepts(makeToolInput("WebSearch"))).toBe(true);
  });

  it("accepts WebFetch tool", () => {
    expect(CitationTracker.accepts(makeToolInput("WebFetch"))).toBe(true);
  });

  it("accepts Skill tool when skill is Research", () => {
    expect(CitationTracker.accepts(makeToolInput("Skill", { skill: "Research" }))).toBe(true);
  });

  it("rejects Skill tool when skill is not Research", () => {
    expect(CitationTracker.accepts(makeToolInput("Skill", { skill: "TDD" }))).toBe(false);
  });

  it("rejects non-research tools", () => {
    expect(CitationTracker.accepts(makeToolInput("Edit"))).toBe(false);
    expect(CitationTracker.accepts(makeToolInput("Read"))).toBe(false);
  });

  it("rejects Skill tool with string tool_input", () => {
    const input: ToolHookInput = {
      session_id: "test-session",
      tool_name: "Skill",
      tool_input: "Research" as unknown as Record<string, unknown>,
    };
    expect(CitationTracker.accepts(input)).toBe(false);
  });

  it("rejects Skill tool with null tool_input", () => {
    const input: ToolHookInput = {
      session_id: "test-session",
      tool_name: "Skill",
      tool_input: null as unknown as Record<string, unknown>,
    };
    expect(CitationTracker.accepts(input)).toBe(false);
  });

  it("writes flag file on execute", () => {
    let writtenPath = "";
    const deps = makeDeps({
      writeFlag: (path: string) => {
        writtenPath = path;
      },
    });
    const result = CitationTracker.execute(makeToolInput("WebSearch"), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    expect(writtenPath).toContain("research-active");
  });
});

describe("CitationEnforcement", () => {
  it("has correct name and event", () => {
    expect(CitationEnforcement.name).toBe("CitationEnforcement");
    expect(CitationEnforcement.event).toBe("PostToolUse");
  });

  it("accepts Write tool", () => {
    expect(CitationEnforcement.accepts(makeToolInput("Write", { file_path: "/tmp/test.md" }))).toBe(
      true,
    );
  });

  it("accepts Edit tool", () => {
    expect(CitationEnforcement.accepts(makeToolInput("Edit", { file_path: "/tmp/test.md" }))).toBe(
      true,
    );
  });

  it("rejects non-write tools", () => {
    expect(CitationEnforcement.accepts(makeToolInput("Read"))).toBe(false);
    expect(CitationEnforcement.accepts(makeToolInput("Bash"))).toBe(false);
  });

  it("returns continue without context when no research flag exists", () => {
    const deps = makeDeps({ fileExists: () => false });
    const result = CitationEnforcement.execute(
      makeToolInput("Write", { file_path: "/tmp/test.md" }),
      deps,
    ) as Result<SyncHookJSONOutput, ResultError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContext(result.value)).toBeUndefined();
  });

  it("returns citation reminder when research flag exists", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readReminded: () => [],
    });
    const result = CitationEnforcement.execute(
      makeToolInput("Write", { file_path: "/tmp/article.md" }),
      deps,
    ) as Result<SyncHookJSONOutput, ResultError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContext(result.value)).toBeDefined();
    expect(getInjectedContext(result.value) ?? "").toContain("citation");
  });

  it("only reminds once per file path", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readReminded: () => ["/tmp/article.md"],
    });
    const result = CitationEnforcement.execute(
      makeToolInput("Write", { file_path: "/tmp/article.md" }),
      deps,
    ) as Result<SyncHookJSONOutput, ResultError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContext(result.value)).toBeUndefined();
  });

  it("writes reminded file path after reminding", () => {
    let writtenPaths: string[] = [];
    const deps = makeDeps({
      fileExists: () => true,
      readReminded: () => [],
      writeReminded: (_path: string, files: string[]) => {
        writtenPaths = files;
      },
    });
    CitationEnforcement.execute(makeToolInput("Write", { file_path: "/tmp/new-article.md" }), deps);

    expect(writtenPaths).toContain("/tmp/new-article.md");
  });

  it("returns continue without context when file_path is missing", () => {
    const deps = makeDeps({
      fileExists: () => true,
    });
    const result = CitationEnforcement.execute(makeToolInput("Write", {}), deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContext(result.value)).toBeUndefined();
  });

  it("returns continue without context when tool_input is a string", () => {
    const deps = makeDeps({
      fileExists: () => true,
    });
    const input: ToolHookInput = {
      session_id: "test-session",
      tool_name: "Write",
      tool_input: "/tmp/test.md" as unknown as Record<string, unknown>,
    };
    const result = CitationEnforcement.execute(input, deps) as Result<
      SyncHookJSONOutput,
      ResultError
    >;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContext(result.value)).toBeUndefined();
  });

  it("reminds for different file paths", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readReminded: () => ["/tmp/article1.md"],
    });
    const result = CitationEnforcement.execute(
      makeToolInput("Write", { file_path: "/tmp/article2.md" }),
      deps,
    ) as Result<SyncHookJSONOutput, ResultError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContext(result.value)).toBeDefined();
  });
});

// ─── Shared defaultDeps ─────────────────────────────────────────────────────

import { defaultDeps } from "@hooks/hooks/ObligationStateMachines/CitationEnforcement.shared";

describe("CitationEnforcement shared defaultDeps", () => {
  it("writeFlag writes without throwing", () => {
    const tmpPath = `/tmp/pai-test-cite-flag-${Date.now()}.txt`;
    expect(() => defaultDeps.writeFlag(tmpPath)).not.toThrow();
    require("fs").unlinkSync(tmpPath);
  });

  it("readReminded returns empty array for missing file", () => {
    expect(defaultDeps.readReminded("/tmp/pai-nonexistent-cite-12345.json")).toEqual([]);
  });

  it("readReminded parses valid JSON array", () => {
    const tmpPath = `/tmp/pai-test-cite-rem-${Date.now()}.json`;
    require("fs").writeFileSync(tmpPath, JSON.stringify(["/src/a.ts"]));
    expect(defaultDeps.readReminded(tmpPath)).toEqual(["/src/a.ts"]);
    require("fs").unlinkSync(tmpPath);
  });

  it("writeReminded writes without throwing", () => {
    const tmpPath = `/tmp/pai-test-cite-wr-${Date.now()}.json`;
    expect(() => defaultDeps.writeReminded(tmpPath, ["/src/b.ts"])).not.toThrow();
    require("fs").unlinkSync(tmpPath);
  });

  it("stderr writes without throwing", () => {
    expect(() => defaultDeps.stderr("test")).not.toThrow();
  });
});
