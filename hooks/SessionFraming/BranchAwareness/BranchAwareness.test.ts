import { describe, it, expect } from "bun:test";
import { BranchAwareness, type BranchAwarenessDeps } from "@hooks/contracts/BranchAwareness";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import type { ContextOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import type { Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";

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

describe("BranchAwareness", () => {
  it("has correct name and event", () => {
    expect(BranchAwareness.name).toBe("BranchAwareness");
    expect(BranchAwareness.event).toBe("SessionStart");
  });

  it("accepts all SessionStart inputs", () => {
    expect(BranchAwareness.accepts(makeInput())).toBe(true);
  });

  it("returns ContextOutput with branch name on success", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = BranchAwareness.execute(makeInput(), deps) as Result<ContextOutput | SilentOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("context");
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("main");
  });

  it("includes branch name in context content", () => {
    const deps = makeDeps({ getBranch: () => "feature/auth-refactor" });
    const result = BranchAwareness.execute(makeInput(), deps) as Result<ContextOutput | SilentOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("context");
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("feature/auth-refactor");
  });

  it("returns SilentOutput for subagents", () => {
    const deps = makeDeps({ isSubagent: () => true });
    const result = BranchAwareness.execute(makeInput(), deps) as Result<ContextOutput | SilentOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("returns SilentOutput when git command fails", () => {
    const deps = makeDeps({ getBranch: () => null });
    const result = BranchAwareness.execute(makeInput(), deps) as Result<ContextOutput | SilentOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("returns SilentOutput when branch is empty string", () => {
    const deps = makeDeps({ getBranch: () => "" });
    const result = BranchAwareness.execute(makeInput(), deps) as Result<ContextOutput | SilentOutput, PaiError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("logs skip message when branch is null", () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      getBranch: () => null,
      stderr: (msg: string) => { stderrMessages.push(msg); },
    });
    BranchAwareness.execute(makeInput(), deps);
    expect(stderrMessages.some(m => m.includes("Could not determine"))).toBe(true);
  });

  it("logs branch name to stderr on success", () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      getBranch: () => "develop",
      stderr: (msg: string) => { stderrMessages.push(msg); },
    });
    BranchAwareness.execute(makeInput(), deps);
    expect(stderrMessages.some(m => m.includes("develop"))).toBe(true);
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
