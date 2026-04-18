/**
 * CronPrune Contract — Remove orphaned cron files from dead sessions.
 *
 * Runs on SessionStart. Scans MEMORY/STATE/crons/ for .json files whose
 * mtime is older than PRUNE_THRESHOLD_MS (5 minutes). Dead sessions no
 * longer heartbeat their cron file, so stale mtime means the session
 * that owned those crons is gone. Deletes the file and logs the event.
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import {
  appendFile,
  ensureDir,
  fileExists,
  readDir as fsReadDir,
  stat as fsStat,
  readFile,
  removeFile,
  writeFile,
} from "@hooks/core/adapters/fs";
import { getEnv as getEnvAdapter } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { jsonParseFailed } from "@hooks/core/error";
import { ok, type Result, tryCatch } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import type {
  CronFileDeps,
  CronPathDeps,
  CronSessionFile,
} from "@hooks/hooks/CronStatusLine/shared";
import { appendCronLog, cronDir } from "@hooks/hooks/CronStatusLine/shared";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Constants ──────────────────────────────────────────────────────────────

export const DEFAULT_PRUNE_THRESHOLD_MS = 5 * 60 * 1000;

/** Crons that never fired and are older than this are pruned (#244). */
export const STALE_CRON_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Parse a 5-field cron expression and return the approximate interval in ms.
 *  Used to compute dynamic prune thresholds (2x longest cron interval). */
export function cronIntervalMs(schedule: string): number {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return DEFAULT_PRUNE_THRESHOLD_MS;
  const [minute, hour] = parts;
  const minStep = minute.match(/^\*\/(\d+)$/);
  if (minStep) return Number(minStep[1]) * 60 * 1000;
  const hourStep = hour.match(/^\*\/(\d+)$/);
  if (hourStep) return Number(hourStep[1]) * 3600 * 1000;
  if (/^\d+$/.test(minute) && hour === "*") return 3600 * 1000;
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) return 86400 * 1000;
  return DEFAULT_PRUNE_THRESHOLD_MS;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CronPruneDeps extends CronFileDeps, CronPathDeps {
  now: () => number;
  stat: (path: string) => Result<{ mtimeMs: number }, ResultError>;
}

// ─── Pure Logic ─────────────────────────────────────────────────────────────

function pruneStaleFiles(
  _input: SessionStartInput,
  deps: CronPruneDeps,
): Result<SyncHookJSONOutput, ResultError> {
  const dir = cronDir(deps);

  // If directory doesn't exist, silent no-op
  if (!deps.fileExists(dir)) {
    return ok({});
  }

  const dirResult = deps.readDir(dir);
  if (!dirResult.ok) {
    return ok({});
  }

  const now = deps.now();

  for (const filename of dirResult.value) {
    if (!filename.endsWith(".json")) continue;

    const filePath = join(dir, filename);

    // Check mtime — skip on stat failure
    const statResult = deps.stat(filePath);
    if (!statResult.ok) continue;

    const ageMs = now - statResult.value.mtimeMs;

    // Read the file first to compute dynamic threshold from cron schedules
    let sessionId = filename.replace(/\.json$/, "");
    let cronCount = 0;
    let longestCronMs = 0;

    const readResult = deps.readFile(filePath);
    let sessionFile: CronSessionFile | null = null;
    if (readResult.ok) {
      const parsed = safeParseCronFile(readResult.value);
      if (parsed.ok && parsed.value) {
        sessionFile = parsed.value;
        sessionId = sessionFile.sessionId;
        cronCount = sessionFile.crons.length;
        // Compute 2x the longest cron interval as the prune threshold
        for (const cron of sessionFile.crons) {
          const intervalMs = cronIntervalMs(cron.schedule);
          if (intervalMs > longestCronMs) longestCronMs = intervalMs;
        }
      }
    }

    // Dynamic threshold: 2x longest cron interval, or default if no crons parseable
    const pruneThreshold = longestCronMs > 0 ? longestCronMs * 2 : DEFAULT_PRUNE_THRESHOLD_MS;

    // If session file is stale (dead session), delete entire file
    if (ageMs > pruneThreshold) {
      deps.removeFile(filePath);
      appendCronLog({ type: "pruned", sessionId, cronCount, reason: "session_dead" }, deps, deps);
      continue;
    }

    // Session is alive — prune individual stale crons (#244)
    // Remove crons that never fired (fireCount: 0) and are older than 24h
    if (sessionFile && sessionFile.crons.length > 0) {
      const originalCount = sessionFile.crons.length;
      sessionFile.crons = sessionFile.crons.filter((cron) => {
        if (cron.fireCount > 0) return true;
        const cronAge = now - cron.createdAt;
        if (cronAge > STALE_CRON_THRESHOLD_MS) {
          appendCronLog(
            { type: "deleted", cronId: cron.id, name: cron.name, sessionId },
            deps,
            deps,
          );
          return false;
        }
        return true;
      });

      // Write back if we removed any stale crons
      if (sessionFile.crons.length < originalCount) {
        deps.writeFile(filePath, JSON.stringify(sessionFile, null, 2));
      }
    }
  }

  return ok({});
}

function safeParseCronFile(raw: string): Result<CronSessionFile | null, ResultError> {
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
  getEnv: (key) => {
    const result = getEnvAdapter(key);
    return result.ok ? result.value : undefined;
  },
  readFile,
  writeFile,
  fileExists,
  ensureDir,
  readDir: (path: string) => {
    const result = fsReadDir(path);
    if (!result.ok) return result;
    return ok(
      result.value.map((e: { name?: string } | string) =>
        typeof e === "string" ? e : (e.name ?? ""),
      ),
    );
  },
  removeFile,
  appendFile,
  stderr: defaultStderr,
  now: () => Date.now(),
  stat: fsStat,
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const CronPrune: SyncHookContract<SessionStartInput, CronPruneDeps> = {
  name: "CronPrune",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  execute(input: SessionStartInput, deps: CronPruneDeps): Result<SyncHookJSONOutput, ResultError> {
    return pruneStaleFiles(input, deps);
  },

  defaultDeps,
};
