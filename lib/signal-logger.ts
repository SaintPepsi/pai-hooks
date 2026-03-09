/**
 * Signal Logger — Standardised JSONL logging for hook outputs.
 *
 * Every hook that logs decisions writes to MEMORY/LEARNING/SIGNALS/.
 * This utility standardises the base fields and handles the ensureDir +
 * appendFile boilerplate so hooks don't duplicate the pattern.
 *
 * Usage:
 *   import { logSignal, type SignalLoggerDeps } from "../lib/signal-logger";
 *
 *   logSignal(deps, "type-strictness.jsonl", {
 *     session_id: input.session_id,
 *     hook: "TypeStrictness",
 *     event: "PreToolUse",
 *     tool: input.tool_name,
 *     file: filePath,
 *     outcome: "block",
 *     violations: [...],
 *   });
 */

import type { HookEventType } from "../core/types/hook-inputs";
import type { Result } from "../core/result";
import type { PaiError } from "../core/error";
import { appendFile, ensureDir } from "../core/adapters/fs";
import { join } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SignalEntry {
  session_id: string;
  hook: string;
  event: HookEventType;
  tool: string;
  file: string;
  outcome: string;
  [key: string]: unknown;
}

export interface SignalLoggerDeps {
  appendFile: (path: string, content: string) => Result<void, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  baseDir: string;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, ".claude");

export const defaultSignalLoggerDeps: SignalLoggerDeps = {
  appendFile,
  ensureDir,
  baseDir: BASE_DIR,
};

// ─── Logger ──────────────────────────────────────────────────────────────────

/**
 * Log a signal entry to a JSONL file in MEMORY/LEARNING/SIGNALS/.
 *
 * Automatically prepends a timestamp. The `logFile` parameter is the
 * filename only (e.g. "type-strictness.jsonl"), not a full path.
 */
export function logSignal(
  deps: SignalLoggerDeps,
  logFile: string,
  entry: SignalEntry,
): void {
  const signalsDir = join(deps.baseDir, "MEMORY/LEARNING/SIGNALS");
  deps.ensureDir(signalsDir);

  const fullEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  deps.appendFile(join(signalsDir, logFile), JSON.stringify(fullEntry) + "\n");
}
