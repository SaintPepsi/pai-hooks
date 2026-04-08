import { describe, expect, test } from "bun:test";
import type { PaihError } from "@hooks/cli/core/error";
import type { Result } from "@hooks/cli/core/result";
import type { DuplicationIndex } from "@hooks/hooks/DuplicationDetection/shared";
import { getArtifactsDir, projectHash } from "@hooks/hooks/DuplicationDetection/shared";
import { inspect, type InspectorDeps, type InspectResult } from "./inspector";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const PROJECT_DIR = "/Users/test/my-project";
const BRANCH = "main";
const HASH = projectHash(PROJECT_DIR);
const INDEX_PATH = `${getArtifactsDir(PROJECT_DIR, BRANCH)}/index.json`;

function makeIndex(overrides: Partial<DuplicationIndex> = {}): DuplicationIndex {
  return {
    version: 1,
    root: PROJECT_DIR,
    branch: BRANCH,
    builtAt: "2026-04-08T14:32:01.000Z",
    fileCount: 28,
    functionCount: 142,
    entries: [],
    hashGroups: [["abc", [0, 1]], ["def", [2]]],
    nameGroups: Array.from({ length: 98 }, (_, i) => [`name${i}`, [i]]) as [string, number[]][],
    sigGroups: Array.from({ length: 67 }, (_, i) => [`sig${i}`, [i]]) as [string, number[]][],
    patterns: [
      { id: "p1", name: "pattern1", sig: "sig1", tier: 1, fileCount: 3, files: ["a.ts", "b.ts", "c.ts"] },
      { id: "p2", name: "pattern2", sig: "sig2", tier: 2, fileCount: 2, files: ["d.ts", "e.ts"] },
      { id: "p3", name: "pattern3", sig: "sig3", tier: 2, fileCount: 4, files: ["f.ts", "g.ts", "h.ts", "i.ts"] },
    ],
    ...overrides,
  };
}

function makeDeps(index: DuplicationIndex | null): InspectorDeps {
  const content = index ? JSON.stringify(index) : null;
  return {
    readFile: (path: string) => (path === INDEX_PATH ? content : null),
    exists: (path: string) => path === INDEX_PATH && content !== null,
    cwd: () => PROJECT_DIR,
    getBranch: () => BRANCH,
  };
}

function unwrap(result: Result<InspectResult, PaihError>): InspectResult {
  if (!result.ok) throw new Error(`Result not ok: ${result.error.message}`);
  return result.value;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("DuplicationChecker inspector", () => {
  test("returns summary with state file path when index exists", () => {
    const index = makeIndex();
    const deps = makeDeps(index);
    const result = unwrap(inspect(PROJECT_DIR, deps));

    expect(result.statePath).toBe(INDEX_PATH);
    expect(result.summary).toContain("State file:");
    expect(result.summary).toContain(INDEX_PATH);
    expect(result.summary).toContain("DuplicationChecker");
    expect(result.summary).toContain(PROJECT_DIR);
    expect(result.summary).toContain("Files:         28");
    expect(result.summary).toContain("Functions:     142");
    expect(result.summary).toContain("Branch:        main");
  });

  test("includes pattern tier breakdown in summary", () => {
    const index = makeIndex();
    const deps = makeDeps(index);
    const result = unwrap(inspect(PROJECT_DIR, deps));

    expect(result.summary).toContain("Patterns:      3 (1 tier-1, 2 tier-2)");
  });

  test("returns raw index content", () => {
    const index = makeIndex();
    const deps = makeDeps(index);
    const result = unwrap(inspect(PROJECT_DIR, deps));

    const parsed = JSON.parse(result.raw);
    expect(parsed.version).toBe(1);
    expect(parsed.fileCount).toBe(28);
    expect(parsed.functionCount).toBe(142);
  });

  test("returns structured json data", () => {
    const index = makeIndex();
    const deps = makeDeps(index);
    const result = unwrap(inspect(PROJECT_DIR, deps));

    expect(result.json.statePath).toBe(INDEX_PATH);
    expect(result.json.version).toBe(1);
    expect(result.json.fileCount).toBe(28);
    expect(result.json.functionCount).toBe(142);
    expect(result.json.branch).toBe("main");
    expect(result.json.builtAt).toBe("2026-04-08T14:32:01.000Z");
    expect(result.json.hashGroupCount).toBe(2);
    expect(result.json.nameGroupCount).toBe(98);
    expect(result.json.sigGroupCount).toBe(67);
    expect(result.json.patternCount).toBe(3);
    expect(result.json.tier1Count).toBe(1);
    expect(result.json.tier2Count).toBe(2);
  });

  test("returns error when no index exists (with expected path in message)", () => {
    const deps = makeDeps(null);
    const result = inspect(PROJECT_DIR, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("No state found for DuplicationChecker");
      expect(result.error.message).toContain(INDEX_PATH);
    }
  });

  test("returns error when index file has invalid JSON", () => {
    const deps: InspectorDeps = {
      readFile: (path: string) => (path === INDEX_PATH ? "not-valid-json{{{" : null),
      exists: (path: string) => path === INDEX_PATH,
      cwd: () => PROJECT_DIR,
      getBranch: () => BRANCH,
    };
    const result = inspect(PROJECT_DIR, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain(INDEX_PATH);
    }
  });

  test("handles index with no patterns gracefully", () => {
    const index = makeIndex({ patterns: undefined });
    const deps = makeDeps(index);
    const result = unwrap(inspect(PROJECT_DIR, deps));

    expect(result.summary).toContain("Patterns:      0");
    expect(result.json.patternCount).toBe(0);
    expect(result.json.tier1Count).toBe(0);
    expect(result.json.tier2Count).toBe(0);
  });

  test("shows hash/name/sig group counts in summary", () => {
    const index = makeIndex();
    const deps = makeDeps(index);
    const result = unwrap(inspect(PROJECT_DIR, deps));

    expect(result.summary).toContain("Hash groups:   2");
    expect(result.summary).toContain("Name groups:   98");
    expect(result.summary).toContain("Sig groups:    67");
  });
});
