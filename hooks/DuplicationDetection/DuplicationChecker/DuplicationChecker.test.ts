import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { ensureDir, writeFile } from "@hooks/core/adapters/fs";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import {
  DuplicationCheckerContract,
  type DuplicationCheckerDeps,
} from "@hooks/hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.contract";
import type { InferenceResult } from "@pai/Tools/Inference";
import { DuplicationIndexBuilderContract } from "@hooks/hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.contract";
import { buildIndex } from "@hooks/hooks/DuplicationDetection/index-builder-logic";
import {
  checkFunctions,
  clearIndexCache,
  type DuplicationIndex,
  getArtifactsDir,
  getCurrentBranch,
} from "@hooks/hooks/DuplicationDetection/shared";
import { makeEditInput, makeToolInput, makeWriteInput } from "@hooks/lib/test-helpers";

// ─── Constants ───────────────────────────────────────────────────────────────

const PAI_HOOKS_ROOT = resolve(import.meta.dir, "../../..");
const BRANCH = getCurrentBranch(PAI_HOOKS_ROOT) ?? "default";
const INDEX_DIR = getArtifactsDir(PAI_HOOKS_ROOT, BRANCH);
const INDEX_PATH = `${INDEX_DIR}/index.json`;

// ─── Build Index ──────────────────────────────────────────────────────────────

beforeAll(() => {
  const { indexBuilderDeps } = DuplicationIndexBuilderContract.defaultDeps;
  const index = buildIndex(PAI_HOOKS_ROOT, indexBuilderDeps);
  ensureDir(INDEX_DIR);
  writeFile(INDEX_PATH, JSON.stringify(index));
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
  inferenceEnabled: false,
  inference: async (): Promise<InferenceResult> => ({
    success: false,
    output: "",
    latencyMs: 0,
    level: "fast" as const,
  }),
  issueReporting: false,
};

function unwrap(result: Result<SyncHookJSONOutput, ResultError>): SyncHookJSONOutput {
  if (!result.ok) throw new Error(`Result not ok: ${result.error.message}`);
  return result.value;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DuplicationCheckerContract", () => {
  // ─── accepts() ─────────────────────────────────────────────────────────────

  describe("accepts()", () => {
    test("returns false for non-Write/Edit tools", () => {
      expect(DuplicationCheckerContract.accepts(makeToolInput("Read", "/src/app.ts"))).toBe(false);
      expect(DuplicationCheckerContract.accepts(makeToolInput("Bash", "/src/app.ts"))).toBe(false);
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
    test("returns continue with no additionalContext when no index exists", async () => {
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        exists: () => false,
      };
      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`,
        "export function foo() { return 1; }",
      );
      const output = unwrap(await DuplicationCheckerContract.execute(input, deps));
      expect(output.continue).toBe(true);
      expect(output.hookSpecificOutput).toBeUndefined();
    });

    test("blocks when writing content with 4/4 signal match (exact duplicate)", async () => {
      // cli/commands/install.test.ts contains makeSourceRepo — a function whose
      // body hash matches across lifecycle.integration.test.ts, update.test.ts,
      // and compiled-install.test.ts → hash signal → block.
      const realContent = require("node:fs").readFileSync(
        `${PAI_HOOKS_ROOT}/cli/commands/install.test.ts`,
        "utf-8",
      ) as string;

      // Mock now() to be within freshness window of the index
      const indexContent = require("node:fs").readFileSync(INDEX_PATH, "utf-8") as string;
      const indexBuiltAt = new Date(JSON.parse(indexContent).builtAt as string).getTime();
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        now: () => indexBuiltAt + 10_000, // 10s after build = fresh
      };

      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/DuplicationDetection/SomeNewHook.ts`,
        realContent,
      );
      const output = unwrap(await DuplicationCheckerContract.execute(input, deps));
      const hs = output.hookSpecificOutput;
      expect(hs?.hookEventName).toBe("PreToolUse");
      if (hs && hs.hookEventName === "PreToolUse") {
        expect(hs.permissionDecision).toBe("deny");
        expect(hs.permissionDecisionReason).toContain("duplicates");
      }
    });

    test("logs but does not block for 2-3 signal matches", async () => {
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
        `${PAI_HOOKS_ROOT}/hooks/DuplicationDetection/SomeNewHook.ts`,
        partialMatchContent,
      );
      const output = unwrap(await DuplicationCheckerContract.execute(input, deps));
      expect(output.continue).toBe(true);
    });

    test("returns continue for genuinely unique content", async () => {
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
        `${PAI_HOOKS_ROOT}/hooks/DuplicationDetection/SomeNewHook.ts`,
        uniqueContent,
      );
      const output = unwrap(await DuplicationCheckerContract.execute(input, deps));
      expect(output.continue).toBe(true);
    });

    test("block reason lists duplicate targets", async () => {
      const realContent = require("node:fs").readFileSync(
        `${PAI_HOOKS_ROOT}/cli/commands/install.test.ts`,
        "utf-8",
      ) as string;

      const indexContent = require("node:fs").readFileSync(INDEX_PATH, "utf-8") as string;
      const indexBuiltAt = new Date(JSON.parse(indexContent).builtAt as string).getTime();
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        now: () => indexBuiltAt + 10_000,
      };

      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/DuplicationDetection/SomeNewHook.ts`,
        realContent,
      );
      const output = unwrap(await DuplicationCheckerContract.execute(input, deps));
      const hs = output.hookSpecificOutput;
      expect(hs?.hookEventName).toBe("PreToolUse");
      if (hs && hs.hookEventName === "PreToolUse") {
        expect(hs.permissionDecision).toBe("deny");
        expect(hs.permissionDecisionReason).toContain("duplicates");
        expect(hs.permissionDecisionReason).toContain("Reuse the existing function from");
      }
    });

    test("blocks regardless of index age (no staleness bypass)", async () => {
      const realContent = require("node:fs").readFileSync(
        `${PAI_HOOKS_ROOT}/cli/commands/install.test.ts`,
        "utf-8",
      ) as string;

      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/DuplicationDetection/SomeNewHook.ts`,
        realContent,
      );
      const output = unwrap(await DuplicationCheckerContract.execute(input, mockDeps));
      const hs = output.hookSpecificOutput;
      expect(hs?.hookEventName).toBe("PreToolUse");
      if (hs && hs.hookEventName === "PreToolUse") {
        expect(hs.permissionDecision).toBe("deny");
      }
    });
    test("injects additionalContext when function matches a known pattern", async () => {
      const patternContent = `
function makeDeps(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return { stderr: () => {}, now: () => Date.now(), ...overrides };
}
      `.trim();

      // Build a minimal index with a makeDeps pattern entry
      const mockIndex = {
        version: 1,
        root: PAI_HOOKS_ROOT,
        builtAt: new Date().toISOString(),
        fileCount: 3,
        functionCount: 3,
        entries: [],
        hashGroups: [],
        nameGroups: [],
        sigGroups: [],
        patterns: [
          {
            id: "makeDeps-abc123",
            name: "makeDeps",
            sig: "(Partial<*>)→Record<*,*>",
            tier: 1 as const,
            fileCount: 10,
            files: ["a.test.ts", "b.test.ts", "c.test.ts"],
          },
        ],
      };
      const mockIndexJson = JSON.stringify(mockIndex);

      const stderrMessages: string[] = [];
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        readFile: (path) => (path.endsWith("index.json") ? mockIndexJson : null),
        exists: (path) => path.endsWith("index.json"),
        stderr: (msg) => stderrMessages.push(msg),
      };

      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/DuplicationDetection/SomeNewHook.ts`,
        patternContent,
      );
      const output = unwrap(await DuplicationCheckerContract.execute(input, deps));
      expect(output.continue).toBe(true);
      const hs = output.hookSpecificOutput;
      expect(hs?.hookEventName).toBe("PreToolUse");
      if (hs && hs.hookEventName === "PreToolUse") {
        expect(hs.additionalContext).toBeDefined();
        expect(hs.additionalContext).toContain("Pattern detected");
        expect(hs.additionalContext).toContain("makeDeps");
      }
    });

    test("no pattern advisory for unique function names", async () => {
      const uniqueContent = `
function superUniqueSpecialFunction123(): string {
  return "unique";
}
      `.trim();

      // Same mock index with patterns — but no pattern matches the unique function name
      const mockIndex = {
        version: 1,
        root: PAI_HOOKS_ROOT,
        builtAt: new Date().toISOString(),
        fileCount: 3,
        functionCount: 3,
        entries: [],
        hashGroups: [],
        nameGroups: [],
        sigGroups: [],
        patterns: [
          {
            id: "makeDeps-abc123",
            name: "makeDeps",
            sig: "(Partial<*>)→Record<*,*>",
            tier: 1 as const,
            fileCount: 10,
            files: ["a.test.ts", "b.test.ts", "c.test.ts"],
          },
        ],
      };
      const mockIndexJson = JSON.stringify(mockIndex);

      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        readFile: (path) => (path.endsWith("index.json") ? mockIndexJson : null),
        exists: (path) => path.endsWith("index.json"),
      };
      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/DuplicationDetection/SomeNewHook.ts`,
        uniqueContent,
      );
      const output = unwrap(await DuplicationCheckerContract.execute(input, deps));
      expect(output.continue).toBe(true);
      expect(output.hookSpecificOutput).toBeUndefined();
    });

    test("continues instead of blocking when blocking config is false", async () => {
      const realContent = require("node:fs").readFileSync(
        `${PAI_HOOKS_ROOT}/cli/commands/install.test.ts`,
        "utf-8",
      ) as string;

      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        blocking: false,
      };

      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/DuplicationDetection/SomeNewHook.ts`,
        realContent,
      );
      const output = unwrap(await DuplicationCheckerContract.execute(input, deps));
      expect(output.continue).toBe(true);
    });
  });

  // ─── false-positive triage ──────────────────────────────────────────────────

  describe("false-positive triage", () => {
    function makeBlockingInput() {
      const realContent = require("node:fs").readFileSync(
        `${PAI_HOOKS_ROOT}/cli/commands/install.test.ts`,
        "utf-8",
      ) as string;
      return {
        input: makeWriteInput(
          `${PAI_HOOKS_ROOT}/hooks/DuplicationDetection/SomeNewHook.ts`,
          realContent,
        ),
      };
    }

    test("inferenceEnabled false — still blocks on duplicate match", async () => {
      const { input } = makeBlockingInput();
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        inferenceEnabled: false,
      };
      const output = unwrap(await DuplicationCheckerContract.execute(input, deps));
      const hs = output.hookSpecificOutput;
      expect(hs?.hookEventName).toBe("PreToolUse");
      if (hs && hs.hookEventName === "PreToolUse") {
        expect(hs.permissionDecision).toBe("deny");
      }
    });

    test("false_positive verdict — returns continue with additionalContext", async () => {
      const { input } = makeBlockingInput();
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        inferenceEnabled: true,
        inference: async (): Promise<InferenceResult> => ({
          success: true,
          output: JSON.stringify({ verdict: "false_positive", reason: "distinct purpose" }),
          latencyMs: 50,
          level: "fast" as const,
        }),
      };
      const output = unwrap(await DuplicationCheckerContract.execute(input, deps));
      expect(output.continue).toBe(true);
      const hs = output.hookSpecificOutput;
      expect(hs?.hookEventName).toBe("PreToolUse");
      if (hs && hs.hookEventName === "PreToolUse") {
        expect(hs.permissionDecision).toBeUndefined();
        expect(hs.additionalContext).toContain("false positive");
      }
    });

    test("true_positive verdict — blocks with deny", async () => {
      const { input } = makeBlockingInput();
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        inferenceEnabled: true,
        inference: async (): Promise<InferenceResult> => ({
          success: true,
          output: JSON.stringify({ verdict: "true_positive", reason: "exact duplicate" }),
          latencyMs: 50,
          level: "fast" as const,
        }),
      };
      const output = unwrap(await DuplicationCheckerContract.execute(input, deps));
      const hs = output.hookSpecificOutput;
      expect(hs?.hookEventName).toBe("PreToolUse");
      if (hs && hs.hookEventName === "PreToolUse") {
        expect(hs.permissionDecision).toBe("deny");
      }
    });

    test("inference failure — fails safe with deny", async () => {
      const { input } = makeBlockingInput();
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        inferenceEnabled: true,
        inference: async (): Promise<InferenceResult> => {
          throw new Error("inference service unavailable");
        },
      };
      const output = unwrap(await DuplicationCheckerContract.execute(input, deps));
      const hs = output.hookSpecificOutput;
      expect(hs?.hookEventName).toBe("PreToolUse");
      if (hs && hs.hookEventName === "PreToolUse") {
        expect(hs.permissionDecision).toBe("deny");
      }
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
    expect(
      DuplicationCheckerContract.defaultDeps.readFile("/tmp/pai-nonexistent-dc.ts"),
    ).toBeNull();
  });

  test("defaultDeps.exists returns false for missing path", () => {
    expect(DuplicationCheckerContract.defaultDeps.exists("/tmp/pai-nonexistent-dc-idx.json")).toBe(
      false,
    );
  });

  test("defaultDeps.appendFile does not throw", () => {
    const tmpPath = `/tmp/pai-test-dc-append-${Date.now()}.jsonl`;
    expect(() =>
      DuplicationCheckerContract.defaultDeps.appendFile(tmpPath, "test\n"),
    ).not.toThrow();
  });

  test("defaultDeps.ensureDir does not throw", () => {
    expect(() => DuplicationCheckerContract.defaultDeps.ensureDir("/tmp")).not.toThrow();
  });

  test("defaultDeps.stderr writes without throwing", () => {
    expect(() => DuplicationCheckerContract.defaultDeps.stderr("test")).not.toThrow();
  });
});
