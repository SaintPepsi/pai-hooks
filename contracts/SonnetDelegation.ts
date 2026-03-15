/**
 * SonnetDelegation — Inject Sonnet subagent delegation guidance when
 * the executing-plans skill loads.
 *
 * PostToolUse on Skill tool. When skill is "executing-plans", injects
 * additionalContext instructing Opus to delegate mechanical plan steps
 * to Sonnet subagents. Zero context cost when other skills load.
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SonnetDelegationDeps {
  stderr: (msg: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isExecutingPlans(input: ToolHookInput): boolean {
  if (input.tool_name !== "Skill") return false;
  const toolInput = input.tool_input;
  if (typeof toolInput !== "object" || toolInput === null) return false;
  const skill = (toolInput as Record<string, unknown>).skill;
  if (typeof skill !== "string") return false;
  return skill === "executing-plans" || skill === "superpowers:executing-plans";
}

// ─── Delegation Guidance ─────────────────────────────────────────────────────

const DELEGATION_GUIDANCE = `## Sonnet Delegation — Plan-Driven Execution

For each plan step, classify it before executing:

**MECHANICAL (delegate to Sonnet):**
- Exact file edits with specified content
- Applying a pattern across multiple files
- Running commands and reporting output
- Writing boilerplate from a template or existing pattern

Dispatch via: Agent(model: "sonnet", subagent_type: "Engineer") with exact instructions.
Independent mechanical steps may be dispatched in parallel.

**REASONING (Opus does directly):**
- Architecture decisions or choosing between approaches
- Debugging or diagnosing issues
- Logic design requiring judgment
- Any step where the outcome is not fully predetermined

**ANTI-REQUIREMENTS:**
- Sonnet NEVER makes architectural decisions
- Sonnet NEVER modifies ISC criteria or PRD content
- Opus verifies every Sonnet output before marking step complete
- Sonnet NEVER executes voice curls`;

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: SonnetDelegationDeps = {
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const SonnetDelegation: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  SonnetDelegationDeps
> = {
  name: "SonnetDelegation",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return isExecutingPlans(input);
  },

  execute(
    _input: ToolHookInput,
    deps: SonnetDelegationDeps,
  ): Result<ContinueOutput, PaiError> {
    deps.stderr("[SonnetDelegation] Injecting Sonnet delegation guidance for executing-plans");
    return ok({
      type: "continue",
      continue: true,
      additionalContext: DELEGATION_GUIDANCE,
    });
  },

  defaultDeps,
};
