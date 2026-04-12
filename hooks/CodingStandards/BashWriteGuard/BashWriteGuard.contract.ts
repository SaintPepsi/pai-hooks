/**
 * BashWriteGuard Contract — Block Bash commands that write to .ts/.tsx files.
 *
 * PreToolUse hook that fires on Bash commands referencing TypeScript files.
 * Detects write patterns (redirect, sed -i, tee, cp, mv) and blocks them,
 * forcing the AI to use Edit/Write tools where CodingStandardsEnforcer runs.
 *
 * This closes the bypass path where the AI uses bash to circumvent
 * coding standards enforcement.
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { pickNarrative } from "@hooks/lib/narrative-reader";
import { defaultStderr } from "@hooks/lib/paths";
import { getCommand } from "@hooks/lib/tool-input";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BashWriteGuardDeps {
  stderr: (msg: string) => void;
}

// ─── Pure Functions ──────────────────────────────────────────────────────────

const TS_FILE_PATTERN = /\.tsx?\b/;

/** Check if command contains a write pattern targeting a .ts/.tsx file. */
function detectsWriteToTypeScript(command: string): boolean {
  // Output redirection: > file.ts, >> file.ts
  if (/>{1,2}\s*\S*\.tsx?\b/.test(command)) return true;

  // sed in-place: sed -i on .ts file
  if (/\bsed\b.*-i\b/.test(command) && TS_FILE_PATTERN.test(command)) return true;

  // tee targeting .ts file: tee file.ts, tee -a file.ts
  if (/\btee\b/.test(command) && TS_FILE_PATTERN.test(command)) {
    // Verify tee's target is the .ts file (it appears after tee)
    const teeMatch = command.match(/\btee\b\s+(?:-a\s+)?(\S+)/);
    if (teeMatch && TS_FILE_PATTERN.test(teeMatch[1])) return true;
  }

  // cp/mv to .ts destination: last argument is the destination
  if (/\b(?:cp|mv)\b/.test(command)) {
    const parts = command.trim().split(/\s+/);
    const lastArg = parts[parts.length - 1];
    if (lastArg && TS_FILE_PATTERN.test(lastArg)) return true;
  }

  return false;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: BashWriteGuardDeps = {
  stderr: defaultStderr,
};

export const BashWriteGuard: SyncHookContract<ToolHookInput, BashWriteGuardDeps> = {
  name: "BashWriteGuard",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name !== "Bash") return false;
    const command = getCommand(input);
    return TS_FILE_PATTERN.test(command);
  },

  execute(input: ToolHookInput, deps: BashWriteGuardDeps): Result<SyncHookJSONOutput, ResultError> {
    const command = getCommand(input);

    if (!detectsWriteToTypeScript(command)) {
      return ok({ continue: true });
    }

    const opener = pickNarrative("BashWriteGuard", 1, import.meta.dir);
    const reason = [
      opener,
      "",
      `Command: ${command.slice(0, 200)}`,
      "",
      "Use the Edit or Write tool instead. Those tools are monitored by",
      "CodingStandardsEnforcer which ensures code meets coding standards.",
      "Using Bash to write .ts/.tsx files bypasses coding standards enforcement.",
    ].join("\n");

    deps.stderr(reason);

    return ok({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    });
  },

  defaultDeps,
};
