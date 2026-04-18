/**
 * Agent Runner — Generic runner spawned as a detached background process.
 *
 * Receives config as a JSON CLI arg, runs claude synchronously, and
 * deterministically cleans up lock/log files regardless of exit status.
 *
 * Hard safety guard: if BUN_TEST env var is set and --dry-run is NOT passed,
 * throws immediately to prevent accidental token burn in tests.
 */

import { appendFile, readFile, removeFile, writeFile } from "@hooks/core/adapters/fs";
import { safeJsonParse } from "@hooks/core/adapters/json";
import { spawnSyncSafe } from "@hooks/core/adapters/process";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";

// ─── Types ─────────────────────────────────────────────────────────────────

interface ClaudeJsonOutput {
  session_id?: string;
  result?: string;
  is_error?: boolean;
}

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
  sessionStatePath?: string;
}

export interface AgentRunnerDeps {
  appendFile: (path: string, content: string) => Result<void, ResultError>;
  readFile: (path: string) => Result<string, ResultError>;
  removeFile: (path: string) => Result<void, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  spawnSyncSafe: typeof spawnSyncSafe;
  stderr: (msg: string) => void;
  env: Record<string, string | undefined>;
}

const defaultDeps: AgentRunnerDeps = {
  appendFile,
  readFile,
  removeFile,
  writeFile,
  spawnSyncSafe,
  stderr: (msg) => process.stderr.write(`${msg}\n`),
  env: process.env as Record<string, string | undefined>,
};

// ─── Logging ───────────────────────────────────────────────────────────────

function logEvent(
  logPath: string,
  data: Record<string, string | number>,
  deps: AgentRunnerDeps,
): void {
  const entry = { ts: new Date().toISOString(), ...data };
  deps.appendFile(logPath, `${JSON.stringify(entry)}\n`);
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
    logEvent(
      config.logPath,
      { event: "dry-run", source: config.source, model: config.model },
      deps,
    );
    // Exercise cleanup path even in dry-run
    deps.removeFile(config.lockPath);
    return;
  }

  // Check for previous session to resume
  let previousSessionId = "";
  if (config.sessionStatePath) {
    const stateResult = deps.readFile(config.sessionStatePath);
    if (stateResult.ok) previousSessionId = stateResult.value.trim();
  }

  const baseArgs = [
    "--max-turns",
    String(config.maxTurns),
    "--model",
    config.model,
    "--output-format",
    "json",
    ...(config.claudeArgs ?? []),
  ];

  const spawnOpts = {
    cwd: config.cwd,
    timeout: config.timeout,
    stdio: "pipe" as const,
  };

  // Try resume if we have a previous session
  let result = previousSessionId
    ? deps.spawnSyncSafe(
        "claude",
        ["--resume", previousSessionId, "-p", config.prompt, ...baseArgs],
        spawnOpts,
      )
    : deps.spawnSyncSafe("claude", ["-p", config.prompt, ...baseArgs], spawnOpts);

  // Fallback to fresh session if resume failed
  if (!result.ok && previousSessionId) {
    deps.stderr(`[agent-runner] Resume failed, falling back to fresh session`);
    result = deps.spawnSyncSafe("claude", ["-p", config.prompt, ...baseArgs], spawnOpts);
  }

  let sessionId = "";
  if (result.ok && result.value.stdout) {
    const parsed = safeJsonParse(result.value.stdout);
    if (!parsed.ok) {
      deps.stderr(`[agent-runner] Failed to parse claude output: ${parsed.error.message}`);
    } else if (typeof parsed.value === "object" && parsed.value !== null) {
      const output = parsed.value as ClaudeJsonOutput;
      sessionId = output.session_id ?? "";
    }
  }

  if (result.ok && result.value.stderr) {
    deps.stderr(`[agent-runner] claude stderr: ${result.value.stderr}`);
  }

  // Persist session ID for next run
  if (sessionId && config.sessionStatePath) {
    deps.writeFile(config.sessionStatePath, sessionId);
  }

  if (result.ok) {
    logEvent(
      config.logPath,
      {
        event: "completed",
        source: config.source,
        exitCode: result.value.exitCode,
        session: sessionId,
        resumed: previousSessionId ? "true" : "false",
      },
      deps,
    );
  } else {
    logEvent(
      config.logPath,
      { event: "failed", source: config.source, error: result.error.message },
      deps,
    );
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

  const parsed = safeJsonParse(configArg);
  if (!parsed.ok) {
    process.stderr.write(`[agent-runner] Invalid JSON config: ${parsed.error.message}\n`);
    process.exit(1);
  }
  if (typeof parsed.value !== "object" || parsed.value === null) {
    process.stderr.write("[agent-runner] JSON config is not an object\n");
    process.exit(1);
  }
  const config = parsed.value as RunnerConfig;
  runAgent(config, dryRun);
}
