/**
 * ExecutionEvidenceVerifier — PostToolUse hook for Bash commands.
 *
 * Detects state-changing commands (git push, deploy, curl POST, etc.)
 * that produced thin or absent output, and injects a context reminder
 * nudging the agent to show actual execution evidence in its response.
 *
 * Never blocks. Only injects additionalContext when evidence is missing.
 *
 * Design doc: docs/plans/2026-02-28-execution-evidence-verification.md
 * Classification logic: lib/execution-classification.ts
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import {
  classifyCommand,
  hasSubstantiveOutput,
  buildReminder,
} from "@hooks/lib/execution-classification";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExecutionEvidenceVerifierDeps {
  stderr: (msg: string) => void;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: ExecutionEvidenceVerifierDeps = {
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const ExecutionEvidenceVerifier: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  ExecutionEvidenceVerifierDeps
> = {
  name: "ExecutionEvidenceVerifier",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Bash";
  },

  execute(
    input: ToolHookInput,
    deps: ExecutionEvidenceVerifierDeps,
  ): Result<ContinueOutput, PaiError> {
    const command = (input.tool_input?.command as string) || "";

    const classification = classifyCommand(command);

    if (!classification.isStateChanging) {
      return ok({ type: "continue", continue: true });
    }

    if (hasSubstantiveOutput(input.tool_response)) {
      return ok({ type: "continue", continue: true });
    }

    const reminder = buildReminder(command, classification);
    deps.stderr(
      `[ExecutionEvidenceVerifier] Injecting evidence reminder for: ${command.slice(0, 60)}`,
    );

    return ok({
      type: "continue",
      continue: true,
      additionalContext: reminder,
    });
  },

  defaultDeps,
};
