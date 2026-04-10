/**
 * Hook Log Adapter — Persistent structured JSONL logging for hook executions.
 *
 * Writes one JSON line per hook execution to MEMORY/STATE/logs/hook-log-YYYY-MM-DD.jsonl.
 * Probabilistic cleanup deletes files older than 7 days (~1 in 50 calls).
 *
 * Design: docs/plans/2026-03-13-hook-logging-design.md
 */

import { join } from "node:path";
import { appendFile, ensureDir, readDir, removeFile } from "@hooks/core/adapters/fs";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HookLogEntry {
  ts: string;
  hook: string;
  event: string;
  status: "ok" | "error" | "skipped";
  duration_ms: number;
  session_id?: string;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CLEANUP_PROBABILITY = 1 / 50;
const MAX_AGE_DAYS = 7;
const LOG_PREFIX = "hook-log-";
const LOG_SUFFIX = ".jsonl";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

function logFileName(dateStr: string): string {
  return `${LOG_PREFIX}${dateStr}${LOG_SUFFIX}`;
}

function parseDateFromFilename(filename: string): string | null {
  const match = filename.match(/^hook-log-(\d{4}-\d{2}-\d{2})\.jsonl$/);
  return match ? match[1] : null;
}

function isOlderThanDays(dateStr: string, days: number): boolean {
  const fileDate = new Date(`${dateStr}T00:00:00Z`).getTime();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return fileDate < cutoff;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function cleanupOldLogs(logDir: string): void {
  const entries = readDir(logDir, { withFileTypes: true });
  if (!entries.ok) return;

  for (const entry of entries.value) {
    if (entry.isDirectory()) continue;
    const dateStr = parseDateFromFilename(entry.name);
    if (dateStr && isOlderThanDays(dateStr, MAX_AGE_DAYS)) {
      removeFile(join(logDir, entry.name));
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

let dirEnsured = false;

/** Test-only: reset the dir-ensured cache so ensureDir runs again. */
export function _resetDirCache(): void {
  dirEnsured = false;
}

export function appendHookLog(
  entry: HookLogEntry,
  logDir?: string,
  forceCleanup?: boolean,
  stderr?: (msg: string) => void,
): Result<void, ResultError> {
  const dir = logDir ?? join(process.env.HOME!, ".claude", "MEMORY", "STATE", "logs");

  if (!dirEnsured || logDir !== undefined) {
    const mkResult = ensureDir(dir);
    if (!mkResult.ok) return ok(undefined);
    if (logDir === undefined) dirEnsured = true;
  }

  const filePath = join(dir, logFileName(todayDateString()));
  const line = `${JSON.stringify(entry)}\n`;
  // Intentional: log write failures must not break hook execution
  const writeResult = appendFile(filePath, line);
  if (!writeResult.ok && stderr) {
    stderr(`[hook-log] write failed: ${filePath} — ${writeResult.error.message}`);
  }

  if (forceCleanup || Math.random() < CLEANUP_PROBABILITY) {
    cleanupOldLogs(dir);
  }

  return ok(undefined);
}
