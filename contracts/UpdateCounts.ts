/**
 * UpdateCounts Contract — Spawn background process to refresh system counts.
 *
 * Fires the handler as a detached background process so it never blocks
 * the SessionEnd hook chain. The handler updates settings.json counts
 * (skills, hooks, etc.) asynchronously after the session exits.
 */

import type { HookContract } from "@hooks/core/contract";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { spawnBackground } from "@hooks/core/adapters/process";
import { join } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UpdateCountsDeps {
  spawnBackground: (cmd: string, args: string[]) => Result<void, PaiError>;
  hooksDir: string;
  stderr: (msg: string) => void;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: UpdateCountsDeps = {
  spawnBackground,
  hooksDir: join(process.env.PAI_DIR || join(process.env.HOME!, ".claude"), "pai-hooks"),
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const UpdateCounts: HookContract<
  SessionEndInput,
  SilentOutput,
  UpdateCountsDeps
> = {
  name: "UpdateCounts",
  event: "SessionEnd",

  accepts(_input: SessionEndInput): boolean {
    return true;
  },

  execute(
    _input: SessionEndInput,
    deps: UpdateCountsDeps,
  ): Result<SilentOutput, PaiError> {
    const handlerPath = join(deps.hooksDir, "handlers", "UpdateCounts.ts");
    const result = deps.spawnBackground("bun", [handlerPath]);

    if (!result.ok) {
      deps.stderr(`[UpdateCounts] Failed to spawn background: ${result.error.message}`);
    }

    return ok({ type: "silent" });
  },

  defaultDeps,
};
