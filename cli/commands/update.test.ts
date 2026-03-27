/**
 * Update command tests — source change detection, re-install, local mod check,
 * removed-upstream flagging, dry-run, and outputMode preservation.
 *
 * Uses InMemoryDeps from cli/types/deps.ts.
 * Tests the update function from cli/commands/update.ts.
 */

import { describe, it, expect } from "bun:test";
import { update } from "@hooks/cli/commands/update";
import { install } from "@hooks/cli/commands/install";
import type { ParsedArgs } from "@hooks/cli/core/args";
import { InMemoryDeps } from "@hooks/cli/types/deps";
import type { Lockfile } from "@hooks/cli/types/lockfile";
import { PaihErrorCode } from "@hooks/cli/core/error";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeSourceRepo(): Record<string, string> {
  return {
    "/source/hooks/CodingStandards/group.json": JSON.stringify({
      name: "CodingStandards",
      description: "TypeScript quality enforcement hooks",
      hooks: ["TypeStrictness"],
      sharedFiles: [],
    }),
    "/source/hooks/CodingStandards/TypeStrictness/hook.json": JSON.stringify({
      name: "TypeStrictness",
      group: "CodingStandards",
      event: "PreToolUse",
      description: "Enforces strict TypeScript",
      schemaVersion: 1,
      deps: { core: ["result"], lib: [], adapters: [], shared: false },
      tags: [],
      presets: [],
    }),
    "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts":
      '// TypeStrictness hook v1\nexport default {};\n',
    "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts":
      '// TypeStrictness contract\nexport default {};\n',
    "/source/core/result.ts": '// core result module\nexport const ok = true;\n',
    "/source/presets.json": JSON.stringify({}),
    "/project/.claude/settings.json": "{}",
  };
}

function installArgs(names: string[]): ParsedArgs {
  return { command: "install", names, flags: { to: "/project" } };
}

function updateArgs(flags: Record<string, boolean | string> = {}): ParsedArgs {
  return { command: "update", names: [], flags: { in: "/project", ...flags } };
}

/** Install hooks then return deps for further testing. */
function setupInstalled(): InMemoryDeps {
  const deps = new InMemoryDeps(makeSourceRepo(), "/source");
  const result = install(installArgs(["TypeStrictness"]), deps, "/source");
  expect(result.ok).toBe(true);
  return deps;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("update command", () => {
  it("source unchanged → 'All hooks up to date'", () => {
    const deps = setupInstalled();
    const result = update(updateArgs(), deps, "/source");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("All hooks up to date");
    }
  });

  it("one hook changed → only that hook re-installed", () => {
    const deps = setupInstalled();

    // Modify source file (simulates upstream change)
    deps.addFile(
      "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      '// TypeStrictness hook v2 — UPDATED\nexport default {};\n',
    );

    const result = update(updateArgs(), deps, "/source");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("Updated 1 hook");
      expect(result.value).toContain("TypeStrictness");
    }

    // Verify the new content was copied
    const files = deps.getFiles();
    const content = files.get("/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts");
    expect(content).toContain("v2 — UPDATED");

    // Verify lockfile updated
    const lockContent = files.get("/project/.claude/hooks/paih.lock.json")!;
    const lock: Lockfile = JSON.parse(lockContent);
    expect(lock.hooks[0].name).toBe("TypeStrictness");
  });

  it("hook removed from source → 'removed upstream' message", () => {
    const deps = setupInstalled();

    // Remove source hook file (simulates upstream removal)
    deps.deleteFile("/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts");

    const result = update(updateArgs(), deps, "/source");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("Removed upstream");
      expect(result.value).toContain("TypeStrictness");
    }

    // Installed file should NOT be auto-deleted
    const files = deps.getFiles();
    expect(files.has("/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts")).toBe(true);
  });

  it("local mod without --force → abort", () => {
    const deps = setupInstalled();

    // Modify source (so update wants to re-install)
    deps.addFile(
      "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      '// TypeStrictness hook v2\nexport default {};\n',
    );

    // Also modify local installed copy
    deps.addFile(
      "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      '// LOCALLY MODIFIED\n',
    );

    const result = update(updateArgs(), deps, "/source");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.FileModified);
    }
  });

  it("local mod with --force → overwritten", () => {
    const deps = setupInstalled();

    // Modify source
    deps.addFile(
      "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      '// TypeStrictness hook v2\nexport default {};\n',
    );

    // Modify local copy
    deps.addFile(
      "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      '// LOCALLY MODIFIED\n',
    );

    const result = update(updateArgs({ force: true }), deps, "/source");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("Updated 1 hook");
    }
  });

  it("--dry-run → change list, nothing touched", () => {
    const deps = setupInstalled();

    // Modify source
    deps.addFile(
      "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      '// TypeStrictness hook v2\nexport default {};\n',
    );

    const originalContent = deps.getFiles().get(
      "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
    );

    const result = update(updateArgs({ dryRun: true }), deps, "/source");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("Dry run");
      expect(result.value).toContain("TypeStrictness");
    }

    // File should not have been changed
    const currentContent = deps.getFiles().get(
      "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
    );
    expect(currentContent).toBe(originalContent);
  });

  it("returns LOCK_MISSING when no lockfile exists", () => {
    const deps = new InMemoryDeps({
      "/project/.claude/settings.json": "{}",
    }, "/project");

    const result = update(updateArgs(), deps, "/source");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.LockMissing);
    }
  });

  it("outputMode preserved on re-install", () => {
    const deps = setupInstalled();

    // Read lockfile and verify outputMode is preserved
    const lockBefore = JSON.parse(
      deps.getFiles().get("/project/.claude/hooks/paih.lock.json")!,
    ) as Lockfile;
    const originalMode = lockBefore.outputMode;

    // Modify source to trigger update
    deps.addFile(
      "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      '// TypeStrictness hook v2\nexport default {};\n',
    );

    const result = update(updateArgs(), deps, "/source");
    expect(result.ok).toBe(true);

    const lockAfter = JSON.parse(
      deps.getFiles().get("/project/.claude/hooks/paih.lock.json")!,
    ) as Lockfile;
    expect(lockAfter.outputMode).toBe(originalMode);
  });
});
