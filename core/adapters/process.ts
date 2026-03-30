/**
 * Process Adapter — Command execution and environment access wrapped in Result.
 */

import { execSync, spawnSync } from "node:child_process";
import { envVarMissing, type PaiError, processExecFailed, processSpawnFailed } from "@hooks/core/error";
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

export async function exec(
  cmd: string,
  opts: { timeout?: number; cwd?: string; platform?: string } = {},
): Promise<Result<ExecResult, PaiError>> {
  return tryCatchAsync(
    async () => {
      const [shell, flag] = shellForPlatform(opts.platform ?? process.platform);
      const proc = Bun.spawn([shell, flag, cmd], {
        cwd: opts.cwd,
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

export function spawnDetached(cmd: string, args: string[]): Result<void, PaiError> {
  return tryCatch(
    () => {
      Bun.spawn([cmd, ...args], {
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
  opts: { cwd?: string } = {},
): Result<void, PaiError> {
  return tryCatch(
    () => {
      const child = Bun.spawn([cmd, ...args], {
        cwd: opts.cwd,
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
  opts: { cwd?: string; timeout?: number; stdio?: "pipe" | "inherit" | "ignore" } = {},
): Result<string, PaiError> {
  return tryCatch(
    () => {
      const result = execSync(cmd, {
        cwd: opts.cwd,
        timeout: opts.timeout,
        encoding: "utf-8" as BufferEncoding,
        stdio: opts.stdio ?? "pipe",
      });
      return result;
    },
    (e) => processExecFailed(cmd, e),
  );
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
  } = {},
): Result<{ stdout: string; exitCode: number }, PaiError> {
  return tryCatch(
    () => {
      const encoding: BufferEncoding = opts.encoding ?? "utf-8";
      const result = spawnSync(cmd, args, {
        cwd: opts.cwd,
        timeout: opts.timeout,
        encoding,
        stdio: opts.stdio ?? "pipe",
        env: opts.env as NodeJS.ProcessEnv,
      });
      return {
        stdout: result.stdout ?? "",
        exitCode: result.status ?? -1,
      };
    },
    (e) => processSpawnFailed(cmd, e),
  );
}

export function getEnv(name: string): Result<string, PaiError> {
  const value = process.env[name];
  if (value === undefined) return err(envVarMissing(name));
  return ok(value);
}
