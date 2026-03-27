/**
 * Lockfile I/O tests — read, write, and entry management.
 *
 * Uses InMemoryDeps from cli/types/deps.ts
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-a0619c6a/cli/types/deps.ts).
 */

import { describe, it, expect } from "bun:test";
import { readLockfile, writeLockfile, addHookEntry } from "@hooks/cli/core/lockfile";
import type { Lockfile, LockfileHookEntry } from "@hooks/cli/types/lockfile";
import { InMemoryDeps } from "@hooks/cli/types/deps";

const SAMPLE_LOCKFILE: Lockfile = {
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
      commandString: "./hooks/pai-hooks/TestGroup/TestHook/TestHook.hook.ts",
      files: ["hooks/pai-hooks/TestGroup/TestHook/TestHook.hook.ts"],
      fileHashes: {},
    },
  ],
};

describe("readLockfile", () => {
  it("returns null when file does not exist", () => {
    const deps = new InMemoryDeps({});
    const result = readLockfile("/test/.claude", deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("parses existing lockfile", () => {
    const deps = new InMemoryDeps({
      "/test/.claude/hooks/paih.lock.json": JSON.stringify(SAMPLE_LOCKFILE),
    });
    const result = readLockfile("/test/.claude", deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value?.lockfileVersion).toBe(1);
      expect(result.value?.hooks).toHaveLength(1);
      expect(result.value?.hooks[0].name).toBe("TestHook");
    }
  });

  it("returns error for corrupt lockfile", () => {
    const deps = new InMemoryDeps({
      "/test/.claude/hooks/paih.lock.json": "not json",
    });
    const result = readLockfile("/test/.claude", deps);
    expect(result.ok).toBe(false);
  });

  it("returns error for unsupported lockfile version", () => {
    const badVersion = { ...SAMPLE_LOCKFILE, lockfileVersion: 99 };
    const deps = new InMemoryDeps({
      "/test/.claude/hooks/paih.lock.json": JSON.stringify(badVersion),
    });
    const result = readLockfile("/test/.claude", deps);
    expect(result.ok).toBe(false);
  });
});

describe("writeLockfile", () => {
  it("writes lockfile to .claude/hooks/paih.lock.json", () => {
    const deps = new InMemoryDeps({});
    const result = writeLockfile("/test/.claude", SAMPLE_LOCKFILE, deps);
    expect(result.ok).toBe(true);

    const files = deps.getFiles();
    expect(files.has("/test/.claude/hooks/paih.lock.json")).toBe(true);

    const content = files.get("/test/.claude/hooks/paih.lock.json")!;
    const parsed = JSON.parse(content);
    expect(parsed.lockfileVersion).toBe(1);
  });
});

describe("addHookEntry", () => {
  it("adds new entry to lockfile", () => {
    const entry: LockfileHookEntry = {
      name: "NewHook",
      group: "NewGroup",
      event: "SessionStart",
      commandString: "./hooks/pai-hooks/NewGroup/NewHook/NewHook.hook.ts",
      files: ["hooks/pai-hooks/NewGroup/NewHook/NewHook.hook.ts"],
      fileHashes: {},
    };
    const updated = addHookEntry(SAMPLE_LOCKFILE, entry);
    expect(updated.hooks).toHaveLength(2);
    expect(updated.hooks[1].name).toBe("NewHook");
  });

  it("replaces existing entry with same commandString", () => {
    const entry: LockfileHookEntry = {
      name: "TestHook",
      group: "TestGroup",
      event: "PreToolUse",
      commandString: "./hooks/pai-hooks/TestGroup/TestHook/TestHook.hook.ts",
      files: ["hooks/pai-hooks/TestGroup/TestHook/TestHook.hook.ts", "hooks/pai-hooks/TestGroup/TestHook/TestHook.contract.ts"],
      fileHashes: {},
    };
    const updated = addHookEntry(SAMPLE_LOCKFILE, entry);
    expect(updated.hooks).toHaveLength(1);
    expect(updated.hooks[0].files).toHaveLength(2);
  });

  it("does not mutate original lockfile", () => {
    const entry: LockfileHookEntry = {
      name: "NewHook",
      group: "NewGroup",
      event: "SessionStart",
      commandString: "./hooks/NewGroup/NewHook/NewHook.hook.ts",
      files: [],
      fileHashes: {},
    };
    addHookEntry(SAMPLE_LOCKFILE, entry);
    expect(SAMPLE_LOCKFILE.hooks).toHaveLength(1);
  });
});
