/**
 * CheckVersion Contract — Check for Claude Code updates at session start.
 *
 * Compares installed CC version against npm latest. Logs notification
 * to stderr if an update is available. Skips for subagents.
 */

import { exec } from "@hooks/core/adapters/process";
import type { AsyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { isSubagent } from "@hooks/lib/environment";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CheckVersionDeps {
  getCurrentVersion: () => Promise<Result<string, PaiError>>;
  getLatestVersion: () => Promise<Result<string, PaiError>>;
  isSubagent: () => boolean;
  stderr: (msg: string) => void;
}

// ─── Default Implementations ─────────────────────────────────────────────────

async function defaultGetCurrentVersion(): Promise<Result<string, PaiError>> {
  const result = await exec("claude --version", { timeout: 5000 });
  if (!result.ok) return result;
  const match = result.value.stdout.match(/(\d+\.\d+\.\d+)/);
  return ok(match ? match[1] : "unknown");
}

async function defaultGetLatestVersion(): Promise<Result<string, PaiError>> {
  const result = await exec("npm view @anthropic-ai/claude-code version", { timeout: 10000 });
  if (!result.ok) return result;
  const trimmed = result.value.stdout.trim();
  return ok(trimmed || "unknown");
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: CheckVersionDeps = {
  getCurrentVersion: defaultGetCurrentVersion,
  getLatestVersion: defaultGetLatestVersion,
  isSubagent: () => isSubagent((k) => process.env[k]),
  stderr: (msg) => process.stderr.write(`${msg}\n`),
};

export const CheckVersion: AsyncHookContract<SessionStartInput, SilentOutput, CheckVersionDeps> = {
  name: "CheckVersion",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  async execute(
    _input: SessionStartInput,
    deps: CheckVersionDeps,
  ): Promise<Result<SilentOutput, PaiError>> {
    if (deps.isSubagent()) {
      return ok({ type: "silent" });
    }

    const [currentResult, latestResult] = await Promise.all([
      deps.getCurrentVersion(),
      deps.getLatestVersion(),
    ]);

    if (!currentResult.ok || !latestResult.ok) {
      return ok({ type: "silent" });
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

    return ok({ type: "silent" });
  },

  defaultDeps,
};
