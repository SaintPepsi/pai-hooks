/**
 * JSONL Reader — Parse JSONL files and compute cross-session violation counts.
 *
 * Used by CodeQualityGuard to determine whether a file is a "repeat offender"
 * across sessions. Reads from the quality-violations.jsonl signal log.
 */

import { join } from "node:path";
import { readFile } from "@hooks/core/adapters/fs";
import type { ResultError } from "@hooks/core/error";
import { tryCatch } from "@hooks/core/result";
import type { Result } from "@hooks/core/result";
import type { Violation } from "@hooks/core/quality-scorer";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JsonlReaderDeps {
  readFile: (path: string) => Result<string, ResultError>;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: JsonlReaderDeps = {
  readFile,
};

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Parse a JSONL file and return all successfully-parsed lines as typed objects.
 * Lines that fail to parse are silently skipped.
 */
export function readJsonlLines<T>(path: string, deps: JsonlReaderDeps = defaultDeps): T[] {
  const result = deps.readFile(path);
  if (!result.ok) return [];

  return result.value
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      const parsed = tryCatch(
        () => JSON.parse(line) as T,
        () => null,
      );
      return parsed.ok && parsed.value !== null ? [parsed.value] : [];
    });
}

/**
 * Count the number of distinct sessions (other than the current one) that
 * logged a quality violation for the given file path.
 *
 * Reads from `{baseDir}/MEMORY/LEARNING/SIGNALS/quality-violations.jsonl`.
 */
export function countCrossSessionViolations(
  baseDir: string,
  filePath: string,
  currentSessionId: string,
  deps: JsonlReaderDeps = defaultDeps,
): number {
  const logPath = join(baseDir, "MEMORY/LEARNING/SIGNALS/quality-violations.jsonl");

  interface ViolationEntry {
    session_id?: string;
    file?: string;
    violations?: Violation[];
    deduplicated?: boolean;
  }

  const lines = readJsonlLines<ViolationEntry>(logPath, deps);

  // Collect distinct session IDs (excluding current) that had non-deduplicated
  // violations for this file
  const sessionsWithViolations = new Set<string>();
  for (const entry of lines) {
    if (
      entry.file === filePath &&
      entry.session_id &&
      entry.session_id !== currentSessionId &&
      entry.violations &&
      Array.isArray(entry.violations) &&
      entry.violations.length > 0 &&
      !entry.deduplicated
    ) {
      sessionsWithViolations.add(entry.session_id);
    }
  }

  return sessionsWithViolations.size;
}
