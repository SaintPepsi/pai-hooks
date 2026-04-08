/**
 * SettingsProtectorPost Contract — Revert unauthorized settings.json changes.
 *
 * PostToolUse hook paired with SettingsProtector (PreToolUse).
 *
 * After every Bash command, compares settings files to the snapshots taken
 * by SettingsProtector. If any file changed, it is reverted from the
 * snapshot and an error context is injected telling the AI not to retry.
 *
 * This eliminates the need to detect write patterns — no matter how the
 * file was modified (sed, python, node, jq, curl, variable indirection,
 * string concatenation, etc.), the change is caught and reverted.
 */

import { readFile, writeFile, fileExists } from "@hooks/core/adapters/fs";
import { getCommand } from "@hooks/lib/tool-input";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { continueOk, silent } from "@hooks/core/types/hook-outputs";
import type { ContinueOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import { snapshotPath, logSettingsAudit } from "@hooks/hooks/SecurityValidator/SettingsProtector/SettingsProtector.contract";
import type { AuditLogDeps } from "@hooks/hooks/SecurityValidator/SettingsProtector/SettingsProtector.contract";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SettingsProtectorPostDeps extends AuditLogDeps {
  homedir: () => string;
  stderr: (msg: string) => void;
  readFile: (path: string) => Result<string, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  fileExists: (path: string) => boolean;
}

// ─── Pure Logic ─────────────────────────────────────────────────────────────

const SETTINGS_FILENAMES = ["settings.json", "settings.local.json"];

const REVERT_CONTEXT = [
  "[SECURITY] Your Bash command modified ~/.claude/settings.json without permission.",
  "The change has been automatically reverted to the pre-command state.",
  "",
  "To modify settings.json, use the Edit tool (which will prompt for confirmation).",
  "",
  "[INSTRUCTION TO AI: Do NOT attempt to modify settings.json again via Bash.",
  "Do not suggest workarounds, shell escapes, or alternative approaches.",
  "The settings file is protected. If the user needs to change it, they can",
  "approve the Edit tool prompt or modify it manually outside Claude Code.]",
].join("\n");

/**
 * Compare current settings files to snapshots. If any changed, revert.
 * Returns the list of filenames that were reverted.
 */
function compareAndRevert(
  sessionId: string,
  home: string,
  deps: SettingsProtectorPostDeps,
): string[] {
  const reverted: string[] = [];

  for (const filename of SETTINGS_FILENAMES) {
    const snapPath = snapshotPath(sessionId, filename);
    if (!deps.fileExists(snapPath)) continue;

    const snapshot = deps.readFile(snapPath);
    if (!snapshot.ok) continue;

    const settingsPath = `${home}/.claude/${filename}`;
    const current = deps.readFile(settingsPath);

    // File was deleted — restore from snapshot
    if (!current.ok) {
      deps.writeFile(settingsPath, snapshot.value);
      reverted.push(filename);
      continue;
    }

    // File content changed — revert
    if (current.value !== snapshot.value) {
      deps.writeFile(settingsPath, snapshot.value);
      reverted.push(filename);
    }
  }

  return reverted;
}

// ─── Contract ───────────────────────────────────────────────────────────────

import { appendFile, ensureDir } from "@hooks/core/adapters/fs";

const defaultDeps: SettingsProtectorPostDeps = {
  homedir: () => process.env.HOME || "/",
  stderr: defaultStderr,
  readFile,
  writeFile,
  fileExists,
  appendFile,
  ensureDir,
  baseDir: getPaiDir(),
};

export const SettingsProtectorPost: SyncHookContract<
  ToolHookInput,
  ContinueOutput | SilentOutput,
  SettingsProtectorPostDeps
> = {
  name: "SettingsProtectorPost",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Bash";
  },

  execute(
    input: ToolHookInput,
    deps: SettingsProtectorPostDeps,
  ): Result<ContinueOutput | SilentOutput, ResultError> {
    const home = deps.homedir();
    const command = getCommand(input).slice(0, 500);
    const reverted = compareAndRevert(input.session_id, home, deps);

    const action = reverted.length > 0 ? "reverted" as const : "unchanged" as const;
    logSettingsAudit({
      ts: new Date().toISOString(),
      session_id: input.session_id,
      tool: "Bash",
      target: reverted.length > 0 ? reverted.join(", ") : "settings.json",
      action,
      command,
    }, deps);

    if (reverted.length === 0) {
      return ok(silent());
    }

    deps.stderr(
      `[SettingsProtectorPost] Reverted unauthorized changes to: ${reverted.join(", ")}`,
    );

    return ok(continueOk(REVERT_CONTEXT));
  },

  defaultDeps,
};
