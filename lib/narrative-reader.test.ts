import { describe, it, expect } from "bun:test";
import { pickNarrative, scoreFromCount, type NarrativeReaderDeps } from "@hooks/lib/narrative-reader";

function makeDeps(entries: Array<{ message: string; score: number }>): NarrativeReaderDeps {
  return {
    readFile: () => entries.map(e => JSON.stringify(e)).join("\n"),
    fileExists: () => true,
    baseDir: "/tmp/test",
    stderr: () => {},
  };
}

describe("scoreFromCount", () => {
  it("returns 1 for 1-2 violations", () => {
    expect(scoreFromCount(1)).toBe(1);
    expect(scoreFromCount(2)).toBe(1);
  });

  it("returns 2 for 3-5 violations", () => {
    expect(scoreFromCount(3)).toBe(2);
    expect(scoreFromCount(5)).toBe(2);
  });

  it("returns 3 for 6+ violations", () => {
    expect(scoreFromCount(6)).toBe(3);
    expect(scoreFromCount(100)).toBe(3);
  });

  it("returns 2 for 0 violations (default)", () => {
    expect(scoreFromCount(0)).toBe(2);
  });
});

describe("pickNarrative", () => {
  it("picks from matching score tier", () => {
    const deps = makeDeps([
      { message: "tier-1-msg", score: 1 },
      { message: "tier-2-msg", score: 2 },
      { message: "tier-3-msg", score: 3 },
    ]);
    const result = pickNarrative("TestHook", 1, deps);
    expect(result).toBe("tier-1-msg");
  });

  it("falls back to any tier if no match", () => {
    const deps = makeDeps([
      { message: "only-tier-2", score: 2 },
    ]);
    const result = pickNarrative("TestHook", 1, deps);
    expect(result).toBe("only-tier-2");
  });

  it("returns generic default if no file exists", () => {
    const deps: NarrativeReaderDeps = {
      readFile: () => null,
      fileExists: () => false,
      baseDir: "/tmp/test",
      stderr: () => {},
    };
    const result = pickNarrative("TestHook", 3, deps);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns generic default if file is empty", () => {
    const deps = makeDeps([]);
    deps.readFile = () => "";
    const result = pickNarrative("TestHook", 1, deps);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
