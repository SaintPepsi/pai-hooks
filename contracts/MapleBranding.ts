/**
 * MapleBranding Contract — Enforce Maple sign-off on GitHub CLI commands.
 *
 * Blocks `gh` commands (pr/issue create/comment/edit/review, gh api)
 * that contain the default "Generated with Claude Code" footer. Instructs
 * the AI to replace it with the Maple pixel-art sign-off.
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput, BlockOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MapleBrandingDeps {
  stderr: (msg: string) => void;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: MapleBrandingDeps = {
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── Pure Logic ──────────────────────────────────────────────────────────────

const GH_COMMAND_PATTERN = /\bgh\s+(?:(pr|issue)\s+(create|comment|edit|review)|api\b)/;
const CLAUDE_CODE_FOOTER = /Generated with \[Claude Code\]/i;

const MAPLE_SIGNOFF = `<img src="https://github.com/user-attachments/assets/08e4e5de-c220-46c6-968d-1976411654b3" alt="🍁" width="16" height="16"> Maple`;

function isGhCommandWithBody(command: string): boolean {
  return GH_COMMAND_PATTERN.test(command);
}

function containsClaudeCodeFooter(command: string): boolean {
  return CLAUDE_CODE_FOOTER.test(command);
}

// ─── Contract ────────────────────────────────────────────────────────────────

export const MapleBranding: SyncHookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  MapleBrandingDeps
> = {
  name: "MapleBranding",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name !== "Bash") return false;
    const command = String(input.tool_input?.command ?? "");
    return isGhCommandWithBody(command);
  },

  execute(
    input: ToolHookInput,
    deps: MapleBrandingDeps,
  ): Result<ContinueOutput | BlockOutput, PaiError> {
    const command = String(input.tool_input?.command ?? "");

    if (!containsClaudeCodeFooter(command)) {
      return ok({ type: "continue", continue: true });
    }

    deps.stderr("[MapleBranding] Blocked: Claude Code footer detected in gh command");

    return ok({
      type: "block",
      decision: "block",
      reason: [
        'Your gh command contains "Generated with [Claude Code]". Replace that entire line with the Maple sign-off:',
        "",
        MAPLE_SIGNOFF,
        "",
        "Then re-run the command.",
      ].join("\n"),
    });
  },

  defaultDeps,
};
