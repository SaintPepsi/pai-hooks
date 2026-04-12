/**
 * inspect command tests — route `paih inspect <hookName>` to hook inspectors.
 *
 * Uses dependency injection for all I/O. Mock data simulates a DuplicationChecker
 * index at the expected artifacts path.
 */

import { describe, expect, it } from "bun:test";
import type { InspectDeps } from "@hooks/cli/commands/inspect";
import { inspect } from "@hooks/cli/commands/inspect";
import type { ParsedArgs } from "@hooks/cli/core/args";
import { PaihErrorCode } from "@hooks/cli/core/error";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** The artifacts path for project "/tmp/proj" on branch "main". */
const INDEX_PATH = "/tmp/pai/duplication/6d76557c/main/index.json";

const MOCK_INDEX = JSON.stringify({
  version: 2,
  root: "/tmp/proj",
  branch: "main",
  builtAt: "2026-04-08T04:32:01.000Z",
  fileCount: 10,
  functionCount: 50,
  entries: [],
  hashGroups: [],
  nameGroups: [],
  sigGroups: [],
  patterns: [],
});

function makeArgs(names: string[] = [], flags: Record<string, boolean | string> = {}): ParsedArgs {
  return { command: "inspect", names, flags };
}

function makeDeps(overrides?: Partial<InspectDeps>): InspectDeps {
  return {
    readFile: overrides?.readFile ?? ((p: string) => (p === INDEX_PATH ? MOCK_INDEX : null)),
    exists: overrides?.exists ?? ((p: string) => p === INDEX_PATH),
    cwd: overrides?.cwd ?? (() => "/tmp/proj"),
    getBranch: overrides?.getBranch ?? (() => "main"),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("inspect command", () => {
  it("returns summary for DuplicationChecker (default output)", () => {
    const result = inspect(makeArgs(["DuplicationChecker"]), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain("DuplicationChecker");
    expect(result.value).toContain("/tmp/proj");
    expect(result.value).toContain("Files:");
    expect(result.value).toContain("10");
    expect(result.value).toContain("Functions:");
    expect(result.value).toContain("50");
  });

  it("respects --project flag (uses provided dir instead of cwd)", () => {
    /** Artifacts path for project "/other/project" on branch "main". */
    const otherIndexPath = "/tmp/pai/duplication/4349fb4b/main/index.json";
    const otherIndex = JSON.stringify({
      version: 2,
      root: "/other/project",
      branch: "main",
      builtAt: "2026-04-08T04:32:01.000Z",
      fileCount: 99,
      functionCount: 200,
      entries: [],
      hashGroups: [],
      nameGroups: [],
      sigGroups: [],
      patterns: [],
    });

    const deps = makeDeps({
      readFile: (p: string) => (p === otherIndexPath ? otherIndex : null),
      exists: (p: string) => p === otherIndexPath,
      cwd: () => "/should/not/be/used",
    });

    const result = inspect(makeArgs(["DuplicationChecker"], { project: "/other/project" }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Should reflect the --project dir, not cwd
    expect(result.value).toContain("/other/project");
    expect(result.value).toContain("99");
  });

  it("returns raw output with --raw flag", () => {
    const result = inspect(makeArgs(["DuplicationChecker"], { raw: true }), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Raw output is the full JSON string from the index file
    const parsed = JSON.parse(result.value);
    expect(parsed.version).toBe(2);
    expect(parsed.fileCount).toBe(10);
    expect(parsed.functionCount).toBe(50);
  });

  it("returns JSON with --json flag", () => {
    const result = inspect(makeArgs(["DuplicationChecker"], { json: true }), makeDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = JSON.parse(result.value);
    expect(parsed.fileCount).toBe(10);
    expect(parsed.functionCount).toBe(50);
    expect(parsed.version).toBe(2);
    expect(parsed.statePath).toBe(INDEX_PATH);
  });

  it("errors on missing hook name", () => {
    const result = inspect(makeArgs([]), makeDeps());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PaihErrorCode.InvalidArgs);
    expect(result.error.message).toContain("Usage:");
  });

  it("errors on unknown hook name", () => {
    const result = inspect(makeArgs(["NonExistentHook"]), makeDeps());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe(PaihErrorCode.HookNotFound);
    expect(result.error.message).toContain("Inspectable hooks:");
    expect(result.error.message).toContain("DuplicationChecker");
  });
});
