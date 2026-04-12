/**
 * AgentExecutionGuard Contract — Warn on foreground non-fast agents.
 *
 * Source: contracts/AgentExecutionGuard.ts
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentExecutionGuardDeps {
  stderr: (msg: string) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FAST_AGENT_TYPES = ["Explore"];
const FAST_MODELS = ["haiku"];

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: AgentExecutionGuardDeps = {
  stderr: defaultStderr,
};

export const AgentExecutionGuard: SyncHookContract<ToolHookInput, AgentExecutionGuardDeps> = {
  name: "AgentExecutionGuard",
  event: "PreToolUse",

  accepts(_input: ToolHookInput): boolean {
    return true; // All Task invocations are checked
  },

  execute(
    input: ToolHookInput,
    deps: AgentExecutionGuardDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const toolInput = input.tool_input || {};
    const agentType = (toolInput.subagent_type as string) || "";
    const desc = (toolInput.description as string) || agentType || "unknown";

    // Already using background — correct usage
    if (toolInput.run_in_background === true) {
      deps.stderr(`[AgentExecutionGuard] PASS: "${desc}" already running in background`);
      return ok({ continue: true });
    }

    // Fast-tier agents don't need background
    if (FAST_AGENT_TYPES.includes(agentType)) {
      deps.stderr(`[AgentExecutionGuard] PASS: "${desc}" is fast-tier agent type (${agentType})`);
      return ok({ continue: true });
    }

    // Haiku model indicates fast-tier
    const model = (toolInput.model as string) || "";
    if (FAST_MODELS.includes(model)) {
      deps.stderr(`[AgentExecutionGuard] PASS: "${desc}" uses fast model (${model})`);
      return ok({ continue: true });
    }

    // Check for FAST timing in prompt scope
    const prompt = (toolInput.prompt as string) || "";
    if (/##\s*Scope[\s\S]*?Timing:\s*FAST/i.test(prompt)) {
      deps.stderr(`[AgentExecutionGuard] PASS: "${desc}" has FAST timing in prompt scope`);
      return ok({ continue: true });
    }

    // VIOLATION: Non-fast agent without run_in_background
    deps.stderr(
      `[AgentExecutionGuard] WARN: "${desc}" (${agentType}) is foreground without run_in_background`,
    );

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

    return ok({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: warning,
      },
    });
  },

  defaultDeps,
};
