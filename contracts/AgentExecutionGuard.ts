/**
 * AgentExecutionGuard Contract — Warn on foreground non-fast agents.
 *
 * Injects a system-reminder warning when Task tool is called without
 * run_in_background: true, unless it's a fast-tier agent.
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput, ContextOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentExecutionGuardDeps {
  stderr: (msg: string) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FAST_AGENT_TYPES = ["Explore"];
const FAST_MODELS = ["haiku"];

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: AgentExecutionGuardDeps = {
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const AgentExecutionGuard: SyncHookContract<
  ToolHookInput,
  ContinueOutput | ContextOutput,
  AgentExecutionGuardDeps
> = {
  name: "AgentExecutionGuard",
  event: "PreToolUse",

  accepts(_input: ToolHookInput): boolean {
    return true; // All Task invocations are checked
  },

  execute(input: ToolHookInput): Result<ContinueOutput | ContextOutput, PaiError> {
    const toolInput = input.tool_input || {};

    // Already using background — correct usage
    if (toolInput.run_in_background === true) {
      return ok({ type: "continue", continue: true });
    }

    // Fast-tier agents don't need background
    const agentType = (toolInput.subagent_type as string) || "";
    if (FAST_AGENT_TYPES.includes(agentType)) {
      return ok({ type: "continue", continue: true });
    }

    // Haiku model indicates fast-tier
    const model = (toolInput.model as string) || "";
    if (FAST_MODELS.includes(model)) {
      return ok({ type: "continue", continue: true });
    }

    // Check for FAST timing in prompt scope
    const prompt = (toolInput.prompt as string) || "";
    if (/##\s*Scope[\s\S]*?Timing:\s*FAST/i.test(prompt)) {
      return ok({ type: "continue", continue: true });
    }

    // VIOLATION: Non-fast agent without run_in_background
    const desc = (toolInput.description as string) || agentType || "unknown";

    const warning = `<system-reminder>
WARNING: FOREGROUND AGENT DETECTED — "${desc}" (${agentType})
run_in_background is NOT set to true. This will BLOCK the user interface.

FIX: Add run_in_background: true to this Task call.

The Algorithm (v0.2.31) requires ALL non-fast agents to run in background:
- Spawn with run_in_background: true
- Report immediately: "Spawned [type] in background..."
- Poll with TaskOutput(block=false) every 15-30s
- Collect results when done

Only exceptions: Explore agents, haiku-model agents, and agents with ## Scope FAST.
</system-reminder>`;

    return ok({ type: "context", content: warning });
  },

  defaultDeps,
};
