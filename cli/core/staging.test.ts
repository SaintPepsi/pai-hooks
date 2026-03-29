/**
 * Staging tests — verifies stageHook produces absolute paths in commandString.
 *
 * Regression test for issue #32: project-level hooks error on every tool call
 * after EnterWorktree because Claude Code resolves relative paths against the
 * wrong root in a worktree context. The fix is to emit absolute paths.
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

describe("stageHook: commandString uses absolute path (issue #32)", () => {
  it("emits absolute path when claudeDir is absolute", () => {
    const claudeDir = "/Users/hogers/Projects/koord/.claude";
    const deps = makeMinimalDeps(claudeDir);
    const ctxResult = createStaging(claudeDir, deps);
    expect(ctxResult.ok).toBe(true);
    if (!ctxResult.ok) return;

    const hookDef = makeHookDef(
      "GitSafety",
      "MergeGate",
      "/source/hooks/GitSafety/MergeGate",
    );
    const result = stageHook(ctxResult.value, hookDef, [], deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { commandString } = result.value;
    expect(commandString).toBe(
      "bun /Users/hogers/Projects/koord/.claude/hooks/pai-hooks/GitSafety/MergeGate/MergeGate.hook.ts",
    );
    // Must not start with a relative path
    expect(commandString.startsWith("bun /")).toBe(true);
    expect(commandString).not.toContain("bun .claude/");
  });

  it("emits absolute path for a different project root", () => {
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
    if (!result.ok) return;

    expect(result.value.commandString).toBe(
      "bun /home/user/myproject/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
    );
  });

  it("command path is stable across worktree directory changes", () => {
    // Simulates running from a worktree: cwd differs from claudeDir's project root.
    // The commandString must always embed the claudeDir absolute path, not the cwd.
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

    const hookDef = makeHookDef(
      "GitSafety",
      "MergeGate",
      "/source/hooks/GitSafety/MergeGate",
    );
    const result = stageHook(ctxResult.value, hookDef, [], deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The command must embed the claudeDir path, not the cwd
    expect(result.value.commandString).toBe(
      "bun /Users/hogers/Projects/koord/.claude/hooks/pai-hooks/GitSafety/MergeGate/MergeGate.hook.ts",
    );
    expect(result.value.commandString).not.toContain(worktreeCwd);
  });
});
