import { describe, expect, it } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { getInjectedContextFor } from "@hooks/lib/test-helpers";
import { BranchAwareness, type BranchAwarenessDeps } from "./BranchAwareness.contract";

function makeDeps(overrides: Partial<BranchAwarenessDeps> = {}): BranchAwarenessDeps {
  return {
    getBranch: () => "feature/my-branch",
    isSubagent: () => false,
    stderr: () => {},
    ...overrides,
  };
}

function makeInput(): SessionStartInput {
  return { session_id: "test-session-123" };
}

const getInjectedContext = (output: SyncHookJSONOutput) =>
  getInjectedContextFor(output, "SessionStart");

describe("BranchAwareness", () => {
  it("has correct name and event", () => {
    expect(BranchAwareness.name).toBe("BranchAwareness");
    expect(BranchAwareness.event).toBe("SessionStart");
  });

  it("accepts all SessionStart inputs", () => {
    expect(BranchAwareness.accepts(makeInput())).toBe(true);
  });

  it("returns context injection with branch name on success", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = BranchAwareness.execute(makeInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("main");
  });

  it("includes branch name in context content", () => {
    const deps = makeDeps({ getBranch: () => "feature/auth-refactor" });
    const result = BranchAwareness.execute(makeInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("feature/auth-refactor");
  });

  it("returns silent ({}) for subagents", () => {
    const deps = makeDeps({ isSubagent: () => true });
    const result = BranchAwareness.execute(makeInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getInjectedContext(result.value)).toBeUndefined();
    expect(result.value.continue).toBeUndefined();
  });

  it("returns silent ({}) when git command fails", () => {
    const deps = makeDeps({ getBranch: () => null });
    const result = BranchAwareness.execute(makeInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getInjectedContext(result.value)).toBeUndefined();
  });

  it("returns silent ({}) when branch is empty string", () => {
    const deps = makeDeps({ getBranch: () => "" });
    const result = BranchAwareness.execute(makeInput(), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(getInjectedContext(result.value)).toBeUndefined();
  });

  it("logs skip message when branch is null", () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      getBranch: () => null,
      stderr: (msg: string) => {
        stderrMessages.push(msg);
      },
    });
    BranchAwareness.execute(makeInput(), deps);
    expect(stderrMessages.some((m) => m.includes("Could not determine"))).toBe(true);
  });

  it("logs branch name to stderr on success", () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      getBranch: () => "develop",
      stderr: (msg: string) => {
        stderrMessages.push(msg);
      },
    });
    BranchAwareness.execute(makeInput(), deps);
    expect(stderrMessages.some((m) => m.includes("develop"))).toBe(true);
  });
});

describe("BranchAwareness defaultDeps", () => {
  it("defaultDeps.getBranch returns a string or null", () => {
    const result = BranchAwareness.defaultDeps.getBranch();
    // In a git repo it returns a string, otherwise null
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("defaultDeps.isSubagent returns a boolean", () => {
    const result = BranchAwareness.defaultDeps.isSubagent();
    expect(typeof result).toBe("boolean");
  });

  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => BranchAwareness.defaultDeps.stderr("test message")).not.toThrow();
  });
});
