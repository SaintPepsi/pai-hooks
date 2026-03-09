/**
 * UpdateCounts Contract — Refresh system counts at session end.
 *
 * Delegates to the UpdateCounts handler which updates settings.json
 * counts (skills, hooks, etc.) and refreshes usage cache.
 */

import type { HookContract } from "../core/contract";
import type { SessionEndInput } from "../core/types/hook-inputs";
import type { SilentOutput } from "../core/types/hook-outputs";
import { ok, type Result } from "../core/result";
import type { PaiError } from "../core/error";
import { handleUpdateCounts } from "../handlers/UpdateCounts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UpdateCountsDeps {
  handleUpdateCounts: () => Promise<void>;
  stderr: (msg: string) => void;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: UpdateCountsDeps = {
  handleUpdateCounts,
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

  async execute(
    _input: SessionEndInput,
    deps: UpdateCountsDeps,
  ): Promise<Result<SilentOutput, PaiError>> {
    try {
      await deps.handleUpdateCounts();
    } catch (e) {
      deps.stderr(`[UpdateCounts] Error: ${e instanceof Error ? e.message : e}`);
    }
    return ok({ type: "silent" });
  },

  defaultDeps,
};
