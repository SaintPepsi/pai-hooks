/**
 * DocObligationStateMachine — Shared types, helpers, default deps, and projectHasHook.
 * Used by DocObligationTracker, DocObligationEnforcer, and SpotCheckReview.
 */

import { writeFile, readFile, fileExists as fsFileExists, removeFile, readDir as fsReadDir } from "@hooks/core/adapters/fs";
import { isScorableFile } from "@hooks/core/language-profiles";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { join, dirname } from "path";

// ─── Project Hook Deduplication ───────────────────────────────────────────────

export function projectHasHook(
  name: string,
  cwd: string = process.cwd(),
  dirExists: (path: string) => boolean = fsFileExists,
  listDir: (path: string) => Result<string[], PaiError> = fsReadDir,
): boolean {
  const hookDir = join(cwd, ".claude", "hooks");
  if (!dirExists(hookDir)) return false;
  const result = listDir(hookDir);
  if (!result.ok) return false;
  return result.value.some((f) => f.startsWith(`${name}.hook.`));
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocObligationDeps {
  stateDir: string;
  fileExists: (path: string) => boolean;
  readPending: (path: string) => string[];
  writePending: (path: string, files: string[]) => void;
  removeFlag: (path: string) => void;
  readBlockCount: (path: string) => number;
  writeBlockCount: (path: string, count: number) => void;
  writeReview: (path: string, content: string) => void;
  stderr: (msg: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_FILE_PATTERNS = [/\.test\.\w+$/, /\.spec\.\w+$/, /__tests__\//];

export function isDocFile(filePath: string): boolean {
  return filePath.endsWith(".md") || filePath.endsWith(".mdx");
}

export function isNonTestCodeFile(filePath: string): boolean {
  if (!isScorableFile(filePath)) return false;
  return !TEST_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/** Check if a code file is "related" to a doc file by directory proximity. */
export function isRelatedDoc(docPath: string, codePath: string): boolean {
  const docDir = dirname(docPath);
  const codeDir = dirname(codePath);
  return codeDir.startsWith(docDir) || docDir.startsWith(codeDir);
}

export function getFilePath(input: ToolHookInput): string | null {
  if (typeof input.tool_input !== "object" || input.tool_input === null) return null;
  return (input.tool_input as Record<string, unknown>).file_path as string ?? null;
}

export function pendingPath(stateDir: string, sessionId: string): string {
  return join(stateDir, `docs-pending-${sessionId}.json`);
}

export function blockCountPath(stateDir: string, sessionId: string): string {
  return join(stateDir, `docs-block-count-${sessionId}.txt`);
}

export const MAX_BLOCKS = 1;

export function buildBlockLimitReview(pendingFiles: string[], blockCount: number): string {
  const timestamp = new Date().toISOString();
  const fileList = pendingFiles.map((f) => `- ${f}`).join("\n");
  return `# Doc Obligation Review

**Generated:** ${timestamp}
**Block attempts:** ${blockCount}
**Outcome:** Session released after reaching block limit

## Unresolved Files

${fileList}

## What Happened

The doc obligation enforcer blocked session end ${blockCount} times for the files above.
The AI addressed the concern but did not resolve the pending state (likely because the files
are already documented elsewhere or the obligation was a false positive).

## Action Items

- Review whether these files genuinely need documentation updates
- If not, consider adding them to an exclusion list
`;
}

const DOC_FILENAMES = ["README.md", "CHANGELOG.md", "ARCHITECTURE.md", "DESIGN.md", "SKILL.md"];

export function findExistingDoc(dir: string, deps: DocObligationDeps): string | null {
  for (const name of DOC_FILENAMES) {
    const docPath = join(dir, name);
    if (deps.fileExists(docPath)) return docPath;
  }
  return null;
}

export function buildDocSuggestions(pending: string[], deps: DocObligationDeps): string {
  const dirMap = new Map<string, string[]>();
  for (const file of pending) {
    const dir = dirname(file);
    if (!dirMap.has(dir)) dirMap.set(dir, []);
    dirMap.get(dir)!.push(file);
  }

  const lines: string[] = [];
  for (const [dir] of dirMap) {
    const existingDoc = findExistingDoc(dir, deps);
    if (existingDoc) {
      lines.push(`Update \`${existingDoc}\``);
    } else {
      lines.push(`Create or update documentation in \`${dir}/\``);
    }
  }

  return lines.join("\n") + "\n";
}

// ─── Default Deps ─────────────────────────────────────────────────────────────

function getStateDir(baseDir: string): string {
  return join(baseDir, "MEMORY", "STATE", "doc-obligation");
}

export const defaultDeps: DocObligationDeps = {
  stateDir: getStateDir(process.env.PAI_DIR || join(process.env.HOME!, ".claude")),
  fileExists: (path: string) => fsFileExists(path),
  readPending: (path: string) => {
    const result = readFile(path);
    if (!result.ok) return [];
    const parsed = JSON.parse(result.value);
    return Array.isArray(parsed) ? parsed : [];
  },
  writePending: (path: string, files: string[]) => {
    writeFile(path, JSON.stringify(files));
  },
  removeFlag: (path: string) => {
    removeFile(path);
  },
  readBlockCount: (path: string) => {
    const result = readFile(path);
    if (!result.ok) return 0;
    const n = parseInt(result.value.trim(), 10);
    return isNaN(n) ? 0 : n;
  },
  writeBlockCount: (path: string, count: number) => {
    writeFile(path, String(count));
  },
  writeReview: (path: string, content: string) => {
    writeFile(path, content);
  },
  stderr: (msg) => process.stderr.write(msg + "\n"),
};
