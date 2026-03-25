/**
 * CLI filesystem adapter tests.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { readFile, writeFile, fileExists, readDir, ensureDir, stat } from "@hooks/cli/adapters/fs";
import { ensureDir as coreEnsureDir, removeDir } from "@hooks/core/adapters/fs";
import { writeFile as coreWriteFile } from "@hooks/core/adapters/fs";

const TEST_DIR = join(import.meta.dir, "../../test-fixtures/cli-fs-test");

describe("cli/adapters/fs", () => {
  beforeAll(() => {
    coreEnsureDir(TEST_DIR);
    coreWriteFile(join(TEST_DIR, "sample.txt"), "hello");
    coreEnsureDir(join(TEST_DIR, "subdir"));
    coreWriteFile(join(TEST_DIR, "subdir/nested.txt"), "nested");
  });

  afterAll(() => {
    removeDir(TEST_DIR);
  });

  describe("readFile", () => {
    it("reads existing file", () => {
      const result = readFile(join(TEST_DIR, "sample.txt"));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("hello");
    });

    it("returns Err for missing file", () => {
      const result = readFile(join(TEST_DIR, "missing.txt"));
      expect(result.ok).toBe(false);
    });
  });

  describe("writeFile", () => {
    it("writes a file and creates parent dirs", () => {
      const path = join(TEST_DIR, "newdir/written.txt");
      const result = writeFile(path, "written");
      expect(result.ok).toBe(true);

      const readBack = readFile(path);
      expect(readBack.ok).toBe(true);
      if (readBack.ok) expect(readBack.value).toBe("written");
    });
  });

  describe("fileExists", () => {
    it("returns true for existing file", () => {
      expect(fileExists(join(TEST_DIR, "sample.txt"))).toBe(true);
    });

    it("returns false for missing file", () => {
      expect(fileExists(join(TEST_DIR, "nope.txt"))).toBe(false);
    });
  });

  describe("readDir", () => {
    it("lists directory entries", () => {
      const result = readDir(TEST_DIR);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("sample.txt");
        expect(result.value).toContain("subdir");
      }
    });
  });

  describe("ensureDir", () => {
    it("creates directory recursively", () => {
      const dir = join(TEST_DIR, "deep/nested/dir");
      const result = ensureDir(dir);
      expect(result.ok).toBe(true);
      expect(fileExists(dir)).toBe(true);
    });
  });

  describe("stat", () => {
    it("returns isDirectory: false for a file", () => {
      const result = stat(join(TEST_DIR, "sample.txt"));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.isDirectory).toBe(false);
    });

    it("returns isDirectory: true for a directory", () => {
      const result = stat(join(TEST_DIR, "subdir"));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.isDirectory).toBe(true);
    });
  });
});
