/**
 * UpdateCounts Contract — Spawn background process to refresh system counts.
 *
 * Fires the handler as a detached background process on SessionEnd so
 * counts capture everything that happened during the session. The handler
 * writes to MEMORY/STATE/counts.json (gitignored), not settings.json.
 */

import { join } from "node:path";
import { spawnBackground } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import { getPaiDir } from "@hooks/lib/paths";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UpdateCountsDeps {
  spawnBackground: (cmd: string, args: string[]) => Result<void, PaiError>;
  hooksDir: string;
  stderr: (msg: string) => void;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: UpdateCountsDeps = {
  spawnBackground,
  hooksDir: join(getPaiDir(), "pai-hooks"),
  stderr: (msg) => process.stderr.write(`${msg}\n`),
};

export const UpdateCounts: SyncHookContract<SessionEndInput, SilentOutput, UpdateCountsDeps> = {
  name: "UpdateCounts",
  event: "SessionEnd",

  accepts(_input: SessionEndInput): boolean {
    return true;
  },

  execute(_input: SessionEndInput, deps: UpdateCountsDeps): Result<SilentOutput, PaiError> {
    const handlerPath = join(deps.hooksDir, "handlers", "UpdateCounts.ts");
    const result = deps.spawnBackground("bun", [handlerPath]);

    if (!result.ok) {
      deps.stderr(`[UpdateCounts] Failed to spawn background: ${result.error.message}`);
    }

    return ok({ type: "silent" });
  },

  defaultDeps,
};
