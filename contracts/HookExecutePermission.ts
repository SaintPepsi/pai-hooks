/**
 * HookExecutePermission Contract — Auto-chmod hook files after creation.
 *
 * PostToolUse on Write: when a .hook.ts file is written to the hooks directory,
 * automatically sets the execute permission bit. Prevents the recurring issue
 * where new hooks are created without +x and fail silently.
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { execSyncSafe } from "@hooks/core/adapters/process";

export interface HookExecutePermissionDeps {
  execSync: (cmd: string) => Result<string, PaiError>;
  stderr: (msg: string) => void;
}

const defaultDeps: HookExecutePermissionDeps = {
  execSync: (cmd) => execSyncSafe(cmd, { timeout: 5000 }),
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

function isHookFile(filePath: string): boolean {
  return filePath.includes("/hooks/") && filePath.endsWith(".hook.ts");
}

export const HookExecutePermission: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  HookExecutePermissionDeps
> = {
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
  ): Result<ContinueOutput, PaiError> {
    const filePath = input.tool_input?.file_path as string;

    const result = deps.execSync(`chmod +x "${filePath}"`);
    if (!result.ok) {
      deps.stderr(`[HookExecutePermission] chmod failed: ${result.error.message}`);
    } else {
      deps.stderr(`[HookExecutePermission] Set +x on ${filePath}`);
    }

    return ok({ type: "continue", continue: true });
  },

  defaultDeps,
};
