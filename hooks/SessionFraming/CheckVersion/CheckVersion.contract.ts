/**
 * CheckVersion Contract — Check for Claude Code updates at session start.
 *
 * Compares installed CC version against npm latest. Logs notification
 * to stderr if an update is available. Skips for subagents.
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { exec } from "@hooks/core/adapters/process";
import type { AsyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { isSubagentDefault } from "@hooks/lib/environment";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CheckVersionDeps {
  getCurrentVersion: () => Promise<Result<string, ResultError>>;
  getLatestVersion: () => Promise<Result<string, ResultError>>;
  isSubagent: () => boolean;
  stderr: (msg: string) => void;
}

// ─── Default Implementations ─────────────────────────────────────────────────

async function defaultGetCurrentVersion(): Promise<Result<string, ResultError>> {
  const result = await exec("claude --version", { timeout: 5000 });
  if (!result.ok) return result;
  const match = result.value.stdout.match(/(\d+\.\d+\.\d+)/);
  return ok(match ? match[1] : "unknown");
}

async function defaultGetLatestVersion(): Promise<Result<string, ResultError>> {
  const result = await exec("npm view @anthropic-ai/claude-code version", {
    timeout: 10000,
  });
  if (!result.ok) return result;
  const trimmed = result.value.stdout.trim();
  return ok(trimmed || "unknown");
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: CheckVersionDeps = {
  getCurrentVersion: defaultGetCurrentVersion,
  getLatestVersion: defaultGetLatestVersion,
  isSubagent: isSubagentDefault,
  stderr: defaultStderr,
};

export const CheckVersion: AsyncHookContract<SessionStartInput, CheckVersionDeps> = {
  name: "CheckVersion",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  async execute(
    _input: SessionStartInput,
    deps: CheckVersionDeps,
  ): Promise<Result<SyncHookJSONOutput, ResultError>> {
    if (deps.isSubagent()) {
      return ok({});
    }

    const [currentResult, latestResult] = await Promise.all([
      deps.getCurrentVersion(),
      deps.getLatestVersion(),
    ]);

    if (!currentResult.ok || !latestResult.ok) {
      return ok({});
    }

    const currentVersion = currentResult.value;
    const latestVersion = latestResult.value;

    if (
      currentVersion !== "unknown" &&
      latestVersion !== "unknown" &&
      currentVersion !== latestVersion
    ) {
      deps.stderr(`💡 Update available: CC ${currentVersion} → ${latestVersion}`);
    }

    return ok({});
  },

  defaultDeps,
};
