/**
 * CronCreate Contract -- PostToolUse on CronCreate.
 *
 * Persists new cron to session state file and appends "created" event
 * to the JSONL log. Returns silent output (no context added to conversation).
 *
 * Types: @hooks/hooks/CronStatusLine/shared.ts
 * Runner: @hooks/core/runner.ts
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
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  appendCronLog,
  type CronEntry,
  type CronFileDeps,
  type CronPathDeps,
  type CronSessionFile,
  readCronFile,
  writeCronFile,
} from "@hooks/hooks/CronStatusLine/shared";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CronCreateDeps extends CronFileDeps, CronPathDeps {
  now: () => number;
}

// ─── Response Shape ─────────────────────────────────────────────────────────

/** Expected shape of CronCreate tool_response from Claude Code. */
interface CronCreateToolResponse {
  id?: string;
  humanSchedule?: string;
}

/** Type guard: narrows ToolHookInput["tool_response"] to CronCreateToolResponse. */
function isCronCreateResponse(
  value: ToolHookInput["tool_response"],
): value is CronCreateToolResponse {
  return typeof value === "object" && value !== null;
}

// ─── Extractors ─────────────────────────────────────────────────────────────

function extractCronId(toolResponse: ToolHookInput["tool_response"], now: number): string {
  if (isCronCreateResponse(toolResponse) && typeof toolResponse.id === "string") {
    return toolResponse.id;
  }
  return `cron-${now}`;
}

function extractHumanSchedule(toolResponse: ToolHookInput["tool_response"]): string {
  if (isCronCreateResponse(toolResponse) && typeof toolResponse.humanSchedule === "string") {
    return toolResponse.humanSchedule;
  }
  return "Cron job";
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: CronCreateDeps = {
  readFile,
  writeFile,
  fileExists,
  ensureDir,
  readDir,
  removeFile,
  appendFile,
  stderr: defaultStderr,
  getEnv: (key) => {
    const result = getEnvAdapter(key);
    return result.ok ? result.value : undefined;
  },
  now: () => Date.now(),
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const CronCreateContract: SyncHookContract<ToolHookInput, CronCreateDeps> = {
  name: "CronCreate",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "CronCreate";
  },

  execute(input: ToolHookInput, deps: CronCreateDeps): Result<SyncHookJSONOutput, ResultError> {
    const sessionId = input.session_id;
    const now = deps.now();

    // Extract fields from tool_response (with fallbacks)
    const cronId = extractCronId(input.tool_response, now);
    const name = extractHumanSchedule(input.tool_response);

    // Extract fields from tool_input
    const schedule = String(input.tool_input.cron ?? input.tool_input.schedule ?? "");
    const recurring = Boolean(input.tool_input.recurring ?? true);
    const prompt = String(input.tool_input.prompt ?? "");

    // Build entry
    const entry: CronEntry = {
      id: cronId,
      name,
      schedule,
      recurring,
      prompt,
      createdAt: now,
      fireCount: 0,
      lastFired: null,
    };

    // Read existing session file or create new one
    const readResult = readCronFile(sessionId, deps, deps);
    if (!readResult.ok) return readResult;

    const session: CronSessionFile = readResult.value ?? {
      sessionId,
      crons: [],
    };

    // Append new entry
    session.crons.push(entry);

    // Write session file
    const writeResult = writeCronFile(sessionId, session, deps, deps);
    if (!writeResult.ok) return writeResult;

    // Append log event
    appendCronLog({ type: "created", cronId, name, schedule, sessionId }, deps, deps);

    return ok({});
  },

  defaultDeps,
};
