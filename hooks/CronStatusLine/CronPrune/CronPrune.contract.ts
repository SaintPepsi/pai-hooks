/**
 * CronPrune Contract — Remove orphaned cron files from dead sessions.
 *
 * Runs on SessionStart. Scans MEMORY/STATE/crons/ for .json files whose
 * mtime is older than PRUNE_THRESHOLD_MS (5 minutes). Dead sessions no
 * longer heartbeat their cron file, so stale mtime means the session
 * that owned those crons is gone. Deletes the file and logs the event.
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, tryCatch, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { jsonParseFailed } from "@hooks/core/error";
import type { CronFileDeps, CronPathDeps, CronSessionFile } from "@hooks/hooks/CronStatusLine/shared";
import { cronDir, appendCronLog } from "@hooks/hooks/CronStatusLine/shared";
import { join } from "path";
import {
  fileExists,
  readFile,
  writeFile,
  ensureDir,
  readDir as fsReadDir,
  removeFile,
  appendFile,
  stat as fsStat,
} from "@hooks/core/adapters/fs";

// ─── Constants ──────────────────────────────────────────────────────────────

export const PRUNE_THRESHOLD_MS = 5 * 60 * 1000;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CronPruneDeps extends CronFileDeps, CronPathDeps {
  now: () => number;
  stat: (path: string) => Result<{ mtimeMs: number }, PaiError>;
}

// ─── Pure Logic ─────────────────────────────────────────────────────────────

function pruneStaleFiles(
  input: SessionStartInput,
  deps: CronPruneDeps,
): Result<SilentOutput, PaiError> {
  const dir = cronDir(deps);

  // If directory doesn't exist, silent no-op
  if (!deps.fileExists(dir)) {
    return ok({ type: "silent" });
  }

  const dirResult = deps.readDir(dir);
  if (!dirResult.ok) {
    return ok({ type: "silent" });
  }

  const now = deps.now();

  for (const filename of dirResult.value) {
    if (!filename.endsWith(".json")) continue;

    const filePath = join(dir, filename);

    // Check mtime — skip on stat failure
    const statResult = deps.stat(filePath);
    if (!statResult.ok) continue;

    const ageMs = now - statResult.value.mtimeMs;
    if (ageMs <= PRUNE_THRESHOLD_MS) continue;

    // File is stale — read it for logging before deletion
    let sessionId = filename.replace(/\.json$/, "");
    let cronCount = 0;

    const readResult = deps.readFile(filePath);
    if (readResult.ok) {
      const parsed = safeParseCronFile(readResult.value);
      if (parsed.ok && parsed.value) {
        sessionId = parsed.value.sessionId;
        cronCount = parsed.value.crons.length;
      }
    }

    // Delete the stale file
    deps.removeFile(filePath);

    // Log the pruning event
    appendCronLog(
      { type: "pruned", sessionId, cronCount, reason: "session_dead" },
      deps,
      deps,
    );
  }

  return ok({ type: "silent" });
}

function safeParseCronFile(raw: string): Result<CronSessionFile | null, PaiError> {
  const trimmed = raw.trim();
  if (!trimmed) return ok(null);

  const parsed = tryCatch(
    () => JSON.parse(trimmed) as unknown,
    (e) => jsonParseFailed(trimmed.slice(0, 120), e),
  );
  if (!parsed.ok) return parsed;

  if (typeof parsed.value !== "object" || parsed.value === null) return ok(null);
  return ok(parsed.value as CronSessionFile);
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: CronPruneDeps = {
  getEnv: (key) => process.env[key],
  readFile,
  writeFile,
  fileExists,
  ensureDir,
  readDir: (path: string) => {
    const result = fsReadDir(path);
    if (!result.ok) return result;
    return ok(result.value.map((e: { name?: string } | string) => typeof e === "string" ? e : (e.name ?? "")));
  },
  removeFile,
  appendFile,
  stderr: (msg) => process.stderr.write(msg + "\n"),
  now: () => Date.now(),
  stat: fsStat,
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const CronPrune: SyncHookContract<
  SessionStartInput,
  SilentOutput,
  CronPruneDeps
> = {
  name: "CronPrune",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  execute(
    input: SessionStartInput,
    deps: CronPruneDeps,
  ): Result<SilentOutput, PaiError> {
    return pruneStaleFiles(input, deps);
  },

  defaultDeps,
};
