/**
 * InMemoryDeps test double tests.
 */

import { describe, it, expect } from "bun:test";
import { InMemoryDeps } from "@hooks/cli/types/deps";

describe("InMemoryDeps", () => {
  it("reads files from initial tree", () => {
    const deps = new InMemoryDeps({
      "/a/b.txt": "content-b",
      "/a/c.txt": "content-c",
    });

    const result = deps.readFile("/a/b.txt");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("content-b");
  });

  it("returns Err for missing files", () => {
    const deps = new InMemoryDeps({});
    const result = deps.readFile("/missing");
    expect(result.ok).toBe(false);
  });

  it("writes and reads back files", () => {
    const deps = new InMemoryDeps({});
    deps.writeFile("/new/file.txt", "hello");

    const result = deps.readFile("/new/file.txt");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("hello");
  });

  it("fileExists returns true for files and dirs", () => {
    const deps = new InMemoryDeps({
      "/project/src/file.ts": "",
    });

    expect(deps.fileExists("/project/src/file.ts")).toBe(true);
    expect(deps.fileExists("/project/src")).toBe(true);
    expect(deps.fileExists("/project")).toBe(true);
    expect(deps.fileExists("/missing")).toBe(false);
  });

  it("readDir lists immediate children", () => {
    const deps = new InMemoryDeps({
      "/root/a.txt": "",
      "/root/b.txt": "",
      "/root/sub/c.txt": "",
    });

    const result = deps.readDir("/root");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("a.txt");
      expect(result.value).toContain("b.txt");
      expect(result.value).toContain("sub");
      // Should not include nested paths
      expect(result.value).not.toContain("c.txt");
    }
  });

  it("ensureDir makes paths exist", () => {
    const deps = new InMemoryDeps({});
    deps.ensureDir("/new/deep/dir");

    expect(deps.fileExists("/new/deep/dir")).toBe(true);
    expect(deps.fileExists("/new/deep")).toBe(true);
    expect(deps.fileExists("/new")).toBe(true);
  });

  it("stat distinguishes files from directories", () => {
    const deps = new InMemoryDeps({
      "/project/file.ts": "code",
    });

    const fileStat = deps.stat("/project/file.ts");
    expect(fileStat.ok).toBe(true);
    if (fileStat.ok) expect(fileStat.value.isDirectory).toBe(false);

    const dirStat = deps.stat("/project");
    expect(dirStat.ok).toBe(true);
    if (dirStat.ok) expect(dirStat.value.isDirectory).toBe(true);
  });

  it("stat returns Err for non-existent paths", () => {
    const deps = new InMemoryDeps({});
    const result = deps.stat("/nowhere");
    expect(result.ok).toBe(false);
  });

  it("uses provided cwd", () => {
    const deps = new InMemoryDeps({}, "/my/cwd");
    expect(deps.cwd()).toBe("/my/cwd");
  });

  it("addFile helper works", () => {
    const deps = new InMemoryDeps({});
    deps.addFile("/added.txt", "added");

    const result = deps.readFile("/added.txt");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("added");
  });

  it("getFiles returns snapshot", () => {
    const deps = new InMemoryDeps({
      "/a": "1",
      "/b": "2",
    });

    const files = deps.getFiles();
    expect(files.size).toBe(2);
    expect(files.get("/a")).toBe("1");
  });
});
