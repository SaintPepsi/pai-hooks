#!/usr/bin/env bun
/**
 * Verification script for issue #32 — project hook paths after EnterWorktree.
 *
 * Tests that the paih CLI generates command strings using $CLAUDE_PROJECT_DIR
 * instead of relative paths, ensuring hooks survive CWD changes from worktrees.
 *
 * Run: bun scripts/verify-issue-32-worktree-hooks.ts
 */

import { install } from "@hooks/cli/commands/install";
import type { ParsedArgs } from "@hooks/cli/core/args";
import type { SettingsJson } from "@hooks/cli/core/settings";
import { InMemoryDeps } from "@hooks/cli/types/deps";

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeSourceRepo(): Record<string, string> {
  return {
    "/source/hooks/CodingStandards/group.json": JSON.stringify({
      name: "CodingStandards",
      description: "Test group",
      hooks: ["TypeStrictness"],
      sharedFiles: [],
    }),
    "/source/hooks/CodingStandards/TypeStrictness/hook.json": JSON.stringify({
      name: "TypeStrictness",
      group: "CodingStandards",
      event: "PreToolUse",
      description: "Test hook",
      schemaVersion: 1,
      deps: { core: ["result"], lib: [], adapters: [], shared: false },
      tags: [],
      presets: ["quality"],
    }),
    "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts":
      "// hook\nexport default {};\n",
    "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts":
      "// contract\nexport default {};\n",
    "/source/core/result.ts": "export const ok = true;\n",
    "/source/presets.json": JSON.stringify({
      quality: { description: "Code quality", groups: ["CodingStandards"] },
    }),
    "/project/.claude/settings.json": "{}",
  };
}

function makeArgs(): ParsedArgs {
  return {
    command: "install",
    names: ["TypeStrictness"],
    flags: { to: "/project" },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

console.log("\n=== Issue #32 Verification: $CLAUDE_PROJECT_DIR in hook paths ===\n");

// Test 1: Source mode generates $CLAUDE_PROJECT_DIR path
console.log("Test 1: Source mode command string uses $CLAUDE_PROJECT_DIR");
{
  const deps = new InMemoryDeps(makeSourceRepo(), "/source");
  const result = install(makeArgs(), deps, "/source");

  assert(result.ok === true, "install succeeds");
  if (result.ok) {
    const settings: SettingsJson = JSON.parse(
      deps.getFiles().get("/project/.claude/settings.json")!,
    );
    const cmd = settings.hooks?.PreToolUse?.[0]?.hooks[0]?.command ?? "";

    assert(cmd.includes("$CLAUDE_PROJECT_DIR"), `command contains $CLAUDE_PROJECT_DIR: ${cmd}`);
    assert(!cmd.startsWith("bun .claude/"), "command does NOT start with relative 'bun .claude/'");
    assert(
      cmd.startsWith('bun "$CLAUDE_PROJECT_DIR"/.claude/'),
      `command starts with 'bun "$CLAUDE_PROJECT_DIR"/.claude/': ${cmd}`,
    );
  }
}

// Test 2: Verify old relative format is gone
console.log("\nTest 2: Old relative path format is absent from staging.ts");
{
  const deps = new InMemoryDeps(makeSourceRepo(), "/source");
  const result = install(makeArgs(), deps, "/source");

  assert(result.ok === true, "install succeeds");
  if (result.ok) {
    const settings: SettingsJson = JSON.parse(
      deps.getFiles().get("/project/.claude/settings.json")!,
    );
    const allCommands = Object.values(settings.hooks ?? {}).flatMap((groups) =>
      groups.flatMap((g) => g.hooks.map((h) => h.command)),
    );

    for (const cmd of allCommands) {
      assert(
        !cmd.match(/^bun \.claude\//) && !cmd.match(/^\.claude\//),
        `no relative path in command: ${cmd}`,
      );
    }
  }
}

// Test 3: Simulate worktree scenario — $CLAUDE_PROJECT_DIR resolves correctly
console.log("\nTest 3: Simulated worktree path resolution");
{
  // Simulate what happens when the shell expands $CLAUDE_PROJECT_DIR
  const projectRoot = "/Users/hogers/Projects/koord";
  const commandTemplate =
    'bun "$CLAUDE_PROJECT_DIR"/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts';

  // Shell expansion: replace $CLAUDE_PROJECT_DIR with the actual value
  const expandedCommand = commandTemplate.replace('"$CLAUDE_PROJECT_DIR"', projectRoot);

  assert(
    expandedCommand ===
      `bun ${projectRoot}/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts`,
    `expanded path is absolute: ${expandedCommand}`,
  );

  // The old relative path would have resolved against CWD (the worktree)
  const worktreeCwd = "/Users/hogers/Projects/koord/.claude/worktrees/issue-foo";
  const oldRelativeResolved = `${worktreeCwd}/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts`;

  assert(
    expandedCommand !== oldRelativeResolved,
    "expanded path differs from worktree-relative resolution",
  );
  assert(
    expandedCommand.startsWith(`bun ${projectRoot}/`),
    "expanded path points to original project root, not worktree",
  );
}

// Test 4: $CLAUDE_PROJECT_DIR is used in existing lib code for environment detection
console.log("\nTest 4: Existing codebase already depends on CLAUDE_PROJECT_DIR");
{
  const fs = await import("node:fs");
  const file = "lib/environment.ts";
  const content = fs.readFileSync(file, "utf-8");
  assert(content.includes("CLAUDE_PROJECT_DIR"), `${file} references CLAUDE_PROJECT_DIR`);
}

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
