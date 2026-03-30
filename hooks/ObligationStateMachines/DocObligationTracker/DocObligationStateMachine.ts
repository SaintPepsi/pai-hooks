/**
 * DocObligationStateMachine — Two cooperating contracts for documentation enforcement.
 *
 * DocObligationTracker (PostToolUse): When Edit/Write touches a code file
 * (not test files, not docs, not non-code files), sets a docs-pending flag.
 * When Edit/Write touches a .md file, clears related pending code files
 * in the same directory subtree.
 *
 * DocObligationEnforcer (Stop): If the docs-pending flag still exists
 * when the session ends, blocks with a warning reminding the AI to
 * update related documentation.
 */

import { dirname, join } from "node:path";
import {
  fileExists as fsFileExists,
  readDir as fsReadDir,
  readFile,
  removeFile,
  writeFile,
} from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { isScorableFile } from "@hooks/core/language-profiles";
import { ok, type Result } from "@hooks/core/result";
import type { StopInput, ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getPaiDir } from "@hooks/lib/paths";
import { getFilePath } from "@hooks/lib/tool-input";
import { continueOk } from "@hooks/core/types/hook-outputs";
import type { BlockOutput, ContinueOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import { pickNarrative } from "@hooks/lib/narrative-reader";

// ─── Project Hook Deduplication ──────────────────────────────────────────────

export function projectHasHook(
  name: string,
  dirExists: (path: string) => boolean = fsFileExists,
  listDir: (path: string) => Result<string[], PaiError> = fsReadDir,
): boolean {
  const hookDir = join(process.cwd(), ".claude", "hooks");
  if (!dirExists(hookDir)) return false;
  const result = listDir(hookDir);
  if (!result.ok) return false;
  return result.value.some((f) => f.startsWith(`${name}.hook.`));
}

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_FILE_PATTERNS = [/\.test\.\w+$/, /\.spec\.\w+$/, /__tests__\//];

function isDocFile(filePath: string): boolean {
  return filePath.endsWith(".md") || filePath.endsWith(".mdx");
}

function isNonTestCodeFile(filePath: string): boolean {
  if (!isScorableFile(filePath)) return false;
  return !TEST_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/** Check if a code file is "related" to a doc file by directory proximity. */
function isRelatedDoc(docPath: string, codePath: string): boolean {
  const docDir = dirname(docPath);
  const codeDir = dirname(codePath);
  // Doc in same directory or a subdirectory of the code's directory
  return codeDir.startsWith(docDir) || docDir.startsWith(codeDir);
}

function pendingPath(stateDir: string, sessionId: string): string {
  return join(stateDir, `docs-pending-${sessionId}.json`);
}

function blockCountPath(stateDir: string, sessionId: string): string {
  return join(stateDir, `docs-block-count-${sessionId}.txt`);
}

const MAX_BLOCKS = 1;

function buildBlockLimitReview(pendingFiles: string[], blockCount: number): string {
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

// ─── Default Deps ────────────────────────────────────────────────────────────

function getStateDir(): string {
  const paiDir = getPaiDir();
  return join(paiDir, "MEMORY", "STATE", "doc-obligation");
}

const defaultDeps: DocObligationDeps = {
  stateDir: getStateDir(),
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
    return Number.isNaN(n) ? 0 : n;
  },
  writeBlockCount: (path: string, count: number) => {
    writeFile(path, String(count));
  },
  writeReview: (path: string, content: string) => {
    writeFile(path, content);
  },
  stderr: (msg) => process.stderr.write(`${msg}\n`),
};

// ─── Contract 1: DocObligationTracker ────────────────────────────────────────

export const DocObligationTracker: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  DocObligationDeps
> = {
  name: "DocObligationTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (projectHasHook("DocObligationTracker")) return false;
    if (input.tool_name !== "Edit" && input.tool_name !== "Write") return false;
    const filePath = getFilePath(input);
    if (!filePath) return false;
    // Accept doc files (for clearing) and non-test code files (for tracking)
    return isDocFile(filePath) || isNonTestCodeFile(filePath);
  },

  execute(input: ToolHookInput, deps: DocObligationDeps): Result<ContinueOutput, PaiError> {
    const filePath = getFilePath(input);
    if (!filePath) {
      return ok(continueOk());
    }

    const flagFile = pendingPath(deps.stateDir, input.session_id);

    // .md file edit: clear related pending code files
    if (isDocFile(filePath)) {
      if (!deps.fileExists(flagFile)) {
        return ok(continueOk());
      }

      const pending = deps.readPending(flagFile);
      const remaining = pending.filter((p) => !isRelatedDoc(filePath, p));

      if (remaining.length === 0) {
        deps.removeFlag(flagFile);
        deps.stderr("[DocObligationTracker] All pending files documented — clearing flag");
      } else {
        deps.writePending(flagFile, remaining);
        deps.stderr(
          `[DocObligationTracker] Cleared documented files, ${remaining.length} still pending`,
        );
      }

      return ok(continueOk());
    }

    // Code file edit: add to pending list
    const pending = deps.readPending(flagFile);
    if (!pending.includes(filePath)) {
      pending.push(filePath);
    }
    deps.writePending(flagFile, pending);
    deps.stderr(`[DocObligationTracker] Code modified: ${filePath} — docs pending`);

    return ok(continueOk());
  },

  defaultDeps,
};

// ─── Doc Suggestion Logic ────────────────────────────────────────────────────

const DOC_FILENAMES = ["README.md", "CHANGELOG.md", "ARCHITECTURE.md", "DESIGN.md", "SKILL.md"];

function findExistingDoc(dir: string, deps: DocObligationDeps): string | null {
  for (const name of DOC_FILENAMES) {
    const docPath = join(dir, name);
    if (deps.fileExists(docPath)) return docPath;
  }
  return null;
}

function buildDocSuggestions(pending: string[], deps: DocObligationDeps): string {
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

  return `${lines.join("\n")}\n`;
}

// ─── Contract 2: DocObligationEnforcer ───────────────────────────────────────

export const DocObligationEnforcer: SyncHookContract<
  StopInput,
  BlockOutput | SilentOutput,
  DocObligationDeps
> = {
  name: "DocObligationEnforcer",
  event: "Stop",

  accepts(_input: StopInput): boolean {
    if (projectHasHook("DocObligationEnforcer")) return false;
    return true;
  },

  execute(input: StopInput, deps: DocObligationDeps): Result<BlockOutput | SilentOutput, PaiError> {
    const flagFile = pendingPath(deps.stateDir, input.session_id);

    if (!deps.fileExists(flagFile)) {
      return ok({ type: "silent" });
    }

    const pending = deps.readPending(flagFile);
    if (pending.length === 0) {
      return ok({ type: "silent" });
    }

    // Block limit: after MAX_BLOCKS attempts, write review and release
    const countFile = blockCountPath(deps.stateDir, input.session_id);
    const blockCount = deps.readBlockCount(countFile);

    if (blockCount >= MAX_BLOCKS) {
      const reviewPath = join(deps.stateDir, `review-${input.session_id}.md`);
      deps.writeReview(reviewPath, buildBlockLimitReview(pending, blockCount));
      deps.removeFlag(flagFile);
      deps.removeFlag(countFile);
      deps.stderr(
        `[DocObligationEnforcer] Block limit (${MAX_BLOCKS}) reached for ${pending.length} file(s). Review written. Releasing session.`,
      );
      return ok({ type: "silent" });
    }

    const opener = pickNarrative("DocObligationEnforcer", pending.length, join(import.meta.dir, "../DocObligationEnforcer"));
    const fileList = pending.map((f) => `  - ${f}`).join("\n");
    const suggestions = buildDocSuggestions(pending, deps);
    const reason = `${opener}\n\nModified files without documentation updates:\n${fileList}\n\n${suggestions}`;

    deps.writeBlockCount(countFile, blockCount + 1);
    deps.stderr(
      `[DocObligationEnforcer] Block ${blockCount + 1}/${MAX_BLOCKS}: ${pending.length} file(s) modified without documentation updates`,
    );

    return ok({ type: "block", decision: "block", reason });
  },

  defaultDeps,
};
