/**
 * CronSessionEnd Contract — Remove this session's cron file on exit.
 *
 * Fires on SessionEnd. Reads the session's cron state file to get the
 * cron count for logging, deletes the file, and appends a "pruned"
 * event with reason "session_ended" to the JSONL log.
 *
 * CronPrune (SessionStart) still handles orphans from unclean exits.
 * This hook handles the clean-exit path deterministically.
 */

import {
  appendFile,
  ensureDir,
  fileExists,
  readDir,
  readFile,
  removeFile,
  writeFile,
} from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { defaultStderr } from "@hooks/lib/paths";
import {
  appendCronLog,
  type CronFileDeps,
  type CronPathDeps,
  cronFilePath,
  readCronFile,
} from "@hooks/hooks/CronStatusLine/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CronSessionEndDeps extends CronFileDeps, CronPathDeps {}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: CronSessionEndDeps = {
  readFile,
  writeFile,
  fileExists,
  ensureDir,
  readDir,
  removeFile,
  appendFile,
  stderr: defaultStderr,
  getEnv: (key) => process.env[key],
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const CronSessionEnd: SyncHookContract<SessionEndInput, SilentOutput, CronSessionEndDeps> = {
  name: "CronSessionEnd",
  event: "SessionEnd",

  accepts(_input: SessionEndInput): boolean {
    return true;
  },

  execute(input: SessionEndInput, deps: CronSessionEndDeps): Result<SilentOutput, PaiError> {
    const sessionId = input.session_id;
    const path = cronFilePath(sessionId, deps);

    // No file for this session — nothing to clean up
    if (!deps.fileExists(path)) {
      return ok({ type: "silent" });
    }

    // Read file to get cron count for logging
    const readResult = readCronFile(sessionId, deps, deps);
    const cronCount = readResult.ok && readResult.value ? readResult.value.crons.length : 0;

    // Delete the session's cron file
    const removeResult = deps.removeFile(path);
    if (!removeResult.ok) {
      deps.stderr(`[CronSessionEnd] Failed to remove ${path}: ${removeResult.error.message}`);
      return ok({ type: "silent" });
    }

    // Log the cleanup event
    appendCronLog({ type: "pruned", sessionId, cronCount, reason: "session_ended" }, deps, deps);

    return ok({ type: "silent" });
  },

  defaultDeps,
};
