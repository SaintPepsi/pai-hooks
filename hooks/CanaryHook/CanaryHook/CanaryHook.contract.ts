import type { SyncHookContract } from "@hooks/core/contract";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import type { Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { ok } from "@hooks/core/result";
import { appendFile, ensureDir } from "@hooks/core/adapters/fs";
import { execSyncSafe } from "@hooks/core/adapters/process";
import { join } from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CanaryHookDeps {
  appendFile: (path: string, content: string) => Result<void, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  execSyncSafe: (cmd: string) => Result<string, PaiError>;
  baseDir: string;
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: CanaryHookDeps = {
  appendFile,
  ensureDir,
  execSyncSafe,
  baseDir: join(process.env.HOME!, ".claude"),
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const CanaryHook: SyncHookContract<
  SessionStartInput,
  ContinueOutput,
  CanaryHookDeps
> = {
  name: "CanaryHook",
  event: "SessionStart",

  accepts(): boolean {
    return true;
  },

  execute(_input: SessionStartInput, deps: CanaryHookDeps): Result<ContinueOutput, PaiError> {
    const logDir = join(deps.baseDir, "MEMORY", "STATE", "logs");
    const logFile = join(logDir, "canary-hook.log");

    deps.ensureDir(logDir);
    deps.appendFile(logFile, new Date().toISOString() + "\n");
    deps.execSyncSafe(`code "${logFile}"`);

    return ok({ type: "continue" as const, continue: true as const });
  },

  defaultDeps,
};
