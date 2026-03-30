/**
 * CronDelete Contract -- PostToolUse on CronDelete.
 *
 * Removes a cron entry from the session state file by ID and appends a
 * "deleted" event to the JSONL log. When the last cron is removed, the
 * session file is deleted entirely via removeFile.
 *
 * Types: @hooks/hooks/CronStatusLine/shared.ts
 * Runner: @hooks/core/runner.ts
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
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { defaultStderr } from "@hooks/lib/paths";
import {
  appendCronLog,
  type CronFileDeps,
  type CronPathDeps,
  cronFilePath,
  readCronFile,
  writeCronFile,
} from "@hooks/hooks/CronStatusLine/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CronDeleteDeps extends CronFileDeps, CronPathDeps {}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: CronDeleteDeps = {
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

export const CronDeleteContract: SyncHookContract<ToolHookInput, SilentOutput, CronDeleteDeps> = {
  name: "CronDelete",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "CronDelete";
  },

  execute(input: ToolHookInput, deps: CronDeleteDeps): Result<SilentOutput, PaiError> {
    const sessionId = input.session_id;
    const cronId = String(input.tool_input.id ?? "");

    // Read existing session file — if missing, silent no-op
    const readResult = readCronFile(sessionId, deps, deps);
    if (!readResult.ok) return readResult;

    const session = readResult.value;
    if (session === null) return ok({ type: "silent" });

    // Find the cron to delete
    const targetIndex = session.crons.findIndex((c) => c.id === cronId);
    if (targetIndex === -1) return ok({ type: "silent" });

    const removedCron = session.crons[targetIndex];
    session.crons.splice(targetIndex, 1);

    // If no crons remain, delete the file entirely
    if (session.crons.length === 0) {
      const path = cronFilePath(sessionId, deps);
      const removeResult = deps.removeFile(path);
      if (!removeResult.ok) return removeResult;
    } else {
      // Write updated session file with remaining crons
      const writeResult = writeCronFile(sessionId, session, deps, deps);
      if (!writeResult.ok) return writeResult;
    }

    // Append "deleted" event to JSONL log
    appendCronLog({ type: "deleted", cronId, name: removedCron.name, sessionId }, deps, deps);

    return ok({ type: "silent" });
  },

  defaultDeps,
};
