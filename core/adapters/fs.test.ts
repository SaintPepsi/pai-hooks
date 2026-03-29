import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorCode } from "../error";
import {
  appendFile,
  copyFile,
  ensureDir,
  fileExists,
  lstat,
  readDir,
  readFile,
  readJson,
  removeDir,
  removeFile,
  stat,
  symlink,
  writeFile,
  writeJson,
} from "./fs";

const TEST_DIR = join(tmpdir(), `pai-fs-adapter-test-${process.pid}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  removeDir(TEST_DIR);
});

// ─── fileExists ──────────────────────────────────────────────────────────────

describe("fileExists", () => {
  it("returns true for existing file", () => {
    const p = join(TEST_DIR, "exists.txt");
    writeFileSync(p, "hi");
    expect(fileExists(p)).toBe(true);
  });

  it("returns false for missing file", () => {
    expect(fileExists(join(TEST_DIR, "nope.txt"))).toBe(false);
  });
});

// ─── readFile ────────────────────────────────────────────────────────────────

describe("readFile", () => {
  it("reads file content on success", () => {
    const p = join(TEST_DIR, "read.txt");
    writeFileSync(p, "hello world");
    const r = readFile(p);
    expect(r.ok).toBe(true);
    expect(r.value!).toBe("hello world");
  });

  it("returns FILE_NOT_FOUND for missing file", () => {
    const r = readFile(join(TEST_DIR, "missing.txt"));
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe(ErrorCode.FileNotFound);
  });
});

// ─── readJson ────────────────────────────────────────────────────────────────

describe("readJson", () => {
  it("parses JSON content", () => {
    const p = join(TEST_DIR, "data.json");
    writeFileSync(p, JSON.stringify({ name: "test" }));
    const r = readJson<{ name: string }>(p);
    expect(r.ok).toBe(true);
    expect(r.value!.name).toBe("test");
  });

  it("returns error for invalid JSON", () => {
    const p = join(TEST_DIR, "bad.json");
    writeFileSync(p, "not json {{{");
    const r = readJson(p);
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe(ErrorCode.FileReadFailed);
  });

  it("returns FILE_NOT_FOUND for missing file", () => {
    const r = readJson(join(TEST_DIR, "missing.json"));
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe(ErrorCode.FileNotFound);
  });
});

// ─── writeFile ───────────────────────────────────────────────────────────────

describe("writeFile", () => {
  it("writes content to file", () => {
    const p = join(TEST_DIR, "write.txt");
    const r = writeFile(p, "written");
    expect(r.ok).toBe(true);
    expect(existsSync(p)).toBe(true);
  });

  it("creates parent directories", () => {
    const p = join(TEST_DIR, "deep", "nested", "file.txt");
    const r = writeFile(p, "deep");
    expect(r.ok).toBe(true);
    expect(existsSync(p)).toBe(true);
  });
});

// ─── writeJson ───────────────────────────────────────────────────────────────

describe("writeJson", () => {
  it("writes JSON with formatting", () => {
    const p = join(TEST_DIR, "out.json");
    const r = writeJson(p, { a: 1 });
    expect(r.ok).toBe(true);
    expect(existsSync(p)).toBe(true);
    const content = readFile(p);
    expect(content.ok).toBe(true);
    expect(JSON.parse(content.value!)).toEqual({ a: 1 });
  });
});

// ─── appendFile ──────────────────────────────────────────────────────────────

describe("appendFile", () => {
  it("appends to existing file", () => {
    const p = join(TEST_DIR, "append.txt");
    writeFileSync(p, "line1\n");
    const r = appendFile(p, "line2\n");
    expect(r.ok).toBe(true);
    const content = readFile(p);
    expect(content.ok).toBe(true);
    expect(content.value).toBe("line1\nline2\n");
  });

  it("creates file if not exists", () => {
    const p = join(TEST_DIR, "new-append.txt");
    const r = appendFile(p, "first\n");
    expect(r.ok).toBe(true);
    expect(existsSync(p)).toBe(true);
  });
});

// ─── ensureDir ───────────────────────────────────────────────────────────────

describe("ensureDir", () => {
  it("creates directory recursively", () => {
    const p = join(TEST_DIR, "a", "b", "c");
    const r = ensureDir(p);
    expect(r.ok).toBe(true);
    expect(existsSync(p)).toBe(true);
  });

  it("succeeds if directory already exists", () => {
    const r = ensureDir(TEST_DIR);
    expect(r.ok).toBe(true);
  });
});

// ─── removeFile ─────────────────────────────────────────────────────────────

describe("removeFile", () => {
  it("removes an existing file", () => {
    const p = join(TEST_DIR, "to-remove.txt");
    writeFileSync(p, "bye");
    const r = removeFile(p);
    expect(r.ok).toBe(true);
    expect(existsSync(p)).toBe(false);
  });

  it("returns error for non-existent file", () => {
    const r = removeFile(join(TEST_DIR, "nope.txt"));
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe(ErrorCode.FileWriteFailed);
  });
});

// ─── copyFile ───────────────────────────────────────────────────────────────

describe("copyFile", () => {
  it("copies a file", () => {
    const src = join(TEST_DIR, "src.txt");
    const dest = join(TEST_DIR, "dest.txt");
    writeFileSync(src, "content");
    const r = copyFile(src, dest);
    expect(r.ok).toBe(true);
    expect(existsSync(dest)).toBe(true);
    const content = readFile(dest);
    expect(content.ok).toBe(true);
    expect(content.value!).toBe("content");
  });

  it("returns error when source missing", () => {
    const r = copyFile(join(TEST_DIR, "nope.txt"), join(TEST_DIR, "dest.txt"));
    expect(r.ok).toBe(false);
  });
});

// ─── stat ───────────────────────────────────────────────────────────────────

describe("stat", () => {
  it("returns mtimeMs for existing file", () => {
    const p = join(TEST_DIR, "stat-test.txt");
    writeFileSync(p, "hi");
    const r = stat(p);
    expect(r.ok).toBe(true);
    expect(typeof r.value!.mtimeMs).toBe("number");
    expect(r.value!.mtimeMs).toBeGreaterThan(0);
  });

  it("returns error for non-existent file", () => {
    const r = stat(join(TEST_DIR, "nope.txt"));
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe(ErrorCode.FileReadFailed);
  });
});

// ─── readDir ────────────────────────────────────────────────────────────────

describe("readDir", () => {
  it("reads directory entries", () => {
    writeFileSync(join(TEST_DIR, "a.txt"), "a");
    writeFileSync(join(TEST_DIR, "b.txt"), "b");
    const r = readDir(TEST_DIR);
    expect(r.ok).toBe(true);
    expect(r.value!.length).toBeGreaterThanOrEqual(2);
  });

  it("reads with withFileTypes", () => {
    writeFileSync(join(TEST_DIR, "typed.txt"), "t");
    const r = readDir(TEST_DIR, { withFileTypes: true });
    expect(r.ok).toBe(true);
    expect(r.value!.some((e) => typeof e.isDirectory === "function")).toBe(true);
  });

  it("returns error for non-existent directory", () => {
    const r = readDir(join(TEST_DIR, "nope"));
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe(ErrorCode.FileReadFailed);
  });
});

// ─── symlink ────────────────────────────────────────────────────────────────

describe("symlink", () => {
  it("creates a symlink", () => {
    const target = join(TEST_DIR, "link-target");
    mkdirSync(target);
    const linkPath = join(TEST_DIR, "my-link");
    const r = symlink(target, linkPath);
    expect(r.ok).toBe(true);
    expect(existsSync(linkPath)).toBe(true);
  });

  it("returns error when link already exists", () => {
    const target = join(TEST_DIR, "t2");
    mkdirSync(target);
    const linkPath = join(TEST_DIR, "link2");
    symlinkSync(target, linkPath);
    const r = symlink(target, linkPath);
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe(ErrorCode.FileWriteFailed);
  });
});

// ─── lstat ──────────────────────────────────────────────────────────────────

describe("lstat", () => {
  it("returns isSymbolicLink for symlink", () => {
    const target = join(TEST_DIR, "lstat-target");
    mkdirSync(target);
    const linkPath = join(TEST_DIR, "lstat-link");
    symlinkSync(target, linkPath);
    const r = lstat(linkPath);
    expect(r.ok).toBe(true);
    expect(r.value!.isSymbolicLink()).toBe(true);
  });

  it("returns isSymbolicLink false for regular file", () => {
    const p = join(TEST_DIR, "regular.txt");
    writeFileSync(p, "hi");
    const r = lstat(p);
    expect(r.ok).toBe(true);
    expect(r.value!.isSymbolicLink()).toBe(false);
  });

  it("returns error for non-existent path", () => {
    const r = lstat(join(TEST_DIR, "nope"));
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe(ErrorCode.FileReadFailed);
  });
});
