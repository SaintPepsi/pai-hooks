import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { appendFile, ensureDir } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import { ok } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { getPaiDir } from "@hooks/lib/paths";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CanaryHookDeps {
  appendFile: (path: string, content: string) => Result<void, ResultError>;
  ensureDir: (path: string) => Result<void, ResultError>;
  baseDir: string;
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: CanaryHookDeps = {
  appendFile,
  ensureDir,
  baseDir: getPaiDir(),
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const CanaryHook: SyncHookContract<SessionStartInput, CanaryHookDeps> = {
  name: "CanaryHook",
  event: "SessionStart",

  accepts(): boolean {
    return true;
  },

  execute(
    _input: SessionStartInput,
    deps: CanaryHookDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const logDir = join(deps.baseDir, "MEMORY", "STATE", "logs");
    const logFile = join(logDir, "canary-hook.log");

    deps.ensureDir(logDir);
    deps.appendFile(logFile, `${new Date().toISOString()}\n`);

    return ok({ continue: true });
  },

  defaultDeps,
};
