/**
 * Staging tests — verifies stageHook produces $CLAUDE_PROJECT_DIR paths in commandString.
 *
 * Regression test for issue #32: project-level hooks error on every tool call
 * after EnterWorktree because Claude Code resolves relative paths against the
 * wrong root in a worktree context. The fix is to use $CLAUDE_PROJECT_DIR which
 * Claude Code resolves at runtime to the correct project root.
 */

import { describe, expect, it } from "bun:test";
import { createStaging, stageHook } from "@hooks/cli/core/staging";
import { InMemoryDeps } from "@hooks/cli/types/deps";
import type { HookDef } from "@hooks/cli/types/resolved";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeHookDef(group: string, name: string, sourceDir: string): HookDef {
  return {
    manifest: {
      name,
      group,
      event: "PreToolUse",
      description: "Test hook",
      schemaVersion: 1,
      tags: [],
      presets: [],
    },
    contractPath: `${sourceDir}/${name}.contract.ts`,
    manifestPath: `${sourceDir}/hook.json`,
    sourceDir,
  };
}

function makeMinimalDeps(claudeDir: string): InMemoryDeps {
  const hookSourceDir = "/source/hooks/GitSafety/MergeGate";
  return new InMemoryDeps(
    {
      [`${hookSourceDir}/MergeGate.hook.ts`]: "// hook\n",
      [`${hookSourceDir}/MergeGate.contract.ts`]: "// contract\n",
      [`${claudeDir}/settings.json`]: "{}",
    },
    "/source",
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("stageHook: commandString uses $CLAUDE_PROJECT_DIR (issue #32)", () => {
  it("emits $CLAUDE_PROJECT_DIR path for worktree compatibility", () => {
    const claudeDir = "/Users/hogers/Projects/koord/.claude";
    const deps = makeMinimalDeps(claudeDir);
    const ctxResult = createStaging(claudeDir, deps);
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;

    const hookDef = makeHookDef("GitSafety", "MergeGate", "/source/hooks/GitSafety/MergeGate");
    const result = stageHook(ctxResult.value, hookDef, [], deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    const { commandString } = result.value;
    expect(commandString).toBe(
      'bun "$CLAUDE_PROJECT_DIR"/.claude/hooks/pai-hooks/GitSafety/MergeGate/MergeGate.hook.ts',
    );
    // Must use $CLAUDE_PROJECT_DIR, not a relative path
    expect(commandString).toContain("$CLAUDE_PROJECT_DIR");
    expect(commandString).not.toContain("bun .claude/");
  });

  it("emits $CLAUDE_PROJECT_DIR regardless of claudeDir value", () => {
    const claudeDir = "/home/user/myproject/.claude";
    const deps = makeMinimalDeps(claudeDir);
    const ctxResult = createStaging(claudeDir, deps);
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;

    const hookDef = makeHookDef(
      "CodingStandards",
      "TypeStrictness",
      "/source/hooks/CodingStandards/TypeStrictness",
    );
    const deps2 = new InMemoryDeps(
      {
        "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts": "// hook\n",
        "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts": "// contract\n",
        [`${claudeDir}/settings.json`]: "{}",
      },
      "/source",
    );
    const ctx2Result = createStaging(claudeDir, deps2);
    expect(ctx2Result.ok).toBe(true);
    if (!ctx2Result.ok) return;

    const result = stageHook(ctx2Result.value, hookDef, [], deps2);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    expect(result.value.commandString).toBe(
      'bun "$CLAUDE_PROJECT_DIR"/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts',
    );
  });

  it("command path is stable across worktree directory changes", () => {
    // Simulates running from a worktree: cwd differs from claudeDir's project root.
    // $CLAUDE_PROJECT_DIR is resolved at runtime by Claude Code, so the command
    // is stable regardless of what cwd was at install time.
    const claudeDir = "/Users/hogers/Projects/koord/.claude";
    const worktreeCwd = "/Users/hogers/Projects/koord/.claude/worktrees/my-feature";
    const deps = new InMemoryDeps(
      {
        "/source/hooks/GitSafety/MergeGate/MergeGate.hook.ts": "// hook\n",
        "/source/hooks/GitSafety/MergeGate/MergeGate.contract.ts": "// contract\n",
        [`${claudeDir}/settings.json`]: "{}",
      },
      worktreeCwd, // cwd is a worktree subdir — NOT the project root
    );

    const ctxResult = createStaging(claudeDir, deps);
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;

    const hookDef = makeHookDef("GitSafety", "MergeGate", "/source/hooks/GitSafety/MergeGate");
    const result = stageHook(ctxResult.value, hookDef, [], deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    // The command uses $CLAUDE_PROJECT_DIR — not hardcoded claudeDir, not cwd
    expect(result.value.commandString).toBe(
      'bun "$CLAUDE_PROJECT_DIR"/.claude/hooks/pai-hooks/GitSafety/MergeGate/MergeGate.hook.ts',
    );
    expect(result.value.commandString).not.toContain(worktreeCwd);
    expect(result.value.commandString).not.toContain(claudeDir);
  });
});
