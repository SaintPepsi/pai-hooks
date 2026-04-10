/**
 * SettingsGuard Contract — Guard settings.json from uncontrolled mutation.
 *
 * PreToolUse hook with two strategies:
 *
 *   Edit/Write targeting settings files → ASK (user confirmation prompt)
 *   Bash (any command) → SNAPSHOT settings files before execution
 *
 * The snapshot strategy eliminates the need to detect every possible write
 * vector (sed, python, node, jq, curl, etc.). The paired PostToolUse hook
 * (SettingsGuardPost) compares the snapshot to current state after the
 * command runs. If settings.json changed, it reverts automatically.
 *
 * Protected files:
 *   ~/.claude/settings.json
 *   ~/.claude/settings.local.json
 */

import { appendFile, ensureDir, readFile, writeFile, fileExists } from "@hooks/core/adapters/fs";
import { join } from "node:path";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { ask, continueOk } from "@hooks/core/types/hook-outputs";
import type { AskOutput, ContinueOutput } from "@hooks/core/types/hook-outputs";
import { getFilePath } from "@hooks/lib/tool-input";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SettingsAuditEntry {
  ts: string;
  session_id: string;
  tool: string;
  target: string;
  action: "asked" | "snapshotted" | "reverted" | "unchanged";
  command?: string;
}

export interface SettingsGuardDeps {
  homedir: () => string;
  stderr: (msg: string) => void;
  readFile: (path: string) => Result<string, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  appendFile: (path: string, content: string) => Result<void, ResultError>;
  ensureDir: (path: string) => Result<void, ResultError>;
  fileExists: (path: string) => boolean;
  baseDir: string;
}

// ─── Pure Logic ─────────────────────────────────────────────────────────────

const SETTINGS_FILENAMES = ["settings.json", "settings.local.json"];

/** Build the snapshot temp path for a given settings file and session. */
export function snapshotPath(sessionId: string, filename: string): string {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9-]/g, "_");
  return `/tmp/pai-settings-snapshot-${safeSession}-${filename}`;
}

/** Check if a file path targets a Claude settings file in ~/.claude/. */
export function isSettingsPath(filePath: string, home: string): boolean {
  const expanded = filePath.startsWith("~") ? filePath.replace("~", home) : filePath;
  const claudeDir = `${home}/.claude/`;
  for (const name of SETTINGS_FILENAMES) {
    if (expanded === `${claudeDir}${name}` || expanded === `~/.claude/${name}`) {
      return true;
    }
  }
  return false;
}

function buildAskMessage(tool: string, target: string): string {
  return [
    `\u26a0\ufe0f Settings Protection: Claude wants to modify a settings file.`,
    ``,
    `Tool: ${tool}`,
    `Target: ${target}`,
    ``,
    `Allow this modification?`,
    ``,
    `[INSTRUCTION TO AI: If this operation is denied, do NOT suggest workarounds,`,
    `shell escapes (! commands), python/node scripts, or alternative approaches to`,
    `achieve the same modification. The user's security hooks protect this file for`,
    `a reason. Instead, explain what was blocked and suggest the user review their`,
    `hook configuration if they believe this is a false positive.]`,
  ].join("\n");
}

export interface AuditLogDeps {
  appendFile: (path: string, content: string) => Result<void, ResultError>;
  ensureDir: (path: string) => Result<void, ResultError>;
  baseDir: string;
}

/** Append an audit entry to the settings audit log. */
export function logSettingsAudit(
  entry: SettingsAuditEntry,
  deps: AuditLogDeps,
): void {
  const logDir = join(deps.baseDir, "MEMORY", "SECURITY");
  deps.ensureDir(logDir);
  const logPath = join(logDir, "settings-audit.jsonl");
  deps.appendFile(logPath, `${JSON.stringify(entry)}\n`);
}

/** Snapshot all protected settings files to /tmp for PostToolUse comparison. */
function snapshotSettings(
  sessionId: string,
  home: string,
  deps: SettingsGuardDeps,
): void {
  for (const filename of SETTINGS_FILENAMES) {
    const settingsPath = `${home}/.claude/${filename}`;
    if (!deps.fileExists(settingsPath)) continue;

    const content = deps.readFile(settingsPath);
    if (!content.ok) continue;

    const snapPath = snapshotPath(sessionId, filename);
    const writeResult = deps.writeFile(snapPath, content.value);
    if (!writeResult.ok) {
      deps.stderr(`[SettingsGuard] snapshot write failed for ${filename}: ${writeResult.error.message}`);
    }
  }
}

// ─── Contract ───────────────────────────────────────────────────────────────

const defaultDeps: SettingsGuardDeps = {
  homedir: () => process.env.HOME || "/",
  stderr: defaultStderr,
  readFile,
  writeFile,
  appendFile,
  ensureDir,
  fileExists,
  baseDir: getPaiDir(),
};

export const SettingsGuard: SyncHookContract<
  ToolHookInput,
  ContinueOutput | AskOutput,
  SettingsGuardDeps
> = {
  name: "SettingsGuard",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name === "Bash") return true;

    if (["Edit", "Write"].includes(input.tool_name)) {
      const filePath = getFilePath(input);
      return filePath !== null && /settings(?:\.local)?\.json$/.test(filePath);
    }

    return false;
  },

  execute(
    input: ToolHookInput,
    deps: SettingsGuardDeps,
  ): Result<ContinueOutput | AskOutput, ResultError> {
    const home = deps.homedir();

    if (input.tool_name === "Bash") {
      // Snapshot settings files before command runs.
      // PostToolUse (SettingsGuardPost) will compare after.
      snapshotSettings(input.session_id, home, deps);
      logSettingsAudit({
        ts: new Date().toISOString(),
        session_id: input.session_id,
        tool: "Bash",
        target: "settings.json",
        action: "snapshotted",
        command: ((input.tool_input?.command as string) || "").slice(0, 500),
      }, deps);
      return ok(continueOk());
    }

    // Edit/Write tools — ask for permission if targeting settings files
    const filePath = getFilePath(input) || "unknown";

    if (!isSettingsPath(filePath, home)) {
      // Matched the filename pattern but not in ~/.claude/ — allow
      return ok(continueOk());
    }

    deps.stderr(`[SettingsGuard] ${input.tool_name} targets settings file: ${filePath}`);
    logSettingsAudit({
      ts: new Date().toISOString(),
      session_id: input.session_id,
      tool: input.tool_name,
      target: filePath,
      action: "asked",
    }, deps);
    return ok(ask(buildAskMessage(input.tool_name, filePath)));
  },

  defaultDeps,
};
