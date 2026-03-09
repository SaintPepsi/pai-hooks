import { describe, it, expect, beforeEach } from "bun:test";
import {
  CitationTracker,
  CitationEnforcement,
  type CitationEnforcementDeps,
} from "@hooks/contracts/CitationEnforcement";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import type { Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";

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

  it("writes flag file on execute", () => {
    let writtenPath = "";
    const deps = makeDeps({
      writeFlag: (path: string) => { writtenPath = path; },
    });
    const result = CitationTracker.execute(makeToolInput("WebSearch"), deps) as Result<ContinueOutput, PaiError>;

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
    expect(CitationEnforcement.accepts(makeToolInput("Write", { file_path: "/tmp/test.md" }))).toBe(true);
  });

  it("accepts Edit tool", () => {
    expect(CitationEnforcement.accepts(makeToolInput("Edit", { file_path: "/tmp/test.md" }))).toBe(true);
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
    ) as Result<ContinueOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.additionalContext).toBeUndefined();
  });

  it("returns citation reminder when research flag exists", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readReminded: () => [],
    });
    const result = CitationEnforcement.execute(
      makeToolInput("Write", { file_path: "/tmp/article.md" }),
      deps,
    ) as Result<ContinueOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.additionalContext).toBeDefined();
    expect(result.value.additionalContext).toContain("citation");
  });

  it("only reminds once per file path", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readReminded: () => ["/tmp/article.md"],
    });
    const result = CitationEnforcement.execute(
      makeToolInput("Write", { file_path: "/tmp/article.md" }),
      deps,
    ) as Result<ContinueOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.additionalContext).toBeUndefined();
  });

  it("writes reminded file path after reminding", () => {
    let writtenPaths: string[] = [];
    const deps = makeDeps({
      fileExists: () => true,
      readReminded: () => [],
      writeReminded: (_path: string, files: string[]) => { writtenPaths = files; },
    });
    CitationEnforcement.execute(
      makeToolInput("Write", { file_path: "/tmp/new-article.md" }),
      deps,
    );

    expect(writtenPaths).toContain("/tmp/new-article.md");
  });

  it("reminds for different file paths", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readReminded: () => ["/tmp/article1.md"],
    });
    const result = CitationEnforcement.execute(
      makeToolInput("Write", { file_path: "/tmp/article2.md" }),
      deps,
    ) as Result<ContinueOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.additionalContext).toBeDefined();
  });
});
