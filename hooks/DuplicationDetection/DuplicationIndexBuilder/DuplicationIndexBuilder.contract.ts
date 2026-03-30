/**
 * DuplicationIndexBuilder Contract — builds the duplication index on PostToolUse
 * (Write/Edit to .ts files) and SessionStart (eager pre-warming).
 *
 * Builds the duplication index (.duplication-index.json) on the first .ts file
 * write in a session, or eagerly at session start. Subsequent triggers skip
 * if the index is fresh (<30 min).
 * No additionalContext — this is a silent background operation.
 */

import {
  readDir as adapterReadDir,
  readFile as adapterReadFile,
  stat as adapterStat,
  writeFile as adapterWriteFile,
  ensureDir,
  fileExists,
} from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { HookInput, ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import type { IndexBuilderDeps } from "@hooks/hooks/DuplicationDetection/index-builder-logic";
import { buildIndex, updateIndexForFile } from "@hooks/hooks/DuplicationDetection/index-builder-logic";
import { defaultParserDeps } from "@hooks/hooks/DuplicationDetection/parser";
import { getFilePath } from "@hooks/lib/tool-input";
import { getArtifactsDir, getCurrentBranch, PROJECT_MARKERS } from "@hooks/hooks/DuplicationDetection/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DuplicationIndexBuilderDeps {
  indexBuilderDeps: IndexBuilderDeps;
  writeFile: (path: string, content: string) => boolean;
  readFile: (path: string) => string | null;
  exists: (path: string) => boolean;
  stat: (path: string) => { mtimeMs: number } | null;
  stderr: (msg: string) => void;
  now: () => number;
  findProjectRoot: (filePath: string) => string | null;
  cwd: () => string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const INDEX_FILENAME = "index.json";

// ─── Helpers ────────────────────────────────────────────────────────────────

function defaultFindProjectRoot(filePath: string): string | null {
  const { dirname, join } = require("node:path");

  // Check if the path itself is a project root (handles directory inputs from SessionStart)
  for (const marker of PROJECT_MARKERS) {
    if (fileExists(join(filePath, marker) as string)) return filePath;
  }

  // Walk up from the parent directory
  let dir = dirname(filePath) as string;
  for (let i = 0; i < 10; i++) {
    for (const marker of PROJECT_MARKERS) {
      if (fileExists(join(dir, marker) as string)) return dir;
    }
    const parent = dirname(dir) as string;
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}


// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: DuplicationIndexBuilderDeps = {
  indexBuilderDeps: {
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
  },
  writeFile: (path: string, content: string): boolean => {
    const result = adapterWriteFile(path, content);
    return result.ok;
  },
  readFile: (path: string): string | null => {
    const result = adapterReadFile(path);
    return result.ok ? result.value : null;
  },
  exists: (path: string): boolean => fileExists(path),
  stat: (path: string): { mtimeMs: number } | null => {
    const result = adapterStat(path);
    return result.ok ? { mtimeMs: result.value.mtimeMs } : null;
  },
  stderr: (msg) => process.stderr.write(`${msg}\n`),
  now: () => Date.now(),
  findProjectRoot: defaultFindProjectRoot,
  cwd: () => process.cwd(),
};

// ─── Contract ───────────────────────────────────────────────────────────────

/** Type guard: true when input came from a tool event (has tool_name). */
function isToolInput(input: HookInput): input is ToolHookInput {
  return "tool_name" in input;
}

export const DuplicationIndexBuilderContract: SyncHookContract<
  HookInput,
  ContinueOutput,
  DuplicationIndexBuilderDeps
> = {
  name: "DuplicationIndexBuilder",
  event: "PostToolUse",

  accepts(input: HookInput): boolean {
    // SessionStart — always accept (eager pre-warming)
    if (!isToolInput(input)) return true;

    // PostToolUse — only Write/Edit on .ts files
    if (input.tool_name !== "Write" && input.tool_name !== "Edit") return false;
    const filePath = getFilePath(input);
    if (!filePath) return false;
    if (!filePath.endsWith(".ts")) return false;
    if (filePath.endsWith(".d.ts")) return false;
    return true;
  },

  execute(
    input: HookInput,
    deps: DuplicationIndexBuilderDeps,
  ): Result<ContinueOutput, PaiError> {
    // SessionStart: use CWD. PostToolUse: use file path from tool input.
    const anchor = isToolInput(input) ? getFilePath(input)! : deps.cwd();
    const projectRoot = deps.findProjectRoot(anchor);
    if (!projectRoot) {
      deps.stderr("[DuplicationIndexBuilder] No project root found — skipping");
      return ok({ type: "continue", continue: true });
    }

    const branch = getCurrentBranch(projectRoot) ?? null;
    const indexDir = getArtifactsDir(projectRoot, branch);
    const indexPath = deps.indexBuilderDeps.join(indexDir, INDEX_FILENAME);

    const start = performance.now();
    let index: ReturnType<typeof buildIndex>;

    // Surgical update: if index exists and we have a specific file, update just that file
    const changedFile = isToolInput(input) ? getFilePath(input) : null;
    const existingJson = deps.readFile(indexPath);

    if (existingJson && changedFile) {
      const existing = JSON.parse(existingJson) as ReturnType<typeof buildIndex>;
      const content = deps.indexBuilderDeps.readFile(changedFile);
      if (content) {
        index = updateIndexForFile(existing, changedFile, content, deps.indexBuilderDeps);
      } else {
        // File was deleted — remove its entries by passing empty content
        index = updateIndexForFile(existing, changedFile, "", deps.indexBuilderDeps);
      }
    } else {
      // No existing index or SessionStart — full rebuild
      index = buildIndex(projectRoot, deps.indexBuilderDeps);
    }

    const buildMs = performance.now() - start;

    if (index.functionCount === 0 && !existingJson) {
      deps.stderr("[DuplicationIndexBuilder] No functions found — skipping");
      return ok({ type: "continue", continue: true });
    }

    // Write the index
    ensureDir(indexDir);
    const json = JSON.stringify(index);
    const written = deps.writeFile(indexPath, json);

    if (written) {
      const mode = existingJson && changedFile ? "updated" : "built";
      const sizeKB = (json.length / 1024).toFixed(1);
      deps.stderr(
        `[DuplicationIndexBuilder] ${mode} index: ${index.functionCount} functions from ${index.fileCount} files (${sizeKB}KB) in ${buildMs.toFixed(0)}ms`,
      );
    } else {
      deps.stderr("[DuplicationIndexBuilder] Failed to write index — continuing without");
    }

    return ok({ type: "continue", continue: true });
  },

  defaultDeps,
};
