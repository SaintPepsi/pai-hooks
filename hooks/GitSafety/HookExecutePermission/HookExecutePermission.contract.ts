/**
 * HookExecutePermission Contract — Auto-chmod hook files after creation.
 *
 * PostToolUse on Write: when a .hook.ts file is written to the hooks directory,
 * automatically sets the execute permission bit. Prevents the recurring issue
 * where new hooks are created without +x and fail silently.
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { execSyncSafe } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr } from "@hooks/lib/paths";

export interface HookExecutePermissionDeps {
  execSync: (cmd: string) => Result<string, ResultError>;
  stderr: (msg: string) => void;
}

function isHookFile(filePath: string): boolean {
  return filePath.includes("/hooks/") && filePath.endsWith(".hook.ts");
}

const defaultDeps: HookExecutePermissionDeps = {
  execSync: (cmd) => execSyncSafe(cmd, { timeout: 5000 }),
  stderr: defaultStderr,
};

export const HookExecutePermission: SyncHookContract<ToolHookInput, HookExecutePermissionDeps> = {
  name: "HookExecutePermission",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name !== "Write") return false;
    const filePath = (input.tool_input?.file_path as string) || "";
    return isHookFile(filePath);
  },

  execute(
    input: ToolHookInput,
    deps: HookExecutePermissionDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const filePath = input.tool_input?.file_path as string;

    const result = deps.execSync(`chmod +x "${filePath}"`);
    if (!result.ok) {
      deps.stderr(`[HookExecutePermission] chmod failed: ${result.error.message}`);
    } else {
      deps.stderr(`[HookExecutePermission] Set +x on ${filePath}`);
    }

    return ok({ continue: true });
  },

  defaultDeps,
};
