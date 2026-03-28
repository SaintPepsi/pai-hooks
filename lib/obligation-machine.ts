/**
 * Generic Obligation State Machine — DRY foundation for Tracker/Enforcer pairs.
 *
 * Extracts the common pattern shared by Doc, Test, and HookDoc obligation hooks:
 *   - Pending file state management (add, clear, read)
 *   - Block count tracking with configurable limits
 *   - Review document generation on limit release
 *   - Default deps factory for consistent I/O wiring
 *
 * Domain-specific logic (what files to watch, what clears the obligation)
 * stays in each hook's shared.ts — this module provides the state machine only.
 */

import { writeFile, readFile, readJson, fileExists as fsFileExists, removeFile } from "@hooks/core/adapters/fs";
import { join } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ObligationDeps {
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

export interface ObligationConfig {
  /** Human-readable name, e.g. "HookDoc", "Doc", "Test" */
  name: string;
  /** Subdirectory under MEMORY/STATE/, e.g. "hook-doc-obligation" */
  stateSubdir: string;
  /** Prefix for pending state files, e.g. "hookdoc-pending" */
  pendingPrefix: string;
  /** Prefix for block count files, e.g. "hookdoc-block-count" */
  blockCountPrefix: string;
  /** How many times to block before releasing the session */
  maxBlocks: number;
}

// ─── Path Helpers ─────────────────────────────────────────────────────────────

export function pendingPath(stateDir: string, prefix: string, sessionId: string): string {
  return join(stateDir, `${prefix}-${sessionId}.json`);
}

export function blockCountPath(stateDir: string, prefix: string, sessionId: string): string {
  return join(stateDir, `${prefix}-${sessionId}.txt`);
}

// ─── State Operations ─────────────────────────────────────────────────────────

/** Add a file to the pending list (no-op if already present). */
export function addPending(deps: ObligationDeps, flagFile: string, filePath: string): void {
  const pending = deps.readPending(flagFile);
  if (!pending.includes(filePath)) {
    pending.push(filePath);
  }
  deps.writePending(flagFile, pending);
}

/**
 * Remove matching entries from the pending list.
 * Returns the count of remaining entries and whether any were cleared.
 * Removes the flag file entirely if no entries remain.
 */
export function clearMatching(
  deps: ObligationDeps,
  flagFile: string,
  matchFn: (pending: string) => boolean,
): { remaining: number; cleared: boolean } {
  if (!deps.fileExists(flagFile)) {
    return { remaining: 0, cleared: false };
  }

  const pending = deps.readPending(flagFile);
  const remaining = pending.filter((p) => !matchFn(p));

  if (remaining.length === 0) {
    deps.removeFlag(flagFile);
    return { remaining: 0, cleared: true };
  }

  deps.writePending(flagFile, remaining);
  return { remaining: remaining.length, cleared: true };
}

// ─── Enforcer Logic ───────────────────────────────────────────────────────────

export type EnforceResult =
  | { action: "silent" }
  | { action: "block"; pending: string[] }
  | { action: "release"; pending: string[] };

/**
 * Core enforcer state machine: check pending → count blocks → block or release.
 * Returns a decision that the calling hook maps to its output type.
 */
export function checkObligation(
  deps: ObligationDeps,
  config: ObligationConfig,
  sessionId: string,
): EnforceResult {
  const flagFile = pendingPath(deps.stateDir, config.pendingPrefix, sessionId);

  if (!deps.fileExists(flagFile)) {
    return { action: "silent" };
  }

  const pending = deps.readPending(flagFile);
  if (pending.length === 0) {
    return { action: "silent" };
  }

  const countFile = blockCountPath(deps.stateDir, config.blockCountPrefix, sessionId);
  const blockCount = deps.readBlockCount(countFile);

  if (blockCount >= config.maxBlocks) {
    const reviewPath = join(deps.stateDir, `review-${sessionId}.md`);
    deps.writeReview(reviewPath, buildBlockLimitReview(config.name, pending, blockCount));
    deps.removeFlag(flagFile);
    deps.removeFlag(countFile);
    deps.stderr(
      `[${config.name}Enforcer] Block limit (${config.maxBlocks}) reached for ${pending.length} file(s). Review written. Releasing session.`,
    );
    return { action: "release", pending };
  }

  deps.writeBlockCount(countFile, blockCount + 1);
  deps.stderr(
    `[${config.name}Enforcer] Block ${blockCount + 1}/${config.maxBlocks}: ${pending.length} file(s) pending`,
  );
  return { action: "block", pending };
}

// ─── Review Builder ───────────────────────────────────────────────────────────

export function buildBlockLimitReview(name: string, pendingFiles: string[], blockCount: number): string {
  const timestamp = new Date().toISOString();
  const fileList = pendingFiles.map((f) => `- ${f}`).join("\n");
  return `# ${name} Obligation Review

**Generated:** ${timestamp}
**Block attempts:** ${blockCount}
**Outcome:** Session released after reaching block limit

## Unresolved Files

${fileList}

## What Happened

The ${name} obligation enforcer blocked session end ${blockCount} times for the files above.
The AI addressed the concern but did not resolve the pending state.

## Action Items

- Review whether these files genuinely need attention
- If not, consider adding them to an exclusion list
`;
}

// ─── Default Deps Factory ─────────────────────────────────────────────────────

export function createDefaultDeps(config: ObligationConfig): ObligationDeps {
  const baseDir = process.env.PAI_DIR || join(process.env.HOME!, ".claude");
  const stateDir = join(baseDir, "MEMORY", "STATE", config.stateSubdir);
  const log = (msg: string) => process.stderr.write(msg + "\n");

  return {
    stateDir,
    fileExists: (path: string) => fsFileExists(path),
    readPending: (path: string) => {
      const result = readJson<unknown>(path);
      if (!result.ok) {
        if (fsFileExists(path)) {
          log(`[${config.name}] corrupt state file, resetting: ${path}`);
        }
        return [];
      }
      return Array.isArray(result.value) ? (result.value as string[]) : [];
    },
    writePending: (path: string, files: string[]) => {
      const result = writeFile(path, JSON.stringify(files));
      if (!result.ok) log(`[${config.name}] write failed: ${result.error.message}`);
    },
    removeFlag: (path: string) => {
      const result = removeFile(path);
      if (!result.ok) log(`[${config.name}] remove failed: ${result.error.message}`);
    },
    readBlockCount: (path: string) => {
      const result = readFile(path);
      if (!result.ok) return 0;
      const n = parseInt(result.value.trim(), 10);
      return isNaN(n) ? 0 : n;
    },
    writeBlockCount: (path: string, count: number) => {
      const result = writeFile(path, String(count));
      if (!result.ok) log(`[${config.name}] write block count failed: ${result.error.message}`);
    },
    writeReview: (path: string, content: string) => {
      const result = writeFile(path, content);
      if (!result.ok) log(`[${config.name}] write review failed: ${result.error.message}`);
    },
    stderr: log,
  };
}
