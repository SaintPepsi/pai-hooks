/**
 * WikiReadTracker Contract — Tracks wiki page reads for metrics.
 *
 * PostToolUse hook that fires on Read tool calls targeting MEMORY/WIKI/ paths.
 * Appends a JSON line to .pipeline/metrics.jsonl with session_id, path, and timestamp.
 *
 * Performance: accepts() is a string check only — no I/O, no regex.
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { appendFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WikiReadTrackerDeps {
  appendFile: (path: string, content: string) => Result<void, ResultError>;
  wikiDir: string;
  stderr: (msg: string) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const WIKI_PATH_MARKER = "MEMORY/WIKI/";
const METRICS_FILE = ".pipeline/metrics.jsonl";

// ─── Contract ───────────────────────────────────────────────────────────────

const defaultDeps: WikiReadTrackerDeps = {
  appendFile,
  wikiDir: join(getPaiDir(), "MEMORY", "WIKI"),
  stderr: defaultStderr,
};

export const WikiReadTracker: SyncHookContract<ToolHookInput, WikiReadTrackerDeps> = {
  name: "WikiReadTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name !== "Read") return false;
    const filePath = input.tool_input?.file_path;
    if (typeof filePath !== "string") return false;
    return filePath.includes(WIKI_PATH_MARKER);
  },

  execute(
    input: ToolHookInput,
    deps: WikiReadTrackerDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const { session_id, tool_input } = input;
    if (!session_id) return ok({ continue: true });

    const filePath = tool_input.file_path as string;
    const record = {
      session_id,
      path: filePath,
      timestamp: new Date().toISOString(),
    };

    const metricsPath = join(deps.wikiDir, METRICS_FILE);
    const appendResult = deps.appendFile(metricsPath, `${JSON.stringify(record)}\n`);

    if (!appendResult.ok) {
      deps.stderr(`[WikiReadTracker] failed to write metric: ${appendResult.error.message}`);
    }

    return ok({ continue: true });
  },

  defaultDeps,
};
