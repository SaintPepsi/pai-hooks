/**
 * Process Adapter — Command execution and environment access wrapped in Result.
 */

import { execSync, spawnSync } from "node:child_process";
import {
  envVarMissing,
  processExecFailed,
  processSpawnFailed,
  type ResultError,
} from "@hooks/core/error";
import { err, ok, type Result, tryCatch, tryCatchAsync } from "@hooks/core/result";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Detect the correct shell and flag for the current platform.
 * Returns `["cmd.exe", "/c"]` on Windows, `["sh", "-c"]` on POSIX.
 */
export function shellForPlatform(platform: string): [shell: string, flag: string] {
  if (platform === "win32") return ["cmd.exe", "/c"];
  return ["sh", "-c"];
}

/**
 * Env vars that must never be inherited by spawned child processes.
 *
 * CLAUDECODE is set when the current process is running inside a parent
 * Claude Code session. If inherited by a child process (e.g. a background
 * agent spawned via spawnAgent, or a tool executed by a hook), it would
 * make the child think it is ALSO inside a parent session — which can
 * cause:
 *  - LoadContext / BranchAwareness to short-circuit on SessionStart
 *  - VoiceGate + SkillGuard to mis-detect subagent context
 *  - Hooks intended as standalone children to behave like nested subagents
 *
 * Always strip these before spawning.
 */
const PARENT_SESSION_ENV_KEYS = ["CLAUDECODE", "CLAUDE_CODE", "CLAUDE_AGENT_SDK"] as const;

/**
 * Build a child-process environment derived from `process.env` with parent-
 * session markers stripped. Callers can pass `overrides` to add or replace
 * specific keys for the child.
 */
export function buildChildEnv(
  overrides?: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if ((PARENT_SESSION_ENV_KEYS as readonly string[]).includes(key)) continue;
    env[key] = value;
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }
  }
  return env;
}

export async function exec(
  cmd: string,
  opts: { timeout?: number; cwd?: string; platform?: string } = {},
): Promise<Result<ExecResult, ResultError>> {
  return tryCatchAsync(
    async () => {
      const [shell, flag] = shellForPlatform(opts.platform ?? process.platform);
      const proc = Bun.spawn([shell, flag, cmd], {
        cwd: opts.cwd,
        env: buildChildEnv(),
        stdout: "pipe",
        stderr: "pipe",
      });

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (opts.timeout) {
        timer = setTimeout(() => {
          try {
            proc.kill();
          } catch {}
        }, opts.timeout);
      }

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const exitCode = await proc.exited;

      if (timer) clearTimeout(timer);

      return { stdout, stderr, exitCode };
    },
    (e) => processExecFailed(cmd, e),
  );
}

export function spawnDetached(cmd: string, args: string[]): Result<void, ResultError> {
  return tryCatch(
    () => {
      Bun.spawn([cmd, ...args], {
        env: buildChildEnv(),
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
    },
    (e) => processSpawnFailed(cmd, e),
  );
}

/**
 * Spawn a background process (detached + unref). Fire-and-forget pattern
 * used by GitAutoSync (git push) and WorktreeSafety (dep install, tests).
 */
export function spawnBackground(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Result<void, ResultError> {
  return tryCatch(
    () => {
      const child = Bun.spawn([cmd, ...args], {
        cwd: opts.cwd,
        env: buildChildEnv(opts.env),
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
      child.unref();
    },
    (e) => processSpawnFailed(cmd, e),
  );
}

export function execSyncSafe(
  cmd: string,
  opts: {
    cwd?: string;
    timeout?: number;
    stdio?: "pipe" | "inherit" | "ignore";
  } = {},
): Result<string, ResultError> {
  return tryCatch(
    () => {
      const result = execSync(cmd, {
        cwd: opts.cwd,
        timeout: opts.timeout,
        encoding: "utf-8" as BufferEncoding,
        stdio: opts.stdio ?? "pipe",
        env: buildChildEnv() as NodeJS.ProcessEnv,
      });
      return result;
    },
    (e) => processExecFailed(cmd, e),
  );
}

export interface SpawnSyncResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function spawnSyncSafe(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    timeout?: number;
    stdio?: "pipe" | "inherit" | "ignore";
    encoding?: BufferEncoding;
    env?: Record<string, string | undefined>;
    /** Stdin payload sent to the child process. */
    input?: string;
  } = {},
): Result<SpawnSyncResult, ResultError> {
  return tryCatch(
    () => {
      const encoding: BufferEncoding = opts.encoding ?? "utf-8";
      // Always route through buildChildEnv so parent-session markers
      // (CLAUDECODE, CLAUDE_CODE, CLAUDE_AGENT_SDK) are stripped. Callers
      // pass overrides via opts.env — those keys are merged on top after
      // stripping, consistent with spawnBackground.
      const env = buildChildEnv(opts.env) as NodeJS.ProcessEnv;
      const result = spawnSync(cmd, args, {
        cwd: opts.cwd,
        timeout: opts.timeout,
        encoding,
        stdio: opts.stdio ?? "pipe",
        env,
        input: opts.input,
      });
      // spawnSync does not throw on ENOENT or ETIMEDOUT — it returns
      // normally with result.error set and status === null. Throw so
      // tryCatch can catch it and return an err() result.
      if (result.error) throw result.error;
      // With encoding set, spawnSync returns string | null for stdout/stderr.
      return {
        stdout: (result.stdout as string | null) ?? "",
        stderr: (result.stderr as string | null) ?? "",
        exitCode: result.status ?? -1,
      };
    },
    (e) => processSpawnFailed(cmd, e),
  );
}

export function getEnv(name: string): Result<string, ResultError> {
  const value = process.env[name];
  if (value === undefined) return err(envVarMissing(name));
  return ok(value);
}
