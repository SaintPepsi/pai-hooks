import { describe, expect, it } from "bun:test";
import type { PaiError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { BlockOutput, ContinueOutput } from "@hooks/core/types/hook-outputs";
import {
  ProtectedBranchGuard,
  type ProtectedBranchGuardDeps,
} from "@hooks/hooks/GitSafety/ProtectedBranchGuard/ProtectedBranchGuard.contract";

function makeDeps(overrides: Partial<ProtectedBranchGuardDeps> = {}): ProtectedBranchGuardDeps {
  return {
    getBranch: () => "main",
    getCwd: () => "/Users/test/my-project",
    getExemptDirs: () => [],
    stderr: () => {},
    ...overrides,
  };
}

function makeInput(command: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Bash",
    tool_input: { command },
  };
}

type GuardResult = Result<ContinueOutput | BlockOutput, PaiError>;

describe("ProtectedBranchGuard", () => {
  it("has correct name and event", () => {
    expect(ProtectedBranchGuard.name).toBe("ProtectedBranchGuard");
    expect(ProtectedBranchGuard.event).toBe("PreToolUse");
  });

  it("accepts Bash tool inputs", () => {
    expect(ProtectedBranchGuard.accepts(makeInput("git commit -m 'test'"))).toBe(true);
  });

  it("rejects non-Bash tool inputs", () => {
    const input: ToolHookInput = {
      session_id: "test-sess",
      tool_name: "Edit",
      tool_input: { file_path: "/test.ts", old_string: "a", new_string: "b" },
    };
    expect(ProtectedBranchGuard.accepts(input)).toBe(false);
  });

  // ── Blocks on main ──

  it("blocks git commit on main", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = ProtectedBranchGuard.execute(
      makeInput("git commit -m 'feat: add thing'"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("blocks git commit --amend on main", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = ProtectedBranchGuard.execute(
      makeInput("git commit --amend"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  // ── Blocks on master ──

  it("blocks git commit on master", () => {
    const deps = makeDeps({ getBranch: () => "master" });
    const result = ProtectedBranchGuard.execute(
      makeInput("git commit -m 'fix: thing'"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  // ── Blocks git push on protected branches ──

  it("blocks git push on main", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = ProtectedBranchGuard.execute(
      makeInput("git push origin main"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("blocks git push on master", () => {
    const deps = makeDeps({ getBranch: () => "master" });
    const result = ProtectedBranchGuard.execute(makeInput("git push"), deps) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  // ── Blocks git merge on protected branches ──

  it("blocks git merge on main", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = ProtectedBranchGuard.execute(
      makeInput("git merge feature/auth"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  // ── Allows on feature branches ──

  it("allows git commit on feature branch", () => {
    const deps = makeDeps({ getBranch: () => "feature/my-feature" });
    const result = ProtectedBranchGuard.execute(
      makeInput("git commit -m 'feat: thing'"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("allows git push on feature branch", () => {
    const deps = makeDeps({ getBranch: () => "feature/auth" });
    const result = ProtectedBranchGuard.execute(
      makeInput("git push origin feature/auth"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  // ── Allows non-git commands ──

  it("allows non-git bash commands without checking branch", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = ProtectedBranchGuard.execute(makeInput("ls -la"), deps) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("allows git status on main (read-only)", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = ProtectedBranchGuard.execute(makeInput("git status"), deps) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("allows git log on main (read-only)", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = ProtectedBranchGuard.execute(
      makeInput("git log --oneline -10"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("allows git diff on main (read-only)", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = ProtectedBranchGuard.execute(makeInput("git diff HEAD~1"), deps) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("allows git branch (listing/creation) on main", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = ProtectedBranchGuard.execute(
      makeInput("git branch feature/new-thing"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("allows git checkout on main (switching away)", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = ProtectedBranchGuard.execute(
      makeInput("git checkout -b feature/new"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("allows git stash on main", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = ProtectedBranchGuard.execute(makeInput("git stash"), deps) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  // ── Exempts ~/.claude ──

  it("allows git commit on main when in ~/.claude directory", () => {
    const deps = makeDeps({
      getBranch: () => "main",
      getCwd: () => "/Users/test/.claude",
    });
    const result = ProtectedBranchGuard.execute(
      makeInput("git commit -m 'auto-sync'"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("allows git push on main when in ~/.claude subdirectory", () => {
    const deps = makeDeps({
      getBranch: () => "main",
      getCwd: () => "/Users/test/.claude/pai-hooks",
    });
    const result = ProtectedBranchGuard.execute(
      makeInput("git push origin main"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  // ── Exempts directories from settings.json (via getExemptDirs) ──

  it("allows git commit on main when CWD matches a user-configured exempt dir", () => {
    const deps = makeDeps({
      getBranch: () => "main",
      getCwd: () => "/Users/test/Documents/repos/bd-knowledge-management",
      getExemptDirs: () => ["bd-knowledge-management"],
    });
    const result = ProtectedBranchGuard.execute(
      makeInput("git commit -m 'feat: thing'"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("allows git push on main when CWD is a subdirectory of exempt dir", () => {
    const deps = makeDeps({
      getBranch: () => "main",
      getCwd: () => "/Users/test/repos/my-project/src/tools",
      getExemptDirs: () => ["my-project"],
    });
    const result = ProtectedBranchGuard.execute(
      makeInput("git push origin main"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("blocks when CWD does not match any exempt dir", () => {
    const deps = makeDeps({
      getBranch: () => "main",
      getCwd: () => "/Users/test/repos/other-project",
      getExemptDirs: () => ["bd-knowledge-management"],
    });
    const result = ProtectedBranchGuard.execute(
      makeInput("git commit -m 'test'"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("handles empty exemptDirs gracefully", () => {
    const deps = makeDeps({
      getBranch: () => "main",
      getCwd: () => "/Users/test/repos/some-project",
      getExemptDirs: () => [],
    });
    const result = ProtectedBranchGuard.execute(
      makeInput("git commit -m 'test'"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  // ── Edge cases ──

  it("allows when branch cannot be determined (fails open)", () => {
    const deps = makeDeps({ getBranch: () => null });
    const result = ProtectedBranchGuard.execute(
      makeInput("git commit -m 'test'"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("continue");
  });

  it("blocks git commit in chained command on main", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = ProtectedBranchGuard.execute(
      makeInput("git add -A && git commit -m 'test'"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
  });

  it("block reason includes branch name", () => {
    const deps = makeDeps({ getBranch: () => "main" });
    const result = ProtectedBranchGuard.execute(
      makeInput("git commit -m 'test'"),
      deps,
    ) as GuardResult;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("block");
    if (result.value.type !== "block") return;
    expect(result.value.reason).toContain("main");
  });

  it("logs block to stderr", () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      getBranch: () => "main",
      stderr: (msg: string) => {
        stderrMessages.push(msg);
      },
    });
    ProtectedBranchGuard.execute(makeInput("git commit -m 'test'"), deps);
    expect(stderrMessages.some((m) => m.includes("ProtectedBranchGuard"))).toBe(true);
  });
});

describe("ProtectedBranchGuard defaultDeps", () => {
  it("defaultDeps.getBranch returns a string or null", () => {
    const result = ProtectedBranchGuard.defaultDeps.getBranch();
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("defaultDeps.getCwd returns a string", () => {
    const result = ProtectedBranchGuard.defaultDeps.getCwd();
    expect(typeof result).toBe("string");
  });

  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => ProtectedBranchGuard.defaultDeps.stderr("test")).not.toThrow();
  });

  it("defaultDeps.getExemptDirs returns an array", () => {
    const result = ProtectedBranchGuard.defaultDeps.getExemptDirs();
    expect(Array.isArray(result)).toBe(true);
  });
});
