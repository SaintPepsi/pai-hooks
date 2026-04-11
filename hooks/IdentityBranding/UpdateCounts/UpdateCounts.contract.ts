/**
 * UpdateCounts Contract — Spawn background process to refresh system counts.
 *
 * Fires the handler as a detached background process on SessionEnd so
 * counts capture everything that happened during the session. The handler
 * writes to MEMORY/STATE/counts.json (gitignored), not settings.json.
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { spawnBackground } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UpdateCountsDeps {
  spawnBackground: (cmd: string, args: string[]) => Result<void, ResultError>;
  hooksDir: string;
  stderr: (msg: string) => void;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: UpdateCountsDeps = {
  spawnBackground,
  hooksDir: join(getPaiDir(), "pai-hooks"),
  stderr: defaultStderr,
};

export const UpdateCounts: SyncHookContract<SessionEndInput, UpdateCountsDeps> = {
  name: "UpdateCounts",
  event: "SessionEnd",

  accepts(_input: SessionEndInput): boolean {
    return true;
  },

  execute(
    _input: SessionEndInput,
    deps: UpdateCountsDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const handlerPath = join(deps.hooksDir, "handlers", "UpdateCounts.ts");
    const result = deps.spawnBackground("bun", [handlerPath]);

    if (!result.ok) {
      deps.stderr(`[UpdateCounts] Failed to spawn background: ${result.error.message}`);
    }

    return ok({});
  },

  defaultDeps,
};
