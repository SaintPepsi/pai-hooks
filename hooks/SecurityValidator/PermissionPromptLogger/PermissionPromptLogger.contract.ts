/**
 * PermissionPromptLogger Contract — Diagnostic hook that logs every permission prompt.
 *
 * Event: PermissionRequest
 *
 * Fires when Claude Code is about to show a permission dialog.
 * Logs tool_name, tool_input summary, and timestamp to a JSONL file.
 * Returns silent (no stdout) so the prompt proceeds normally.
 *
 * Log location: MEMORY/SECURITY/permission-prompts.jsonl
 *
 * Reference: https://code.claude.com/docs/en/hooks (PermissionRequest event)
 */

import { join } from "node:path";
import { appendFile, ensureDir } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { PermissionRequestInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PermissionLogEntry {
  timestamp: string;
  session_id: string;
  tool_name: string;
  tool_input_summary: string;
  permission_mode: string;
  suggestions: string;
}

export interface PermissionPromptLoggerDeps {
  appendFile: (path: string, content: string) => Result<void, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── Pure Functions ──────────────────────────────────────────────────────────

function summarizeToolInput(toolInput: Record<string, unknown>): string {
  const command = toolInput.command as string | undefined;
  if (command) return command.slice(0, 200);

  const filePath = toolInput.file_path as string | undefined;
  if (filePath) return filePath;

  const prompt = toolInput.prompt as string | undefined;
  if (prompt) return prompt.slice(0, 100);

  return JSON.stringify(toolInput).slice(0, 200);
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: PermissionPromptLoggerDeps = {
  appendFile,
  ensureDir,
  baseDir: getPaiDir(),
  stderr: defaultStderr,
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const PermissionPromptLogger: SyncHookContract<
  PermissionRequestInput,
  SilentOutput,
  PermissionPromptLoggerDeps
> = {
  name: "PermissionPromptLogger",
  event: "PermissionRequest",

  accepts(_input: PermissionRequestInput): boolean {
    return true;
  },

  execute(
    input: PermissionRequestInput,
    deps: PermissionPromptLoggerDeps,
  ): Result<SilentOutput, PaiError> {
    const logDir = join(deps.baseDir, "MEMORY", "SECURITY");
    deps.ensureDir(logDir);

    const entry: PermissionLogEntry = {
      timestamp: new Date().toISOString(),
      session_id: input.session_id,
      tool_name: input.tool_name,
      tool_input_summary: summarizeToolInput(input.tool_input || {}),
      permission_mode: input.permission_mode || "unknown",
      suggestions: JSON.stringify(input.permission_suggestions || []).slice(0, 300),
    };

    const logPath = join(logDir, "permission-prompts.jsonl");
    const line = `${JSON.stringify(entry)}\n`;

    const appendResult = deps.appendFile(logPath, line);
    if (!appendResult.ok) {
      deps.stderr(`[PermissionPromptLogger] Failed to write log: ${appendResult.error.message}`);
    }

    deps.stderr(
      `[PermissionPromptLogger] ${input.tool_name}: ${summarizeToolInput(input.tool_input || {}).slice(0, 80)}`,
    );

    return ok({ type: "silent" });
  },

  defaultDeps,
};
