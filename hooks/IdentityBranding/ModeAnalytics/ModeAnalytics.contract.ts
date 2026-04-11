/**
 * ModeAnalytics Contract — Collects mode data and regenerates dashboard on session end.
 *
 * Runs two scripts in sequence:
 *   1. CollectModeData.ts — scans transcripts, updates mode-analytics.json
 *   2. GenerateDashboard.ts — reads JSON, writes HTML (opens browser every 25th run)
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { execSyncSafe } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ModeAnalyticsDeps {
  execSyncSafe: (
    cmd: string,
    opts?: { cwd?: string; timeout?: number },
  ) => Result<string, ResultError>;
  stderr: (msg: string) => void;
  baseDir: string;
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: ModeAnalyticsDeps = {
  execSyncSafe,
  stderr: defaultStderr,
  baseDir: getPaiDir(),
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const ModeAnalytics: SyncHookContract<SessionEndInput, ModeAnalyticsDeps> = {
  name: "ModeAnalytics",
  event: "SessionEnd",

  accepts(_input: SessionEndInput): boolean {
    return true;
  },

  execute(
    _input: SessionEndInput,
    deps: ModeAnalyticsDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const toolDir = join(deps.baseDir, "Tools", "mode-analytics");

    const collectResult = deps.execSyncSafe(`bun "${join(toolDir, "CollectModeData.ts")}"`, {
      timeout: 30000,
    });
    if (!collectResult.ok) {
      deps.stderr(`[ModeAnalytics] Collection failed: ${collectResult.error.message}`);
      return ok({});
    }

    const genResult = deps.execSyncSafe(`bun "${join(toolDir, "GenerateDashboard.ts")}"`, {
      timeout: 15000,
    });
    if (genResult.ok) {
      deps.stderr("[ModeAnalytics] Data collected and dashboard regenerated");
    } else {
      deps.stderr(`[ModeAnalytics] Dashboard generation failed: ${genResult.error.message}`);
    }

    return ok({});
  },

  defaultDeps,
};
