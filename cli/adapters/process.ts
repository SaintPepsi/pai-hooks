/**
 * CLI Process Adapter — Result-wrapped process operations for the paih CLI.
 *
 * Mirrors the pattern from core/adapters/process.ts but uses PaihError codes.
 */

import type { Result } from "@hooks/cli/core/result";
import { ok } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { PaihError as PaihErrorClass, PaihErrorCode } from "@hooks/cli/core/error";
import { tryCatch } from "@hooks/core/result";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ─── Adapter Functions ──────────────────────────────────────────────────────

export function exec(cmd: string, opts: { cwd?: string; timeout?: number } = {}): Result<ExecResult, PaihError> {
  return tryCatch(
    () => {
      const result = Bun.spawnSync(["sh", "-c", cmd], {
        cwd: opts.cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        exitCode: result.exitCode,
      };
    },
    (e) => new PaihErrorClass(
      PaihErrorCode.BuildFailed,
      `Command failed: ${cmd}`,
      { cmd, cause: e instanceof Error ? e.message : String(e) },
    ),
  );
}

export function cwd(): string {
  return process.cwd();
}
