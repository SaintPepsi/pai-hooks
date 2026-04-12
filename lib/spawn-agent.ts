/**
 * Shared spawnAgent() — background Claude agent spawning with lock/log/traceability.
 *
 * PRINCIPLE: Least privileged agent to perform task.
 * Callers should scope each agent to the minimum capabilities required:
 * narrow MCP tools (e.g. read/write for a single file), no hooks unless
 * needed, no extra permissions. More surface = more cost, more drift.
 *
 * Any hook can import this to spawn a background Claude agent. Handles:
 * - Lock file check (skip if fresh, replace if stale > 6 min)
 * - Lock file creation with { ts, source, reason }
 * - Traceability log append (spawned event to JSONL)
 * - spawnBackground("bun", [runnerPath, configJson]) call
 *
 * Returns Result<void, ResultError> — never throws.
 */

import { join } from "node:path";
import { appendFile, fileExists, readFile, removeFile, writeFile } from "@hooks/core/adapters/fs";
import { spawnBackground } from "@hooks/core/adapters/process";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Constants ──────────────────────────────────────────────────────────────

const LOCK_STALE_MS = 6 * 60 * 1000; // 6 minutes

const DEFAULT_MODEL = "opus";
const DEFAULT_MAX_TURNS = 5;
const DEFAULT_TIMEOUT = 300_000; // 5 minutes

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SpawnAgentConfig {
  prompt: string;
  lockPath: string;
  model?: string;
  maxTurns?: number;
  timeout?: number;
  cwd?: string;
  logPath: string;
  source: string;
  reason: string;
  claudeArgs?: string[];
  sessionStatePath?: string;
}

export interface SpawnAgentDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  appendFile: (path: string, content: string) => Result<void, ResultError>;
  removeFile: (path: string) => Result<void, ResultError>;
  spawnBackground: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string },
  ) => Result<void, ResultError>;
  runnerPath: string;
  stderr: (msg: string) => void;
}

// ─── Lock File ──────────────────────────────────────────────────────────────

interface LockData {
  ts: string;
  source: string;
  reason: string;
}

function isLockStale(lockContent: string): boolean {
  const parsed: LockData = JSON.parse(lockContent);
  const lockAge = Date.now() - new Date(parsed.ts).getTime();
  return lockAge > LOCK_STALE_MS;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const defaultDeps: SpawnAgentDeps = {
  fileExists,
  readFile,
  writeFile,
  appendFile,
  removeFile,
  spawnBackground,
  runnerPath: join(import.meta.dir, "../runners/agent-runner.ts"),
  stderr: defaultStderr,
};

// ─── Core ───────────────────────────────────────────────────────────────────

export function spawnAgent(
  config: SpawnAgentConfig,
  deps: SpawnAgentDeps = defaultDeps,
): Result<void, ResultError> {
  const { lockPath, logPath, source, reason } = config;

  // 1. Lock file check
  if (deps.fileExists(lockPath)) {
    const lockResult = deps.readFile(lockPath);

    if (lockResult.ok) {
      if (!isLockStale(lockResult.value)) {
        deps.stderr(`[spawnAgent] Lock file fresh, skipping spawn (source: ${source})`);
        return ok(undefined);
      }

      // Stale lock — remove it
      deps.stderr(`[spawnAgent] Removing stale lock for ${source}`);
      deps.removeFile(lockPath);
    }
  }

  // 2. Write lock file
  const lockData: LockData = {
    ts: new Date().toISOString(),
    source,
    reason,
  };
  const lockWriteResult = deps.writeFile(lockPath, JSON.stringify(lockData));
  if (!lockWriteResult.ok) {
    deps.stderr(`[spawnAgent] Failed to write lock: ${lockWriteResult.error.message}`);
    return lockWriteResult;
  }

  // 3. Append traceability log
  const logEntry = JSON.stringify({
    event: "spawned",
    ts: new Date().toISOString(),
    source,
    reason,
  });
  deps.appendFile(logPath, `${logEntry}\n`);

  // 4. Build runner config and spawn
  const runnerConfig = {
    prompt: config.prompt,
    model: config.model ?? DEFAULT_MODEL,
    maxTurns: config.maxTurns ?? DEFAULT_MAX_TURNS,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
    lockPath: config.lockPath,
    logPath: config.logPath,
    source: config.source,
    cwd: config.cwd,
    claudeArgs: config.claudeArgs,
    sessionStatePath: config.sessionStatePath,
  };

  const spawnOpts = config.cwd ? { cwd: config.cwd } : undefined;
  const spawnResult = deps.spawnBackground(
    "bun",
    [deps.runnerPath, JSON.stringify(runnerConfig)],
    spawnOpts,
  );

  if (!spawnResult.ok) {
    deps.stderr(`[spawnAgent] Failed to spawn: ${spawnResult.error.message}`);
    // Clean up lock on spawn failure
    deps.removeFile(lockPath);
    return spawnResult;
  }

  deps.stderr(`[spawnAgent] Spawned background agent (source: ${source})`);
  return ok(undefined);
}
