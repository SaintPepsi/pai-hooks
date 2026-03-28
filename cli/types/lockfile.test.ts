/**
 * Tests for lockfile types and createLockfile factory.
 */

import { describe, it, expect } from "bun:test";
import { createLockfile, DEFAULT_OUTPUT_MODE } from "@hooks/cli/types/lockfile";
import type { Lockfile, OutputMode } from "@hooks/cli/types/lockfile";

describe("DEFAULT_OUTPUT_MODE", () => {
  it("defaults to source", () => {
    expect(DEFAULT_OUTPUT_MODE).toBe("source");
  });
});

describe("createLockfile", () => {
  it("creates a lockfile with correct defaults", () => {
    const lock = createLockfile("https://github.com/example/repo", "abc123");
    expect(lock.lockfileVersion).toBe(1);
    expect(lock.source).toBe("https://github.com/example/repo");
    expect(lock.sourceCommit).toBe("abc123");
    expect(lock.outputMode).toBe("source");
    expect(lock.hooks).toEqual([]);
    expect(lock.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("accepts null sourceCommit for local installs", () => {
    const lock = createLockfile("/local/path", null);
    expect(lock.sourceCommit).toBeNull();
  });

  it("accepts custom outputMode", () => {
    const lock = createLockfile("source", null, "compiled");
    expect(lock.outputMode).toBe("compiled");
  });

  it("accepts compiled-ts outputMode", () => {
    const lock = createLockfile("source", null, "compiled-ts");
    expect(lock.outputMode).toBe("compiled-ts");
  });

  it("produces valid Lockfile type", () => {
    const lock: Lockfile = createLockfile("s", null);
    expect(lock.lockfileVersion).toBe(1);
    expect(Array.isArray(lock.hooks)).toBe(true);
  });
});
