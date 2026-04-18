/**
 * Uninstall command tests — hook-level, group-level, modification detection,
 * shared file ref-counting, pai-hooks/ cleanup, dry-run, and idempotency.
 *
 * Uses InMemoryDeps from cli/types/deps.ts.
 * Tests the uninstall function from cli/commands/uninstall.ts.
 */

import { describe, expect, it } from "bun:test";
import { install } from "@hooks/cli/commands/install";
import { uninstall } from "@hooks/cli/commands/uninstall";
import type { ParsedArgs } from "@hooks/cli/core/args";
import { PaihErrorCode } from "@hooks/cli/core/error";
import type { SettingsJson } from "@hooks/cli/core/settings";
import { InMemoryDeps } from "@hooks/cli/types/deps";
import type { Lockfile } from "@hooks/cli/types/lockfile";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeSourceRepo(): Record<string, string> {
  return {
    "/source/hooks/CodingStandards/group.json": JSON.stringify({
      name: "CodingStandards",
      description: "TypeScript quality enforcement hooks",
      hooks: ["TypeStrictness", "BashWriteGuard"],
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
      "// TypeStrictness hook\nexport default {};\n",
    "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts":
      "// TypeStrictness contract\nexport default {};\n",
    "/source/hooks/CodingStandards/BashWriteGuard/hook.json": JSON.stringify({
      name: "BashWriteGuard",
      group: "CodingStandards",
      event: "PreToolUse",
      description: "Guards bash writes",
      schemaVersion: 1,
      deps: { core: ["result"], lib: [], adapters: [], shared: false },
      tags: [],
      presets: [],
    }),
    "/source/hooks/CodingStandards/BashWriteGuard/BashWriteGuard.hook.ts":
      "// BashWriteGuard hook\nexport default {};\n",
    "/source/hooks/CodingStandards/BashWriteGuard/BashWriteGuard.contract.ts":
      "// BashWriteGuard contract\nexport default {};\n",
    "/source/core/result.ts": "// core result module\nexport const ok = true;\n",
    "/source/presets.json": JSON.stringify({}),
    "/project/.claude/settings.json": "{}",
  };
}

/**
 * Source repo with shared deps for ref-counting tests.
 * SharedGroup has two hooks: HookA (uses shared.ts) and HookC (no shared).
 * Only HookA declares shared deps, so the resolver won't detect a cycle.
 */
function makeSharedDepsRepo(): Record<string, string> {
  return {
    "/source/hooks/SharedGroup/group.json": JSON.stringify({
      name: "SharedGroup",
      description: "Group with shared deps",
      hooks: ["HookA", "HookC"],
      sharedFiles: ["shared.ts"],
    }),
    "/source/hooks/SharedGroup/shared.ts": "// shared module\nexport const shared = true;\n",
    "/source/hooks/SharedGroup/HookA/hook.json": JSON.stringify({
      name: "HookA",
      group: "SharedGroup",
      event: "PreToolUse",
      description: "Hook A with shared dep",
      schemaVersion: 1,
      tags: [],
      presets: [],
    }),
    "/source/hooks/SharedGroup/HookA/HookA.contract.ts":
      'import { ok } from "@hooks/core/result";\nimport { shared } from "@hooks/hooks/SharedGroup/shared";\nexport const HookA = { name: "HookA", event: "PreToolUse" };\n',
    "/source/hooks/SharedGroup/HookA/HookA.hook.ts": "// HookA hook\nexport default {};\n",
    "/source/hooks/SharedGroup/HookC/hook.json": JSON.stringify({
      name: "HookC",
      group: "SharedGroup",
      event: "PreToolUse",
      description: "Hook C without shared dep",
      schemaVersion: 1,
      tags: [],
      presets: [],
    }),
    "/source/hooks/SharedGroup/HookC/HookC.contract.ts":
      'import { ok } from "@hooks/core/result";\nexport const HookC = { name: "HookC", event: "PreToolUse" };\n',
    "/source/hooks/SharedGroup/HookC/HookC.hook.ts": "// HookC hook\nexport default {};\n",
    "/source/core/result.ts": "// core result module\nexport const ok = true;\n",
    "/source/presets.json": JSON.stringify({}),
    "/project/.claude/settings.json": "{}",
  };
}

function installArgs(names: string[]): ParsedArgs {
  return { command: "install", names, flags: { to: "/project" } };
}

function uninstallArgs(names: string[], flags: Record<string, boolean | string> = {}): ParsedArgs {
  return { command: "uninstall", names, flags: { from: "/project", ...flags } };
}

/** Install hooks then return the deps for further testing. */
function setupInstalled(names: string[]): InMemoryDeps {
  const deps = new InMemoryDeps(makeSourceRepo(), "/source");
  const result = install(installArgs(names), deps, "/source");
  expect(result.ok).toBe(true);
  return deps;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("uninstall command", () => {
  it("uninstalls a single hook — files removed, settings cleaned, lockfile updated", () => {
    const deps = setupInstalled(["TypeStrictness"]);
    const result = uninstall(uninstallArgs(["TypeStrictness"]), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    const files = deps.getFiles();

    // Hook files removed
    expect(
      files.has(
        "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      ),
    ).toBe(false);
    expect(
      files.has(
        "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts",
      ),
    ).toBe(false);

    // Settings cleaned
    const settingsContent = files.get("/project/.claude/settings.json")!;
    const settings: SettingsJson = JSON.parse(settingsContent);
    const commands =
      settings.hooks?.PreToolUse?.flatMap((g) => g.hooks.map((h) => h.command)) ?? [];
    expect(commands.filter((c) => c.includes("TypeStrictness"))).toHaveLength(0);

    // Lockfile updated
    const lockContent = files.get("/project/.claude/hooks/pai-hooks/paih.lock.json")!;
    const lock: Lockfile = JSON.parse(lockContent);
    expect(lock.hooks.filter((h) => h.name === "TypeStrictness")).toHaveLength(0);
  });

  it("uninstalls a group — all group hooks removed", () => {
    const deps = setupInstalled(["CodingStandards"]);
    const result = uninstall(uninstallArgs(["CodingStandards"]), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    const files = deps.getFiles();

    // Both hooks removed
    expect(
      files.has(
        "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      ),
    ).toBe(false);
    expect(
      files.has(
        "/project/.claude/hooks/pai-hooks/CodingStandards/BashWriteGuard/BashWriteGuard.hook.ts",
      ),
    ).toBe(false);

    // Lockfile empty
    const lockContent = files.get("/project/.claude/hooks/pai-hooks/paih.lock.json")!;
    const lock: Lockfile = JSON.parse(lockContent);
    expect(lock.hooks).toHaveLength(0);
  });

  it("modified file without --force → abort", () => {
    const deps = setupInstalled(["TypeStrictness"]);

    // Modify an installed file
    deps.addFile(
      "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      "// MODIFIED by user\n",
    );

    const result = uninstall(uninstallArgs(["TypeStrictness"]), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.FileModified);
    }
  });

  it("modified file with --force → deleted", () => {
    const deps = setupInstalled(["TypeStrictness"]);

    // Modify an installed file
    deps.addFile(
      "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      "// MODIFIED by user\n",
    );

    const result = uninstall(uninstallArgs(["TypeStrictness"], { force: true }), deps);

    expect(result.ok).toBe(true);
    const files = deps.getFiles();
    expect(
      files.has(
        "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      ),
    ).toBe(false);
  });

  it("--dry-run → plan printed, nothing touched", () => {
    const deps = setupInstalled(["TypeStrictness"]);
    const result = uninstall(uninstallArgs(["TypeStrictness"], { dryRun: true }), deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("Dry run");
      expect(result.value).toContain("TypeStrictness");
    }

    // Files still exist
    const files = deps.getFiles();
    expect(
      files.has(
        "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      ),
    ).toBe(true);
  });

  it("shared.ts ref-counting — removed when group empty", () => {
    const deps = new InMemoryDeps(makeSharedDepsRepo(), "/source");
    const installResult = install(installArgs(["SharedGroup"]), deps, "/source");
    expect(installResult.ok).toBe(true);

    // Uninstall both hooks in the group
    const result = uninstall(uninstallArgs(["SharedGroup"]), deps);
    expect(result.ok).toBe(true);

    const files = deps.getFiles();
    // shared.ts should be removed since no hooks reference it
    expect(files.has("/project/.claude/hooks/pai-hooks/SharedGroup/shared.ts")).toBe(false);
  });

  it("shared.ts ref-counting — kept when hooks remain", () => {
    const deps = new InMemoryDeps(makeSharedDepsRepo(), "/source");
    const installResult = install(installArgs(["SharedGroup"]), deps, "/source");
    expect(installResult.ok).toBe(true);

    // Uninstall only HookC (which has no shared dep); HookA still references shared.ts
    const result = uninstall(uninstallArgs(["HookC"]), deps);
    expect(result.ok).toBe(true);

    const files = deps.getFiles();
    // shared.ts should still exist since HookA still references it
    expect(files.has("/project/.claude/hooks/pai-hooks/SharedGroup/shared.ts")).toBe(true);
  });

  it("all hooks removed → pai-hooks/ cleaned", () => {
    const deps = setupInstalled(["TypeStrictness"]);

    const result = uninstall(uninstallArgs(["TypeStrictness"]), deps);
    expect(result.ok).toBe(true);

    const files = deps.getFiles();
    // pai-hooks/ directory contents should be removed
    expect(files.has("/project/.claude/hooks/pai-hooks/core/result.ts")).toBe(false);
  });

  it("returns LOCK_MISSING when no lockfile exists", () => {
    const deps = new InMemoryDeps(
      {
        "/project/.claude/settings.json": "{}",
      },
      "/project",
    );

    const result = uninstall(uninstallArgs(["TypeStrictness"]), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.LockMissing);
    }
  });

  it("returns INVALID_ARGS when no names provided", () => {
    const deps = new InMemoryDeps({}, "/project");
    const result = uninstall(uninstallArgs([]), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.InvalidArgs);
    }
  });

  it("idempotent: file in lockfile but missing on disk → warn, continue", () => {
    const deps = setupInstalled(["TypeStrictness"]);

    // Manually delete a file that the lockfile references
    deps.deleteFile(
      "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
    );

    // Should still succeed (idempotent)
    const result = uninstall(uninstallArgs(["TypeStrictness"], { force: true }), deps);
    expect(result.ok).toBe(true);
  });
});
