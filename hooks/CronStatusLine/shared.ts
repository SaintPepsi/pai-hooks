/**
 * CronStatusLine Shared — Types, path helpers, and file I/O for cron hooks.
 *
 * All four CronStatusLine hooks (Create, Delete, Fire, Prune) share these
 * types and functions. No raw Node builtins — all I/O through adapters.
 */

import { join } from "path";
import type { Result } from "@hooks/core/result";
import { ok, err, andThen, tryCatch } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { jsonParseFailed, fileNotFound } from "@hooks/core/error";

// ─── Domain Types ────────────────────────────────────────────────────────────

export interface CronEntry {
  id: string;
  name: string;
  schedule: string;
  recurring: boolean;
  prompt: string;
  createdAt: number;
  fireCount: number;
  lastFired: number | null;
}

export interface CronSessionFile {
  sessionId: string;
  crons: CronEntry[];
}

export type CronLogEvent =
  | { type: "created"; cronId: string; name: string; schedule: string; sessionId: string }
  | { type: "deleted"; cronId: string; name: string; sessionId: string }
  | { type: "fired"; cronId: string; name: string; fireCount: number }
  | { type: "pruned"; sessionId: string; cronCount: number; reason: string };

// ─── Dependency Interfaces ───────────────────────────────────────────────────

export interface CronPathDeps {
  getEnv: (key: string) => string | undefined;
}

export interface CronFileDeps {
  readFile: (path: string) => Result<string, PaiError>;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  fileExists: (path: string) => boolean;
  ensureDir: (path: string) => Result<void, PaiError>;
  readDir: (path: string) => Result<string[], PaiError>;
  removeFile: (path: string) => Result<void, PaiError>;
  appendFile: (path: string, content: string) => Result<void, PaiError>;
  stderr: (msg: string) => void;
}

// ─── Path Helpers ────────────────────────────────────────────────────────────

function paiDir(deps: CronPathDeps): string {
  return deps.getEnv("PAI_DIR") || join(deps.getEnv("HOME") || "", ".claude");
}

export function cronDir(deps: CronPathDeps): string {
  return join(paiDir(deps), "MEMORY", "STATE", "crons");
}

export function cronFilePath(sessionId: string, deps: CronPathDeps): string {
  return join(cronDir(deps), `${sessionId}.json`);
}

export function cronLogPath(deps: CronPathDeps): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return join(paiDir(deps), "MEMORY", "STATE", "logs", `cron-log-${yyyy}-${mm}-${dd}.jsonl`);
}

// ─── File I/O ────────────────────────────────────────────────────────────────

export function readCronFile(
  sessionId: string,
  pathDeps: CronPathDeps,
  fileDeps: CronFileDeps,
): Result<CronSessionFile | null, PaiError> {
  const path = cronFilePath(sessionId, pathDeps);

  if (!fileDeps.fileExists(path)) return ok(null);

  return andThen(fileDeps.readFile(path), (raw) => parseCronSessionFile(raw, path));
}

export function writeCronFile(
  sessionId: string,
  data: CronSessionFile,
  pathDeps: CronPathDeps,
  fileDeps: CronFileDeps,
): Result<void, PaiError> {
  const dir = cronDir(pathDeps);
  const path = cronFilePath(sessionId, pathDeps);

  return andThen(fileDeps.ensureDir(dir), () =>
    fileDeps.writeFile(path, JSON.stringify(data, null, 2)),
  );
}

export function appendCronLog(
  event: CronLogEvent,
  pathDeps: CronPathDeps,
  fileDeps: CronFileDeps,
): Result<void, PaiError> {
  const path = cronLogPath(pathDeps);
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  return fileDeps.appendFile(path, line);
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/** Parse raw JSON string into CronSessionFile via tryCatch adapter bridge. */
function parseCronSessionFile(raw: string, path: string): Result<CronSessionFile, PaiError> {
  const trimmed = raw.trim();
  if (!trimmed) return err(fileNotFound(path));

  return tryCatch(
    () => JSON.parse(trimmed) as CronSessionFile,
    (e) => jsonParseFailed(trimmed, e),
  );
}
