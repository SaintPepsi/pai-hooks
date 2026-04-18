/**
 * CronFire Contract — Detect cron fires by matching UserPromptSubmit prompts.
 *
 * Pipeline:
 * 1. Extract prompt from input (with legacy user_prompt fallback)
 * 2. Early return silent if no prompt
 * 3. Read session cron file — silent if missing
 * 4. Find first cron where prompt.includes(cron.prompt)
 * 5. Silent if no match (no write)
 * 6. Increment fireCount, set lastFired, write file, append log
 *
 * This hook fires on EVERY UserPromptSubmit. Fast path exits early.
 *
 * @see /Users/ian.hogers/.claude/pai-hooks/hooks/CronStatusLine/shared.ts — shared types and I/O
 * @see /Users/ian.hogers/.claude/pai-hooks/core/types/hook-inputs.ts — UserPromptSubmitInput
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import {
  appendFile,
  ensureDir,
  fileExists,
  readDir,
  readFile,
  removeFile,
  writeFile,
} from "@hooks/core/adapters/fs";
import { getEnv as getEnvAdapter } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import { ok } from "@hooks/core/result";
import type { UserPromptSubmitInput } from "@hooks/core/types/hook-inputs";
import type { CronFileDeps, CronPathDeps } from "@hooks/hooks/CronStatusLine/shared";
import { appendCronLog, readCronFile, writeCronFile } from "@hooks/hooks/CronStatusLine/shared";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Deps ───────────────────────────────────────────────────────────────────

export interface CronFireDeps extends CronFileDeps, CronPathDeps {
  now: () => number;
}

// ─── Default Production Deps ────────────────────────────────────────────────

const defaultDeps: CronFireDeps = {
  readFile,
  writeFile,
  fileExists,
  ensureDir,
  readDir,
  removeFile,
  appendFile,
  stderr: defaultStderr,
  getEnv: (key: string) => {
    const result = getEnvAdapter(key);
    return result.ok ? result.value : undefined;
  },
  now: () => Date.now(),
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const CronFireContract: SyncHookContract<UserPromptSubmitInput, CronFireDeps> = {
  name: "CronFire",
  event: "UserPromptSubmit",

  accepts(_input: UserPromptSubmitInput): boolean {
    return true;
  },

  execute(
    input: UserPromptSubmitInput,
    deps: CronFireDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const prompt = input.prompt || input.user_prompt || "";
    if (!prompt) return ok({});

    const sessionId = input.session_id;
    const readResult = readCronFile(sessionId, deps, deps);
    if (!readResult.ok) return ok({});

    const sessionFile = readResult.value;
    if (!sessionFile) return ok({});

    const matchIndex = sessionFile.crons.findIndex((cron) => prompt.includes(cron.prompt));
    if (matchIndex === -1) return ok({});

    const matched = sessionFile.crons[matchIndex];
    const updatedCron = {
      ...matched,
      fireCount: matched.fireCount + 1,
      lastFired: deps.now(),
    };

    const updatedCrons = sessionFile.crons.map((cron, i) =>
      i === matchIndex ? updatedCron : cron,
    );

    writeCronFile(sessionId, { ...sessionFile, crons: updatedCrons }, deps, deps);

    appendCronLog(
      {
        type: "fired",
        cronId: updatedCron.id,
        name: updatedCron.name,
        fireCount: updatedCron.fireCount,
      },
      deps,
      deps,
    );

    return ok({});
  },

  defaultDeps,
};
