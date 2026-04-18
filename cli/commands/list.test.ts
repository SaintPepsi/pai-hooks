/**
 * list command tests — installed hook display and status checking.
 *
 * Uses InMemoryDeps from cli/types/deps.ts for filesystem simulation.
 * Lockfile format follows cli/types/lockfile.ts schema.
 */

import { describe, expect, it } from "bun:test";
import type { ListEntry } from "@hooks/cli/commands/list";
import { list } from "@hooks/cli/commands/list";
import type { ParsedArgs } from "@hooks/cli/core/args";
import { PaihErrorCode } from "@hooks/cli/core/error";
import { InMemoryDeps } from "@hooks/cli/types/deps";
import type { Lockfile } from "@hooks/cli/types/lockfile";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_LOCKFILE: Lockfile = {
  lockfileVersion: 1,
  source: "/source/repo",
  sourceCommit: "abc123",
  installedAt: "2025-01-01T00:00:00Z",
  outputMode: "source",
  hooks: [
    {
      name: "TestHook",
      group: "TestGroup",
      event: "PreToolUse",
      commandString: ".claude/hooks/pai-hooks/TestGroup/TestHook/TestHook.hook.ts",
      files: ["hooks/pai-hooks/TestGroup/TestHook/TestHook.hook.ts"],
      fileHashes: {},
    },
    {
      name: "AnotherHook",
      group: "AnotherGroup",
      event: "PostToolUse",
      commandString: ".claude/hooks/pai-hooks/AnotherGroup/AnotherHook/AnotherHook.hook.ts",
      files: ["hooks/pai-hooks/AnotherGroup/AnotherHook/AnotherHook.hook.ts"],
      fileHashes: {},
    },
  ],
};

const ORPHANED_LOCKFILE: Lockfile = {
  lockfileVersion: 1,
  source: "/source/repo",
  sourceCommit: "abc123",
  installedAt: "2025-01-01T00:00:00Z",
  outputMode: "source",
  hooks: [
    {
      name: "OrphanHook",
      group: "OrphanGroup",
      event: "PreToolUse",
      commandString: ".claude/hooks/pai-hooks/OrphanGroup/OrphanHook/OrphanHook.hook.ts",
      files: ["hooks/pai-hooks/OrphanGroup/OrphanHook/OrphanHook.hook.ts"],
      fileHashes: {},
    },
  ],
};

const EMPTY_LOCKFILE: Lockfile = {
  lockfileVersion: 1,
  source: "/source/repo",
  sourceCommit: "abc123",
  installedAt: "2025-01-01T00:00:00Z",
  outputMode: "source",
  hooks: [],
};

function makeArgs(flags: Record<string, boolean | string> = {}): ParsedArgs {
  return { command: "list", names: [], flags };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("list command", () => {
  it("shows all columns for valid lockfile with existing files", () => {
    const deps = new InMemoryDeps(
      {
        "/project/.claude/hooks/pai-hooks/paih.lock.json": JSON.stringify(VALID_LOCKFILE),
        "/project/.claude/hooks/pai-hooks/TestGroup/TestHook/TestHook.hook.ts": "// hook",
        "/project/.claude/hooks/pai-hooks/AnotherGroup/AnotherHook/AnotherHook.hook.ts": "// hook",
      },
      "/project",
    );

    const result = list(makeArgs(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    expect(result.value).toContain("TestHook");
    expect(result.value).toContain("TestGroup");
    expect(result.value).toContain("PreToolUse");
    expect(result.value).toContain("source");
    expect(result.value).toContain("ok");
    expect(result.value).toContain("AnotherHook");
    expect(result.value).toContain("AnotherGroup");
    expect(result.value).toContain("PostToolUse");
  });

  it("shows MISSING status for orphaned hooks", () => {
    // Lockfile references files that don't exist on disk
    const deps = new InMemoryDeps(
      {
        "/project/.claude/hooks/pai-hooks/paih.lock.json": JSON.stringify(ORPHANED_LOCKFILE),
      },
      "/project",
    );

    const result = list(makeArgs(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    expect(result.value).toContain("OrphanHook");
    expect(result.value).toContain("MISSING");
    expect(result.value).toContain("Warning: Some hook files are missing");
  });

  it("returns LOCK_CORRUPT error for corrupt lockfile", () => {
    const deps = new InMemoryDeps(
      {
        "/project/.claude/hooks/pai-hooks/paih.lock.json": "not valid json {{{",
      },
      "/project",
    );

    const result = list(makeArgs(), deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PaihErrorCode.LockCorrupt);
  });

  it("shows empty state message when no hooks installed", () => {
    const deps = new InMemoryDeps(
      {
        "/project/.claude/hooks/pai-hooks/paih.lock.json": JSON.stringify(EMPTY_LOCKFILE),
      },
      "/project",
    );

    const result = list(makeArgs(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    expect(result.value).toBe("No hooks installed. Run paih install to get started.");
  });

  it("shows empty state when no lockfile exists", () => {
    const deps = new InMemoryDeps(
      {
        "/project/.claude/settings.json": "{}",
      },
      "/project",
    );

    const result = list(makeArgs(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    expect(result.value).toBe("No hooks installed. Run paih install to get started.");
  });

  it("outputs valid JSON with --json flag", () => {
    const deps = new InMemoryDeps(
      {
        "/project/.claude/hooks/pai-hooks/paih.lock.json": JSON.stringify(VALID_LOCKFILE),
        "/project/.claude/hooks/pai-hooks/TestGroup/TestHook/TestHook.hook.ts": "// hook",
        "/project/.claude/hooks/pai-hooks/AnotherGroup/AnotherHook/AnotherHook.hook.ts": "// hook",
      },
      "/project",
    );

    const result = list(makeArgs({ json: true }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    const parsed = JSON.parse(result.value) as ListEntry[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("TestHook");
    expect(parsed[0].group).toBe("TestGroup");
    expect(parsed[0].event).toBe("PreToolUse");
    expect(parsed[0].outputMode).toBe("source");
    expect(parsed[0].status).toBe("ok");
  });

  it("outputs empty JSON array with --json when no hooks", () => {
    const deps = new InMemoryDeps(
      {
        "/project/.claude/hooks/pai-hooks/paih.lock.json": JSON.stringify(EMPTY_LOCKFILE),
      },
      "/project",
    );

    const result = list(makeArgs({ json: true }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    expect(result.value).toBe("[]");
  });

  it("reads from --in path instead of CWD", () => {
    const deps = new InMemoryDeps(
      {
        "/other/project/.claude/hooks/pai-hooks/paih.lock.json": JSON.stringify(VALID_LOCKFILE),
        "/other/project/.claude/hooks/pai-hooks/TestGroup/TestHook/TestHook.hook.ts": "// hook",
        "/other/project/.claude/hooks/pai-hooks/AnotherGroup/AnotherHook/AnotherHook.hook.ts":
          "// hook",
      },
      "/somewhere/else",
    );

    const result = list(makeArgs({ in: "/other/project" }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    expect(result.value).toContain("TestHook");
    expect(result.value).toContain("ok");
  });

  it("returns TARGET_NOT_FOUND when --in path has no .claude/", () => {
    const deps = new InMemoryDeps(
      {
        "/nowhere/file.txt": "",
      },
      "/nowhere",
    );

    const result = list(makeArgs({ in: "/nowhere" }), deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PaihErrorCode.TargetNotFound);
  });

  it("--json outputs MISSING status in JSON", () => {
    const deps = new InMemoryDeps(
      {
        "/project/.claude/hooks/pai-hooks/paih.lock.json": JSON.stringify(ORPHANED_LOCKFILE),
      },
      "/project",
    );

    const result = list(makeArgs({ json: true }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    const parsed = JSON.parse(result.value) as ListEntry[];
    expect(parsed[0].status).toBe("MISSING");
  });
});
