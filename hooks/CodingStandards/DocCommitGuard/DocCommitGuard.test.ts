import { describe, expect, it } from "bun:test";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { BlockOutput, ContinueOutput } from "@hooks/core/types/hook-outputs";
import { DocCommitGuard, type DocCommitGuardDeps } from "./DocCommitGuard.contract";

function makeInput(command: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Bash",
    tool_input: { command },
  };
}

function makeDeps(overrides: Partial<DocCommitGuardDeps> = {}): DocCommitGuardDeps {
  return {
    stderr: () => {},
    fileExists: () => true,
    scanHookJsons: () => [],
    hooksDir: "/repo/hooks",
    ...overrides,
  };
}

function run(
  input: ToolHookInput,
  deps: DocCommitGuardDeps,
): Result<ContinueOutput | BlockOutput, ResultError> {
  return DocCommitGuard.execute(input, deps) as Result<ContinueOutput | BlockOutput, ResultError>;
}

describe("DocCommitGuard", () => {
  it("has correct name and event", () => {
    expect(DocCommitGuard.name).toBe("DocCommitGuard");
    expect(DocCommitGuard.event).toBe("PreToolUse");
  });

  // ─── accepts() ──────────────────────────────────────────────────────────

  it("rejects non-Bash tools", () => {
    const input: ToolHookInput = { session_id: "s", tool_name: "Edit", tool_input: {} };
    expect(DocCommitGuard.accepts(input)).toBe(false);
  });

  it("rejects Bash commands without git commit", () => {
    expect(DocCommitGuard.accepts(makeInput("git status"))).toBe(false);
    expect(DocCommitGuard.accepts(makeInput("git push"))).toBe(false);
    expect(DocCommitGuard.accepts(makeInput("ls -la"))).toBe(false);
    expect(DocCommitGuard.accepts(makeInput("bun test"))).toBe(false);
  });

  it("accepts git commit commands", () => {
    expect(DocCommitGuard.accepts(makeInput("git commit -m 'test'"))).toBe(true);
    expect(DocCommitGuard.accepts(makeInput("git commit --amend"))).toBe(true);
    expect(
      DocCommitGuard.accepts(makeInput("git commit -m \"$(cat <<'EOF'\nmessage\nEOF\n)\"")),
    ).toBe(true);
  });

  it("accepts chained commands containing git commit", () => {
    expect(DocCommitGuard.accepts(makeInput("git add . && git commit -m 'test'"))).toBe(true);
  });

  // ─── execute() — all docs present ──────────────────────────────────────

  it("continues when all hooks have doc.md and IDEA.md", () => {
    const deps = makeDeps({
      scanHookJsons: () => ["GitSafety/MergeGate/hook.json"],
      fileExists: () => true,
    });

    const r = run(makeInput("git commit -m 'test'"), deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe("continue");
  });

  it("continues when no hook.json files exist", () => {
    const deps = makeDeps({ scanHookJsons: () => [] });

    const r = run(makeInput("git commit -m 'test'"), deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe("continue");
  });

  // ─── execute() — missing docs ──────────────────────────────────────────

  it("blocks when a hook is missing doc.md", () => {
    const deps = makeDeps({
      scanHookJsons: () => ["GitSafety/MergeGate/hook.json"],
      fileExists: (path: string) => !path.endsWith("doc.md"),
    });

    const r = run(makeInput("git commit -m 'test'"), deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
      expect((r.value as BlockOutput).reason).toContain("doc.md");
    }
  });

  it("blocks when a hook is missing IDEA.md", () => {
    const deps = makeDeps({
      scanHookJsons: () => ["GitSafety/MergeGate/hook.json"],
      fileExists: (path: string) => !path.endsWith("IDEA.md"),
    });

    const r = run(makeInput("git commit -m 'test'"), deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
      expect((r.value as BlockOutput).reason).toContain("IDEA.md");
    }
  });

  it("lists all missing files in the block reason", () => {
    const deps = makeDeps({
      scanHookJsons: () => ["GitSafety/MergeGate/hook.json", "CodeQuality/Linter/hook.json"],
      fileExists: () => false,
    });

    const r = run(makeInput("git commit -m 'test'"), deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
      const reason = (r.value as BlockOutput).reason;
      expect(reason).toContain("MergeGate");
      expect(reason).toContain("Linter");
    }
  });

  it("handles multiple hooks — only blocks for ones missing docs", () => {
    const deps = makeDeps({
      scanHookJsons: () => ["GroupA/HookOk/hook.json", "GroupB/HookBad/hook.json"],
      fileExists: (path: string) => {
        // HookOk has all docs, HookBad has none
        return path.includes("HookOk");
      },
    });

    const r = run(makeInput("git commit -m 'test'"), deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
      const reason = (r.value as BlockOutput).reason;
      expect(reason).toContain("HookBad");
      expect(reason).not.toContain("HookOk");
    }
  });
});
