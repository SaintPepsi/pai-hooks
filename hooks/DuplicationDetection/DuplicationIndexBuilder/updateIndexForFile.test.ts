import { describe, expect, test } from "bun:test";
import {
  readDir as adapterReadDir,
  readFile as adapterReadFile,
  stat as adapterStat,
  fileExists,
} from "@hooks/core/adapters/fs";
import type { IndexBuilderDeps } from "@hooks/hooks/DuplicationDetection/index-builder-logic";
import { updateIndexForFile } from "@hooks/hooks/DuplicationDetection/index-builder-logic";
import { defaultParserDeps } from "@hooks/hooks/DuplicationDetection/parser";
import type { DuplicationIndex } from "@hooks/hooks/DuplicationDetection/shared";

function makeRealIndexBuilderDeps(): IndexBuilderDeps {
  return {
    readDir: (path: string): string[] | null => {
      const result = adapterReadDir(path);
      return result.ok ? result.value : null;
    },
    readFile: (path: string): string | null => {
      const result = adapterReadFile(path);
      return result.ok ? result.value : null;
    },
    isDirectory: (path: string): boolean => {
      const result = adapterStat(path);
      return result.ok ? result.value.isDirectory() : false;
    },
    exists: (path: string): boolean => fileExists(path),
    stat: (path: string): { mtimeMs: number } | null => {
      const result = adapterStat(path);
      return result.ok ? { mtimeMs: result.value.mtimeMs } : null;
    },
    join: (...parts: string[]): string => require("node:path").join(...parts) as string,
    resolve: (path: string): string => require("node:path").resolve(path) as string,
    parserDeps: defaultParserDeps,
  };
}

function makeSeedIndex(entries: DuplicationIndex["entries"]): DuplicationIndex {
  return {
    version: 1,
    root: "/project",
    builtAt: new Date().toISOString(),
    fileCount: new Set(entries.map((e) => e.f)).size,
    functionCount: entries.length,
    entries,
    hashGroups: [],
    nameGroups: [],
    sigGroups: [],
  };
}

describe("updateIndexForFile", () => {
  test("increments fileCount when adding a function from a new file path", () => {
    const seed = makeSeedIndex([
      { f: "src/a.ts", n: "fnA", l: 1, h: "h1", p: "()", r: "void", fp: "fp1", s: 0 },
      { f: "src/b.ts", n: "fnB", l: 1, h: "h2", p: "()", r: "void", fp: "fp2", s: 0 },
    ]);

    const newContent = "export function fnC(): string { return 'c'; }";
    const result = updateIndexForFile(
      seed,
      "/project/src/c.ts",
      newContent,
      makeRealIndexBuilderDeps(),
    );

    expect(result.fileCount).toBe(3);
    expect(result.entries.some((e) => e.f === "src/c.ts")).toBe(true);
  });

  test("decrements fileCount when a file loses all functions", () => {
    const seed = makeSeedIndex([
      { f: "src/a.ts", n: "fnA", l: 1, h: "h1", p: "()", r: "void", fp: "fp1", s: 0 },
      { f: "src/b.ts", n: "fnB", l: 1, h: "h2", p: "()", r: "void", fp: "fp2", s: 0 },
    ]);

    const result = updateIndexForFile(
      seed,
      "/project/src/b.ts",
      "const x = 1;",
      makeRealIndexBuilderDeps(),
    );

    expect(result.fileCount).toBe(1);
    expect(result.entries.every((e) => e.f !== "src/b.ts")).toBe(true);
  });

  test("fileCount stays the same when replacing functions in an existing file", () => {
    const seed = makeSeedIndex([
      { f: "src/a.ts", n: "fnA", l: 1, h: "h1", p: "()", r: "void", fp: "fp1", s: 0 },
      { f: "src/b.ts", n: "fnB", l: 1, h: "h2", p: "()", r: "void", fp: "fp2", s: 0 },
    ]);

    const newContent = "export function fnBv2(): number { return 42; }";
    const result = updateIndexForFile(
      seed,
      "/project/src/b.ts",
      newContent,
      makeRealIndexBuilderDeps(),
    );

    expect(result.fileCount).toBe(2);
    expect(result.entries.some((e) => e.n === "fnBv2")).toBe(true);
    expect(result.entries.every((e) => e.n !== "fnB")).toBe(true);
  });
});
