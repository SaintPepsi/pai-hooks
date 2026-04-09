/**
 * Agent Runner — Generic runner spawned as a detached background process.
 *
 * Receives config as a JSON CLI arg, runs claude synchronously, and
 * deterministically cleans up lock/log files regardless of exit status.
 *
 * Hard safety guard: if BUN_TEST env var is set and --dry-run is NOT passed,
 * throws immediately to prevent accidental token burn in tests.
 */

import { appendFile, removeFile, writeFile } from "@hooks/core/adapters/fs";
import { spawnSyncSafe } from "@hooks/core/adapters/process";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RunnerConfig {
  prompt: string;
  model: string;
  maxTurns: number;
  timeout: number;
  lockPath: string;
  logPath: string;
  source: string;
  cwd?: string;
  claudeArgs?: string[];
}

export interface AgentRunnerDeps {
  appendFile: (path: string, content: string) => Result<void, ResultError>;
  removeFile: (path: string) => Result<void, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  spawnSyncSafe: typeof spawnSyncSafe;
  stderr: (msg: string) => void;
  env: Record<string, string | undefined>;
}

const defaultDeps: AgentRunnerDeps = {
  appendFile,
  removeFile,
  writeFile,
  spawnSyncSafe,
  stderr: (msg) => process.stderr.write(`${msg}\n`),
  env: process.env as Record<string, string | undefined>,
};

// ─── Logging ───────────────────────────────────────────────────────────────

function logEvent(logPath: string, event: string, deps: AgentRunnerDeps): void {
  const timestamp = new Date().toISOString();
  deps.appendFile(logPath, `${timestamp} ${event}\n`);
}

// ─── Runner ────────────────────────────────────────────────────────────────

export function runAgent(
  config: RunnerConfig,
  dryRun: boolean,
  deps: AgentRunnerDeps = defaultDeps,
): void {
  // Hard safety guard — deliberate throw, not error handling
  if (deps.env.BUN_TEST && !dryRun) {
    throw new Error(
      "BUN_TEST is set but --dry-run was not passed. Refusing to spawn claude in test environment.",
    );
  }

  if (dryRun) {
    logEvent(config.logPath, `dry-run source=${config.source} model=${config.model}`, deps);
    // Exercise cleanup path even in dry-run
    deps.removeFile(config.lockPath);
    return;
  }

  // Real execution
  const result = deps.spawnSyncSafe(
    "claude",
    ["-p", config.prompt, "--max-turns", String(config.maxTurns), "--model", config.model, ...(config.claudeArgs ?? [])],
    {
      cwd: config.cwd,
      timeout: config.timeout,
      stdio: "ignore",
    },
  );

  if (result.ok) {
    logEvent(config.logPath, `completed source=${config.source} exitCode=${result.value.exitCode}`, deps);
  } else {
    logEvent(config.logPath, `failed source=${config.source} error=${result.error.message}`, deps);
  }

  // Cleanup — always runs after sync call returns
  deps.removeFile(config.lockPath);
}

// ─── Script entry point ────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const configArg = args.find((a) => !a.startsWith("--"));

  if (!configArg) {
    process.stderr.write("[agent-runner] Missing JSON config argument\n");
    process.exit(1);
  }

  const config = JSON.parse(configArg) as RunnerConfig;
  runAgent(config, dryRun);
}
