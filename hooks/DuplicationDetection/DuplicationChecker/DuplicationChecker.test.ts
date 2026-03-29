import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { PaiError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { BlockOutput, ContinueOutput } from "@hooks/core/types/hook-outputs";
import {
  DuplicationCheckerContract,
  type DuplicationCheckerDeps,
} from "@hooks/hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.contract";
import {
  checkFunctions,
  clearIndexCache,
  type DuplicationIndex,
} from "@hooks/hooks/DuplicationDetection/shared";

// ─── Constants ───────────────────────────────────────────────────────────────

const PAI_HOOKS_ROOT = "/Users/hogers/.claude/pai-hooks";
const INDEX_PATH = `${PAI_HOOKS_ROOT}/.duplication-index.json`;
const REAL_INDEX_PATH = `${PAI_HOOKS_ROOT}/.claude/.duplication-index.json`;

// ─── Build Index ──────────────────────────────────────────────────────────────

beforeAll(() => {
  const result = Bun.spawnSync(
    [
      "bun",
      "/Users/hogers/.claude/Tools/pattern-detector/variants/index-builder.ts",
      "build",
      PAI_HOOKS_ROOT,
      "--output",
      INDEX_PATH,
    ],
    { cwd: PAI_HOOKS_ROOT },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Index build failed (exit ${result.exitCode}): ${new TextDecoder().decode(result.stderr)}`,
    );
  }
});

beforeEach(() => {
  clearIndexCache();
});

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const mockDeps: DuplicationCheckerDeps = {
  readFile: (path) => require("node:fs").readFileSync(path, "utf-8") as string,
  exists: (path) => require("node:fs").existsSync(path) as boolean,
  appendFile: () => {},
  ensureDir: () => {},
  stderr: () => {},
  now: () => Date.now(),
  blocking: true,
};

function makeWriteInput(filePath: string, content: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
  };
}

function makeEditInput(filePath: string, oldString = "a", newString = "b"): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
  };
}

function makeInput(toolName: string, filePath: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: toolName,
    tool_input: { file_path: filePath },
  };
}

function unwrap(result: Result<ContinueOutput | BlockOutput, PaiError>): ContinueOutput | BlockOutput {
  if (!result.ok) throw new Error(`Result not ok: ${result.error.message}`);
  return result.value;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DuplicationCheckerContract", () => {
  // ─── accepts() ─────────────────────────────────────────────────────────────

  describe("accepts()", () => {
    test("returns false for non-Write/Edit tools", () => {
      expect(DuplicationCheckerContract.accepts(makeInput("Read", "/src/app.ts"))).toBe(false);
      expect(DuplicationCheckerContract.accepts(makeInput("Bash", "/src/app.ts"))).toBe(false);
    });

    test("returns false for non-.ts files", () => {
      expect(DuplicationCheckerContract.accepts(makeWriteInput("/src/app.js", ""))).toBe(false);
      expect(DuplicationCheckerContract.accepts(makeWriteInput("/src/style.css", ""))).toBe(false);
    });

    test("returns false for .d.ts files", () => {
      expect(DuplicationCheckerContract.accepts(makeWriteInput("/src/types.d.ts", ""))).toBe(false);
    });

    test("returns true for Write to .ts file", () => {
      expect(DuplicationCheckerContract.accepts(makeWriteInput("/src/app.ts", ""))).toBe(true);
    });

    test("returns true for Edit to .ts file", () => {
      expect(DuplicationCheckerContract.accepts(makeEditInput("/src/app.ts"))).toBe(true);
    });
  });

  // ─── execute() ─────────────────────────────────────────────────────────────

  describe("execute()", () => {
    test("returns continue with no additionalContext when no index exists", () => {
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        exists: () => false,
      };
      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`,
        "export function foo() { return 1; }",
      );
      const output = unwrap(DuplicationCheckerContract.execute(input, deps));
      expect(output.type).toBe("continue");
      if (output.type === "continue") {
        expect(output.additionalContext).toBeUndefined();
      }
    });

    test("blocks when writing content with 4/4 signal match (exact duplicate)", () => {
      // CodingStandardsAdvisor.contract.ts contains getFilePath — a function
      // duplicated across multiple contracts with all 4 signals matching.
      const realContent = require("node:fs").readFileSync(
        `${PAI_HOOKS_ROOT}/hooks/CodingStandards/CodingStandardsAdvisor/CodingStandardsAdvisor.contract.ts`,
        "utf-8",
      ) as string;

      // Mock now() to be within freshness window of the index
      const indexContent = require("node:fs").readFileSync(REAL_INDEX_PATH, "utf-8") as string;
      const indexBuiltAt = new Date(JSON.parse(indexContent).builtAt as string).getTime();
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        now: () => indexBuiltAt + 10_000, // 10s after build = fresh
      };

      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/SomeNewHook/SomeNewHook.ts`,
        realContent,
      );
      const output = unwrap(DuplicationCheckerContract.execute(input, deps));
      expect(output.type).toBe("block");
      if (output.type === "block") {
        expect(output.reason).toContain("Exact duplicate");
      }
    });

    test("logs but does not block for 2-3 signal matches", () => {
      // Craft content with a function that shares name+sig but NOT body hash
      // with existing functions (2/4 signals = log only, not block)
      const partialMatchContent = `
export function makeDeps(x: string): Record<string, unknown> {
  // Unique body that won't hash-match any indexed function
  const uniqueValue = "partial-match-test-" + Date.now().toString(36);
  return { x, uniqueValue, created: true };
}
      `.trim();

      const stderrMessages: string[] = [];
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        stderr: (msg) => stderrMessages.push(msg),
      };

      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/SomeNewHook/SomeNewHook.ts`,
        partialMatchContent,
      );
      const output = unwrap(DuplicationCheckerContract.execute(input, deps));
      expect(output.type).toBe("continue");
    });

    test("returns continue for genuinely unique content", () => {
      // Use a truly unique signature to avoid sig+body matches
      const uniqueContent = `
export function veryUniquelyNamedXyz99Function(alphaOmega: string, betaGamma: boolean, deltaEpsilon: Map<string, number>): [string, boolean] {
  const result = alphaOmega + String(betaGamma);
  deltaEpsilon.set(result, deltaEpsilon.size + 42);
  return [result, deltaEpsilon.size > 1337];
}
      `.trim();

      const stderrMessages: string[] = [];
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        stderr: (msg) => stderrMessages.push(msg),
      };

      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/SomeNewHook/SomeNewHook.ts`,
        uniqueContent,
      );
      const output = unwrap(DuplicationCheckerContract.execute(input, deps));
      expect(output.type).toBe("continue");
    });

    test("block reason lists duplicate targets", () => {
      const realContent = require("node:fs").readFileSync(
        `${PAI_HOOKS_ROOT}/hooks/CodingStandards/CodingStandardsAdvisor/CodingStandardsAdvisor.contract.ts`,
        "utf-8",
      ) as string;

      const indexContent = require("node:fs").readFileSync(REAL_INDEX_PATH, "utf-8") as string;
      const indexBuiltAt = new Date(JSON.parse(indexContent).builtAt as string).getTime();
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        now: () => indexBuiltAt + 10_000,
      };

      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/SomeNewHook/SomeNewHook.ts`,
        realContent,
      );
      const output = unwrap(DuplicationCheckerContract.execute(input, deps));
      expect(output.type).toBe("block");
      if (output.type === "block") {
        expect(output.reason).toContain("duplicates");
        expect(output.reason).toContain("Reuse the existing function");
      }
    });

    test("does not block when index is stale even with 4/4 match", () => {
      const indexContent = require("node:fs").readFileSync(REAL_INDEX_PATH, "utf-8") as string;
      const index = JSON.parse(indexContent) as { builtAt: string };
      const builtAtMs = new Date(index.builtAt).getTime();
      const SIX_MINUTES_MS = 6 * 60 * 1000;

      const stderrMessages: string[] = [];
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        now: () => builtAtMs + SIX_MINUTES_MS,
        stderr: (msg) => stderrMessages.push(msg),
      };

      const realContent = require("node:fs").readFileSync(
        `${PAI_HOOKS_ROOT}/hooks/CodingStandards/CodingStandardsAdvisor/CodingStandardsAdvisor.contract.ts`,
        "utf-8",
      ) as string;

      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/SomeNewHook/SomeNewHook.ts`,
        realContent,
      );
      const output = unwrap(DuplicationCheckerContract.execute(input, deps));
      // Stale index = never block, only log
      expect(output.type).toBe("continue");
      expect(stderrMessages.some((m) => m.includes("stale index"))).toBe(true);
    });
    test("continues instead of blocking when blocking config is false", () => {
      const realContent = require("node:fs").readFileSync(
        `${PAI_HOOKS_ROOT}/hooks/CodingStandards/CodingStandardsAdvisor/CodingStandardsAdvisor.contract.ts`,
        "utf-8",
      ) as string;

      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        blocking: false,
      };

      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/SomeNewHook/SomeNewHook.ts`,
        realContent,
      );
      const output = unwrap(DuplicationCheckerContract.execute(input, deps));
      expect(output.type).toBe("continue");
    });
  });
});

// ─── checkFunctions — name-only bestTarget branch ──────────────────────────

describe("checkFunctions", () => {
  test("sets bestTarget from name peers when no hash match exists", () => {
    // 32-char hex fingerprint — identical across all entries for guaranteed similarity
    const fp = "aa".repeat(16);
    const index: DuplicationIndex = {
      version: 1,
      root: "/repo",
      builtAt: "2026-01-01",
      fileCount: 3,
      functionCount: 3,
      entries: [
        { f: "a.ts", n: "helper", l: 10, h: "hash-a", p: "string", r: "void", fp, s: 5 },
        { f: "b.ts", n: "helper", l: 20, h: "hash-b", p: "string", r: "void", fp, s: 5 },
        { f: "c.ts", n: "helper", l: 30, h: "hash-c", p: "string", r: "void", fp, s: 5 },
      ],
      hashGroups: [],
      nameGroups: [["helper", [0, 1, 2]]],
      sigGroups: [["(string)→void", [0, 1, 2]]],
    };

    const functions = [
      {
        name: "helper",
        line: 1,
        bodyHash: "no-match-hash",
        paramSig: "string",
        returnType: "void",
        fingerprint: fp,
        bodyLines: 5,
      },
    ];

    const matches = checkFunctions(functions, index, "new-file.ts");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].targetFile).toBe("a.ts");
    expect(matches[0].signals).toContain("name");
  });
});

// ─── defaultDeps ────────────────────────────────────────────────────────────

describe("DuplicationCheckerContract defaultDeps", () => {
  test("defaultDeps.readFile returns null for missing file", () => {
    expect(DuplicationCheckerContract.defaultDeps.readFile("/tmp/pai-nonexistent-dc.ts")).toBeNull();
  });

  test("defaultDeps.exists returns false for missing path", () => {
    expect(DuplicationCheckerContract.defaultDeps.exists("/tmp/pai-nonexistent-dc-idx.json")).toBe(
      false,
    );
  });

  test("defaultDeps.appendFile does not throw", () => {
    const tmpPath = `/tmp/pai-test-dc-append-${Date.now()}.jsonl`;
    expect(() => DuplicationCheckerContract.defaultDeps.appendFile(tmpPath, "test\n")).not.toThrow();
  });

  test("defaultDeps.ensureDir does not throw", () => {
    expect(() => DuplicationCheckerContract.defaultDeps.ensureDir("/tmp")).not.toThrow();
  });

  test("defaultDeps.stderr writes without throwing", () => {
    expect(() => DuplicationCheckerContract.defaultDeps.stderr("test")).not.toThrow();
  });
});
