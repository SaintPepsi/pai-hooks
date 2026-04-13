import { describe, expect, test } from "bun:test";
import { err, ok } from "@hooks/core/result";
import type { ResultError } from "@hooks/core/error";
import { countCrossSessionViolations, readJsonlLines } from "@hooks/lib/jsonl-reader";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDeps(lines: string[]) {
  return {
    readFile: (_path: string) => ok(lines.join("\n")),
  };
}

function makeViolationLine(
  sessionId: string,
  file: string,
  violationCount = 1,
  deduplicated = false,
): string {
  return JSON.stringify({
    session_id: sessionId,
    file,
    violations: Array.from({ length: violationCount }, (_, i) => ({ check: `check-${i}` })),
    deduplicated,
  });
}

// ─── readJsonlLines ──────────────────────────────────────────────────────────

describe("readJsonlLines", () => {
  test("returns empty array when file not found", () => {
    const deps = {
      readFile: (_path: string) =>
        err({ code: "FILE_NOT_FOUND", message: "not found" } as ResultError),
    };
    expect(readJsonlLines("/no/such/file.jsonl", deps)).toEqual([]);
  });

  test("parses valid JSONL lines", () => {
    const deps = makeDeps(['{"a":1}', '{"b":2}']);
    const result = readJsonlLines<{ a?: number; b?: number }>("/some/file.jsonl", deps);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ a: 1 });
    expect(result[1]).toEqual({ b: 2 });
  });

  test("skips blank lines", () => {
    const deps = makeDeps(['{"a":1}', "", '{"b":2}', "   "]);
    const result = readJsonlLines("/file.jsonl", deps);
    expect(result).toHaveLength(2);
  });

  test("skips malformed JSON lines without throwing", () => {
    const deps = makeDeps(['{"a":1}', "not-json", '{"b":2}']);
    const result = readJsonlLines("/file.jsonl", deps);
    expect(result).toHaveLength(2);
  });

  test("returns empty array for empty file", () => {
    const deps = { readFile: (_path: string) => ok("") };
    expect(readJsonlLines("/file.jsonl", deps)).toEqual([]);
  });
});

// ─── countCrossSessionViolations ─────────────────────────────────────────────

describe("countCrossSessionViolations", () => {
  test("counts distinct sessions with violations for the given file", () => {
    const deps = makeDeps([
      makeViolationLine("session-A", "/src/app.ts"),
      makeViolationLine("session-B", "/src/app.ts"),
      makeViolationLine("session-C", "/src/app.ts"),
    ]);
    const count = countCrossSessionViolations("/base", "/src/app.ts", "session-current", deps);
    expect(count).toBe(3);
  });

  test("excludes the current session", () => {
    const deps = makeDeps([
      makeViolationLine("session-A", "/src/app.ts"),
      makeViolationLine("session-current", "/src/app.ts"),
    ]);
    const count = countCrossSessionViolations("/base", "/src/app.ts", "session-current", deps);
    expect(count).toBe(1);
  });

  test("excludes entries for different files", () => {
    const deps = makeDeps([
      makeViolationLine("session-A", "/src/other.ts"),
      makeViolationLine("session-B", "/src/app.ts"),
    ]);
    const count = countCrossSessionViolations("/base", "/src/app.ts", "session-current", deps);
    expect(count).toBe(1);
  });

  test("excludes deduplicated entries", () => {
    const deps = makeDeps([
      makeViolationLine("session-A", "/src/app.ts", 1, true),
      makeViolationLine("session-B", "/src/app.ts", 1, false),
    ]);
    const count = countCrossSessionViolations("/base", "/src/app.ts", "session-current", deps);
    expect(count).toBe(1);
  });

  test("excludes entries with no violations array", () => {
    const deps = makeDeps([
      JSON.stringify({ session_id: "session-A", file: "/src/app.ts" }),
      makeViolationLine("session-B", "/src/app.ts"),
    ]);
    const count = countCrossSessionViolations("/base", "/src/app.ts", "session-current", deps);
    expect(count).toBe(1);
  });

  test("counts each session only once even with multiple entries", () => {
    const deps = makeDeps([
      makeViolationLine("session-A", "/src/app.ts"),
      makeViolationLine("session-A", "/src/app.ts"),
      makeViolationLine("session-B", "/src/app.ts"),
    ]);
    const count = countCrossSessionViolations("/base", "/src/app.ts", "session-current", deps);
    expect(count).toBe(2);
  });

  test("returns 0 when log file not found", () => {
    const deps = {
      readFile: (_path: string) =>
        err({ code: "FILE_NOT_FOUND", message: "not found" } as ResultError),
    };
    const count = countCrossSessionViolations("/base", "/src/app.ts", "session-current", deps);
    expect(count).toBe(0);
  });
});
