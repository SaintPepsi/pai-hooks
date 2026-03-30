/**
 * StartupGreeting Contract — Display PAI banner at session start.
 *
 * Runs Banner.ts tool.
 * Skips for subagents.
 */

import { join } from "node:path";
import { readJson } from "@hooks/core/adapters/fs";
import { spawnSyncSafe } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";
import { isSubagent } from "@hooks/lib/environment";
import type { ContextOutput, SilentOutput } from "@hooks/core/types/hook-outputs";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StartupGreetingDeps {
  readSettings: () => Result<Record<string, unknown>, PaiError>;
  runBanner: () => string | null;
  isSubagent: () => boolean;
  paiDir: string;
  stderr: (msg: string) => void;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: StartupGreetingDeps = {
  readSettings: () => {
    const paiDir = getPaiDir();
    const settingsPath = join(paiDir, "settings.json");
    return readJson<Record<string, unknown>>(settingsPath);
  },
  runBanner: () => {
    const paiDir = getPaiDir();
    const bannerPath = join(paiDir, "PAI/Tools/Banner.ts");
    const result = spawnSyncSafe("bun", ["run", bannerPath], {
      encoding: "utf-8",
      stdio: "pipe",
      env: {
        ...process.env,
        COLUMNS: process.env.COLUMNS,
      },
    });
    if (!result.ok) return null;
    return result.value.stdout || null;
  },
  isSubagent: () => isSubagent((k) => process.env[k]),
  paiDir: getPaiDir(),
  stderr: defaultStderr,
};

export const StartupGreeting: SyncHookContract<
  SessionStartInput,
  ContextOutput | SilentOutput,
  StartupGreetingDeps
> = {
  name: "StartupGreeting",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  execute(
    input: SessionStartInput,
    deps: StartupGreetingDeps,
  ): Result<ContextOutput | SilentOutput, PaiError> {
    if (deps.isSubagent()) {
      return ok({ type: "silent" });
    }

    const bannerOutput = deps.runBanner();
    if (bannerOutput) {
      return ok({ type: "context", content: bannerOutput });
    }

    return ok({ type: "silent" });
  },

  defaultDeps,
};
