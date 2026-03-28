import { describe, test, expect } from "bun:test";
import {
  DuplicationIndexBuilderContract,
  type DuplicationIndexBuilderDeps,
} from "@hooks/hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.contract";
import type { IndexBuilderDeps } from "@hooks/hooks/DuplicationDetection/index-builder-logic";
import { defaultParserDeps } from "@hooks/hooks/DuplicationDetection/parser";
import {
  readFile as adapterReadFile,
  writeFile as adapterWriteFile,
  fileExists,
  stat as adapterStat,
  readDir as adapterReadDir,
} from "@hooks/core/adapters/fs";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import type { Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import type { DuplicationIndex } from "@hooks/hooks/DuplicationDetection/shared";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAI_HOOKS_ROOT = "/Users/hogers/.claude/pai-hooks";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(toolName: string, filePath: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: toolName,
    tool_input: { file_path: filePath },
  };
}

function makeWriteInput(filePath: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Write",
    tool_input: { file_path: filePath, content: "" },
  };
}

function makeEditInput(filePath: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: "a", new_string: "b" },
  };
}

function unwrap(result: Result<ContinueOutput, PaiError>): ContinueOutput {
  if (!result.ok) throw new Error(`Result not ok: ${result.error.message}`);
  return result.value;
}

// ─── Real-fs IndexBuilderDeps (via adapters) ──────────────────────────────────

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
    join: (...parts: string[]): string => require("path").join(...parts) as string,
    resolve: (path: string): string => require("path").resolve(path) as string,
    parserDeps: defaultParserDeps,
  };
}

// ─── Mock Deps Builder ────────────────────────────────────────────────────────

function makeMockDeps(overrides: Partial<DuplicationIndexBuilderDeps> = {}): DuplicationIndexBuilderDeps {
  const writtenFiles = new Map<string, string>();
  return {
    indexBuilderDeps: makeRealIndexBuilderDeps(),
    writeFile: (path: string, content: string): boolean => {
      writtenFiles.set(path, content);
      return true;
    },
    exists: (path: string): boolean => writtenFiles.has(path),
    stat: (path: string): { mtimeMs: number } | null =>
      writtenFiles.has(path) ? { mtimeMs: Date.now() } : null,
    stderr: (): void => {},
    now: (): number => Date.now(),
    findProjectRoot: (): string => PAI_HOOKS_ROOT,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DuplicationIndexBuilderContract", () => {

  // ─── accepts() ────────────────────────────────────────────────────────────

  describe("accepts()", () => {
    test("returns false for non-Write/Edit tools", () => {
      expect(DuplicationIndexBuilderContract.accepts(makeInput("Read", "/src/app.ts"))).toBe(false);
      expect(DuplicationIndexBuilderContract.accepts(makeInput("Bash", "/src/app.ts"))).toBe(false);
      expect(DuplicationIndexBuilderContract.accepts(makeInput("Glob", "/src/app.ts"))).toBe(false);
    });

    test("returns false for non-.ts files", () => {
      expect(DuplicationIndexBuilderContract.accepts(makeWriteInput("/src/app.js"))).toBe(false);
      expect(DuplicationIndexBuilderContract.accepts(makeWriteInput("/src/style.css"))).toBe(false);
      expect(DuplicationIndexBuilderContract.accepts(makeWriteInput("/src/README.md"))).toBe(false);
    });

    test("returns true for Write to .ts file", () => {
      expect(DuplicationIndexBuilderContract.accepts(makeWriteInput("/src/app.ts"))).toBe(true);
    });

    test("returns true for Edit to .ts file", () => {
      expect(DuplicationIndexBuilderContract.accepts(makeEditInput("/src/app.ts"))).toBe(true);
    });
  });

  // ─── execute() ────────────────────────────────────────────────────────────

  describe("execute()", () => {
    test("builds index when none exists", () => {
      const tempPath = `/tmp/test-dup-index-builder-${Date.now()}.json`;
      const writtenFiles = new Map<string, string>();

      const deps = makeMockDeps({
        writeFile: (path: string, content: string): boolean => {
          writtenFiles.set(path, content);
          const writeResult = adapterWriteFile(path, content);
          return writeResult.ok;
        },
        exists: (path: string): boolean => writtenFiles.has(path),
        stat: (): null => null,
        findProjectRoot: (): string => PAI_HOOKS_ROOT,
        indexBuilderDeps: {
          ...makeRealIndexBuilderDeps(),
          join: (...parts: string[]): string => {
            const joined = require("path").join(...parts) as string;
            if (joined.endsWith(".duplication-index.json")) return tempPath;
            return joined;
          },
        },
      });

      const input = makeWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
      const output = unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      expect(output.continue).toBe(true);
      expect(writtenFiles.has(tempPath)).toBe(true);
    });

    test("skips rebuild when index is fresh", () => {
      const writeCallCount = { count: 0 };

      const deps = makeMockDeps({
        writeFile: (): boolean => {
          writeCallCount.count++;
          return true;
        },
        exists: (): boolean => true,
        stat: (): { mtimeMs: number } => ({ mtimeMs: Date.now() - 60_000 }), // 1 min ago — fresh
        now: (): number => Date.now(),
      });

      const input = makeWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
      unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      expect(writeCallCount.count).toBe(0);
    });

    test("returns continue with no additionalContext (notification hook)", () => {
      const deps = makeMockDeps({
        stat: (): null => null,
      });

      const input = makeWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
      const output = unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      expect(output.continue).toBe(true);
      expect((output as unknown as Record<string, unknown>).additionalContext).toBeUndefined();
    });

    test("handles missing project root gracefully", () => {
      const stderrMessages: string[] = [];

      const deps = makeMockDeps({
        findProjectRoot: (): null => null,
        stderr: (msg: string): void => { stderrMessages.push(msg); },
      });

      const input = makeWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
      const output = unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      expect(output.continue).toBe(true);
      expect(stderrMessages.some((m) => m.includes("No project root"))).toBe(true);
    });

    test("built index contains expected fields", () => {
      const tempPath = `/tmp/test-dup-index-builder-${Date.now()}.json`;
      let capturedContent = "";

      const deps = makeMockDeps({
        writeFile: (path: string, content: string): boolean => {
          capturedContent = content;
          return true;
        },
        exists: (): boolean => false,
        stat: (): null => null,
        findProjectRoot: (): string => PAI_HOOKS_ROOT,
        indexBuilderDeps: {
          ...makeRealIndexBuilderDeps(),
          join: (...parts: string[]): string => {
            const joined = require("path").join(...parts) as string;
            if (joined.endsWith(".duplication-index.json")) return tempPath;
            return joined;
          },
        },
      });

      const input = makeWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
      unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      expect(capturedContent.length).toBeGreaterThan(0);

      const index = JSON.parse(capturedContent) as DuplicationIndex;
      expect(typeof index.version).toBe("number");
      expect(typeof index.root).toBe("string");
      expect(typeof index.builtAt).toBe("string");
      expect(Array.isArray(index.entries)).toBe(true);
      expect(Array.isArray(index.hashGroups)).toBe(true);
      expect(Array.isArray(index.nameGroups)).toBe(true);
      expect(Array.isArray(index.sigGroups)).toBe(true);
    });

    test("built index has >0 functions and >0 files", () => {
      const tempPath = `/tmp/test-dup-index-builder-${Date.now()}.json`;
      let capturedContent = "";

      const deps = makeMockDeps({
        writeFile: (path: string, content: string): boolean => {
          capturedContent = content;
          return true;
        },
        exists: (): boolean => false,
        stat: (): null => null,
        findProjectRoot: (): string => PAI_HOOKS_ROOT,
        indexBuilderDeps: {
          ...makeRealIndexBuilderDeps(),
          join: (...parts: string[]): string => {
            const joined = require("path").join(...parts) as string;
            if (joined.endsWith(".duplication-index.json")) return tempPath;
            return joined;
          },
        },
      });

      const input = makeWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
      unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      const index = JSON.parse(capturedContent) as DuplicationIndex;
      expect(index.functionCount).toBeGreaterThan(0);
      expect(index.fileCount).toBeGreaterThan(0);
      expect(index.entries.length).toBeGreaterThan(0);
    });
  });
});
