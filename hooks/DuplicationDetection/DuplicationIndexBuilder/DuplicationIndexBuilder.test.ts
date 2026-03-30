import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  readDir as adapterReadDir,
  readFile as adapterReadFile,
  stat as adapterStat,
  writeFile as adapterWriteFile,
  fileExists,
} from "@hooks/core/adapters/fs";
import type { PaiError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { SessionStartInput, ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import {
  DuplicationIndexBuilderContract,
  type DuplicationIndexBuilderDeps,
} from "@hooks/hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.contract";
import type { IndexBuilderDeps } from "@hooks/hooks/DuplicationDetection/index-builder-logic";
import { defaultParserDeps } from "@hooks/hooks/DuplicationDetection/parser";
import type { DuplicationIndex } from "@hooks/hooks/DuplicationDetection/shared";

// ─── Constants ────────────────────────────────────────────────────────────────

// Derive project root from this file's location (4 levels up from DuplicationIndexBuilder/)
const PAI_HOOKS_ROOT = resolve(import.meta.dir, "../../../..");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function indexBuilderToolInput(toolName: string, filePath: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: toolName,
    tool_input: { file_path: filePath },
  };
}

function indexBuilderWriteInput(filePath: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Write",
    tool_input: { file_path: filePath, content: "" },
  };
}

function indexBuilderEditInput(filePath: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: "a", new_string: "b" },
  };
}

function indexBuilderSessionStartInput(): SessionStartInput {
  return { session_id: "test-sess" };
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
    join: (...parts: string[]): string => require("node:path").join(...parts) as string,
    resolve: (path: string): string => require("node:path").resolve(path) as string,
    parserDeps: defaultParserDeps,
  };
}

// ─── Mock Deps Builder ────────────────────────────────────────────────────────

function makeMockDeps(
  overrides: Partial<DuplicationIndexBuilderDeps> = {},
): DuplicationIndexBuilderDeps {
  const writtenFiles = new Map<string, string>();
  return {
    indexBuilderDeps: makeRealIndexBuilderDeps(),
    writeFile: (path: string, content: string): boolean => {
      writtenFiles.set(path, content);
      return true;
    },
    readFile: (path: string): string | null => writtenFiles.get(path) ?? null,
    exists: (path: string): boolean => writtenFiles.has(path),
    stat: (path: string): { mtimeMs: number } | null =>
      writtenFiles.has(path) ? { mtimeMs: Date.now() } : null,
    stderr: (): void => {},
    now: (): number => Date.now(),
    findProjectRoot: (): string => PAI_HOOKS_ROOT,
    cwd: (): string => PAI_HOOKS_ROOT,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DuplicationIndexBuilderContract", () => {
  // ─── accepts() ────────────────────────────────────────────────────────────

  describe("accepts()", () => {
    test("returns false for non-Write/Edit tools", () => {
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderToolInput("Read", "/src/app.ts"))).toBe(false);
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderToolInput("Bash", "/src/app.ts"))).toBe(false);
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderToolInput("Glob", "/src/app.ts"))).toBe(false);
    });

    test("returns false for non-.ts files", () => {
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderWriteInput("/src/app.js"))).toBe(false);
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderWriteInput("/src/style.css"))).toBe(false);
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderWriteInput("/src/README.md"))).toBe(false);
    });

    test("returns true for Write to .ts file", () => {
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderWriteInput("/src/app.ts"))).toBe(true);
    });

    test("returns true for Edit to .ts file", () => {
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderEditInput("/src/app.ts"))).toBe(true);
    });

    test("returns true for SessionStart input", () => {
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderSessionStartInput())).toBe(true);
    });

    test("returns false for .d.ts files", () => {
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderWriteInput("/src/types.d.ts"))).toBe(false);
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderEditInput("/src/global.d.ts"))).toBe(false);
    });

    test("returns false when file_path is missing from tool_input", () => {
      const input: ToolHookInput = {
        session_id: "test-sess",
        tool_name: "Write",
        tool_input: { content: "hello" },
      };
      expect(DuplicationIndexBuilderContract.accepts(input)).toBe(false);
    });

    test("returns false for Edit to non-.ts file", () => {
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderEditInput("/src/style.css"))).toBe(false);
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderEditInput("/src/app.js"))).toBe(false);
      expect(DuplicationIndexBuilderContract.accepts(indexBuilderEditInput("/README.md"))).toBe(false);
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
            const joined = require("node:path").join(...parts) as string;
            if (joined.endsWith("index.json")) return tempPath;
            return joined;
          },
        },
      });

      const input = indexBuilderWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
      const output = unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      expect(output.continue).toBe(true);
      expect(writtenFiles.has(tempPath)).toBe(true);
    });

    test("does surgical update when index already exists", () => {
      // First build — full
      const deps = makeMockDeps();
      const input1 = indexBuilderWriteInput(`${PAI_HOOKS_ROOT}/hooks/DuplicationDetection/shared.ts`);
      unwrap(DuplicationIndexBuilderContract.execute(input1, deps));

      // Second build — surgical (existing index readable via deps.readFile)
      const stderrMessages: string[] = [];
      const deps2 = makeMockDeps({
        ...deps,
        stderr: (msg: string): void => { stderrMessages.push(msg); },
        readFile: deps.readFile,
      });
      // Re-use the written files from first build
      Object.assign(deps2, { readFile: deps.readFile });
      const input2 = indexBuilderWriteInput(`${PAI_HOOKS_ROOT}/hooks/DuplicationDetection/shared.ts`);
      unwrap(DuplicationIndexBuilderContract.execute(input2, deps2));

      expect(stderrMessages.some((m) => m.includes("updated index"))).toBe(true);
    });

    test("returns continue with no additionalContext (notification hook)", () => {
      const deps = makeMockDeps({
        stat: (): null => null,
      });

      const input = indexBuilderWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
      const output = unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      expect(output.continue).toBe(true);
      expect((output as unknown as Record<string, unknown>).additionalContext).toBeUndefined();
    });

    test("handles missing project root gracefully", () => {
      const stderrMessages: string[] = [];

      const deps = makeMockDeps({
        findProjectRoot: (): null => null,
        stderr: (msg: string): void => {
          stderrMessages.push(msg);
        },
      });

      const input = indexBuilderWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
      const output = unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      expect(output.continue).toBe(true);
      expect(stderrMessages.some((m) => m.includes("No project root"))).toBe(true);
    });

    test("built index contains expected fields", () => {
      const tempPath = `/tmp/test-dup-index-builder-${Date.now()}.json`;
      let capturedContent = "";

      const deps = makeMockDeps({
        writeFile: (_path: string, content: string): boolean => {
          capturedContent = content;
          return true;
        },
        exists: (): boolean => false,
        stat: (): null => null,
        findProjectRoot: (): string => PAI_HOOKS_ROOT,
        indexBuilderDeps: {
          ...makeRealIndexBuilderDeps(),
          join: (...parts: string[]): string => {
            const joined = require("node:path").join(...parts) as string;
            if (joined.endsWith("index.json")) return tempPath;
            return joined;
          },
        },
      });

      const input = indexBuilderWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
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

    test("skips write when buildIndex returns zero functions", () => {
      const stderrMessages: string[] = [];
      const writeCallCount = { count: 0 };

      const deps = makeMockDeps({
        writeFile: (): boolean => {
          writeCallCount.count++;
          return true;
        },
        exists: (): boolean => false,
        stat: (): null => null,
        stderr: (msg: string): void => {
          stderrMessages.push(msg);
        },
        findProjectRoot: (): string => "/tmp/empty-project",
        indexBuilderDeps: {
          ...makeRealIndexBuilderDeps(),
          readDir: (): string[] => [], // no files found
        },
      });

      const input = indexBuilderWriteInput("/tmp/empty-project/src/app.ts");
      const output = unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      expect(output.continue).toBe(true);
      expect(writeCallCount.count).toBe(0);
      expect(stderrMessages.some((m) => m.includes("No functions found"))).toBe(true);
    });

    test("logs failure when writeFile returns false", () => {
      const stderrMessages: string[] = [];

      const deps = makeMockDeps({
        writeFile: (): boolean => false,
        exists: (): boolean => false,
        stat: (): null => null,
        stderr: (msg: string): void => {
          stderrMessages.push(msg);
        },
        findProjectRoot: (): string => PAI_HOOKS_ROOT,
      });

      const input = indexBuilderWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
      const output = unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      expect(output.continue).toBe(true);
      expect(stderrMessages.some((m) => m.includes("Failed to write index"))).toBe(true);
    });

    test("logs success stats when write succeeds", () => {
      const stderrMessages: string[] = [];

      const deps = makeMockDeps({
        exists: (): boolean => false,
        stat: (): null => null,
        stderr: (msg: string): void => {
          stderrMessages.push(msg);
        },
        findProjectRoot: (): string => PAI_HOOKS_ROOT,
      });

      const input = indexBuilderWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
      unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      const successMsg = stderrMessages.find((m) => m.includes("built index:"));
      expect(successMsg).toBeDefined();
      expect(successMsg).toContain("functions from");
      expect(successMsg).toContain("files");
      expect(successMsg).toContain("KB");
    });

    test("works correctly with Edit tool input", () => {
      const stderrMessages: string[] = [];

      const deps = makeMockDeps({
        exists: (): boolean => false,
        stat: (): null => null,
        stderr: (msg: string): void => {
          stderrMessages.push(msg);
        },
        findProjectRoot: (): string => PAI_HOOKS_ROOT,
      });

      const input = indexBuilderEditInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
      const output = unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      expect(output.continue).toBe(true);
      expect(stderrMessages.some((m) => m.includes("built index:"))).toBe(true);
    });

    test("built index has >0 functions and >0 files", () => {
      const tempPath = `/tmp/test-dup-index-builder-${Date.now()}.json`;
      let capturedContent = "";

      const deps = makeMockDeps({
        writeFile: (_path: string, content: string): boolean => {
          capturedContent = content;
          return true;
        },
        exists: (): boolean => false,
        stat: (): null => null,
        findProjectRoot: (): string => PAI_HOOKS_ROOT,
        indexBuilderDeps: {
          ...makeRealIndexBuilderDeps(),
          join: (...parts: string[]): string => {
            const joined = require("node:path").join(...parts) as string;
            if (joined.endsWith("index.json")) return tempPath;
            return joined;
          },
        },
      });

      const input = indexBuilderWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`);
      unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      const index = JSON.parse(capturedContent) as DuplicationIndex;
      expect(index.functionCount).toBeGreaterThan(0);
      expect(index.fileCount).toBeGreaterThan(0);
      expect(index.entries.length).toBeGreaterThan(0);
    });
  });

  // ─── SessionStart ─────────────────────────────────────────────────────────

  describe("SessionStart", () => {
    test("builds index using CWD as anchor", () => {
      const tempPath = `/tmp/test-dup-index-builder-session-${Date.now()}.json`;
      const writtenFiles = new Map<string, string>();

      const deps = makeMockDeps({
        writeFile: (path: string, content: string): boolean => {
          writtenFiles.set(path, content);
          return true;
        },
        exists: (path: string): boolean => writtenFiles.has(path),
        stat: (): null => null,
        cwd: (): string => PAI_HOOKS_ROOT,
        findProjectRoot: (): string => PAI_HOOKS_ROOT,
        indexBuilderDeps: {
          ...makeRealIndexBuilderDeps(),
          join: (...parts: string[]): string => {
            const joined = require("node:path").join(...parts) as string;
            if (joined.endsWith("index.json")) return tempPath;
            return joined;
          },
        },
      });

      const input = indexBuilderSessionStartInput();
      const output = unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      expect(output.continue).toBe(true);
      expect(writtenFiles.has(tempPath)).toBe(true);
    });

    test("always does full rebuild on SessionStart (no surgical update)", () => {
      const stderrMessages: string[] = [];

      const deps = makeMockDeps({
        stderr: (msg: string): void => { stderrMessages.push(msg); },
        cwd: (): string => PAI_HOOKS_ROOT,
      });

      const input = indexBuilderSessionStartInput();
      unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      // SessionStart has no specific file, so it always does a full build
      expect(stderrMessages.some((m) => m.includes("built index"))).toBe(true);
    });

    test("handles missing project root on SessionStart", () => {
      const stderrMessages: string[] = [];

      const deps = makeMockDeps({
        findProjectRoot: (): null => null,
        cwd: (): string => "/tmp/no-project-here",
        stderr: (msg: string): void => {
          stderrMessages.push(msg);
        },
      });

      const input = indexBuilderSessionStartInput();
      const output = unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      expect(output.continue).toBe(true);
      expect(stderrMessages.some((m) => m.includes("No project root"))).toBe(true);
    });
  });
});
