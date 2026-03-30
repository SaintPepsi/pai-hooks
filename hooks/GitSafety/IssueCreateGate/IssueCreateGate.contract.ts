/**
 * IssueCreateGate Contract — Block gh issue create and gh api issue creation.
 *
 * PreToolUse hook that fires on Bash commands. Detects `gh issue create` and
 * `gh api` calls that create issues, and unconditionally blocks them. Forces
 * agents to use the submit_issue MCP tool instead, which wires milestones,
 * project board placement, and issue relationships correctly.
 *
 * Pattern: hooks/GitSafety/ProtectedBranchGuard/ProtectedBranchGuard.contract.ts
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getCommand } from "@hooks/lib/tool-input";
import {
  block,
  type BlockOutput,
  type ContinueOutput,
  continueOk,
} from "@hooks/core/types/hook-outputs";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IssueCreateGateDeps {
  stderr: (msg: string) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Matches:
 *   gh issue create ...
 *   gh api .../issues ...  (any gh api call targeting an issues endpoint)
 */
const ISSUE_CREATE_PATTERN = /\bgh\s+(issue\s+create|api\b[^|&;]*\/issues\b)/;

const BLOCK_MESSAGE = [
  "BLOCKED: gh issue create bypasses the workflow pipeline.",
  "",
  "Use the submit_issue MCP tool instead:",
  "  - Automatically sets the milestone",
  "  - Adds the issue to the project board",
  "  - Wires sub-issue relationships",
  "",
  "gh issue create skips all of these steps and leaves orphaned issues with",
  "no milestone, no board placement, and no relationships.",
].join("\n");

// ─── Pure Functions ─────────────────────────────────────────────────────────

function isIssueCreate(command: string): boolean {
  return ISSUE_CREATE_PATTERN.test(command);
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: IssueCreateGateDeps = {
  stderr: (msg) => process.stderr.write(`${msg}\n`),
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const IssueCreateGate: SyncHookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  IssueCreateGateDeps
> = {
  name: "IssueCreateGate",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Bash";
  },

  execute(
    input: ToolHookInput,
    deps: IssueCreateGateDeps,
  ): Result<ContinueOutput | BlockOutput, PaiError> {
    const command = getCommand(input);

    if (!isIssueCreate(command)) {
      return ok(continueOk());
    }

    deps.stderr(`[IssueCreateGate] BLOCK: gh issue create detected — use submit_issue instead`);

    return ok(block(BLOCK_MESSAGE));
  },

  defaultDeps,
};
