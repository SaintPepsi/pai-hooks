/**
 * ModeAnalytics Contract — Collects mode data and regenerates dashboard on session end.
 *
 * Runs two scripts in sequence:
 *   1. CollectModeData.ts — scans transcripts, updates mode-analytics.json
 *   2. GenerateDashboard.ts — reads JSON, writes HTML (opens browser every 25th run)
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { execSyncSafe } from "@hooks/core/adapters/process";
import { join } from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ModeAnalyticsDeps {
  execSyncSafe: (cmd: string, opts?: { cwd?: string; timeout?: number }) => Result<string, PaiError>;
  stderr: (msg: string) => void;
  baseDir: string;
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, ".claude");

const defaultDeps: ModeAnalyticsDeps = {
  execSyncSafe,
  stderr: (msg) => process.stderr.write(msg + "\n"),
  baseDir: BASE_DIR,
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const ModeAnalytics: SyncHookContract<
  SessionEndInput,
  SilentOutput,
  ModeAnalyticsDeps
> = {
  name: "ModeAnalytics",
  event: "SessionEnd",

  accepts(_input: SessionEndInput): boolean {
    return true;
  },

  execute(
    _input: SessionEndInput,
    deps: ModeAnalyticsDeps,
  ): Result<SilentOutput, PaiError> {
    const toolDir = join(deps.baseDir, "Tools", "mode-analytics");

    const collectResult = deps.execSyncSafe(`bun "${join(toolDir, "CollectModeData.ts")}"`, { timeout: 30000 });
    if (!collectResult.ok) {
      deps.stderr(`[ModeAnalytics] Collection failed: ${collectResult.error.message}`);
      return ok({ type: "silent" });
    }

    const genResult = deps.execSyncSafe(`bun "${join(toolDir, "GenerateDashboard.ts")}"`, { timeout: 15000 });
    if (genResult.ok) {
      deps.stderr("[ModeAnalytics] Data collected and dashboard regenerated");
    } else {
      deps.stderr(`[ModeAnalytics] Dashboard generation failed: ${genResult.error.message}`);
    }

    return ok({ type: "silent" });
  },

  defaultDeps,
};
