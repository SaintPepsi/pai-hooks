/**
 * CLI Filesystem Adapter — Result-wrapped file I/O for the paih CLI.
 *
 * Mirrors the pattern from core/adapters/fs.ts but uses PaihError codes.
 * This is one of the ONLY places try/catch exists in the CLI system.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "fs";
import { dirname } from "path";
import type { Result } from "@hooks/cli/core/result";
import { ok } from "@hooks/cli/core/result";
import { type PaihError, PaihErrorCode, PaihError as PaihErrorClass, writeFailed } from "@hooks/cli/core/error";
import { tryCatch } from "@hooks/core/result";

// ─── Adapter Functions ──────────────────────────────────────────────────────

export function readFile(path: string): Result<string, PaihError> {
  if (!existsSync(path)) {
    return {
      ok: false,
      error: new PaihErrorClass(
        PaihErrorCode.ManifestMissing,
        `File not found: ${path}`,
        { path },
      ),
    };
  }
  return tryCatch(
    () => readFileSync(path, "utf-8") as string,
    (e) => new PaihErrorClass(
      PaihErrorCode.ManifestParseError,
      `Failed to read: ${path}`,
      { path, cause: e instanceof Error ? e.message : String(e) },
    ),
  );
}

export function writeFile(path: string, content: string): Result<void, PaihError> {
  return tryCatch(
    () => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf-8");
    },
    (e) => writeFailed(path, e instanceof Error ? e : new Error(String(e))),
  );
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export function readDir(path: string): Result<string[], PaihError> {
  return tryCatch(
    () => readdirSync(path) as string[],
    (e) => new PaihErrorClass(
      PaihErrorCode.ManifestMissing,
      `Failed to read directory: ${path}`,
      { path, cause: e instanceof Error ? e.message : String(e) },
    ),
  );
}

export function ensureDir(path: string): Result<void, PaihError> {
  return tryCatch(
    () => { mkdirSync(path, { recursive: true }); },
    (e) => writeFailed(path, e instanceof Error ? e : new Error(String(e))),
  );
}

export function stat(path: string): Result<{ isDirectory: boolean }, PaihError> {
  return tryCatch(
    () => {
      const s = statSync(path);
      return { isDirectory: s.isDirectory() };
    },
    (e) => new PaihErrorClass(
      PaihErrorCode.ManifestMissing,
      `Failed to stat: ${path}`,
      { path, cause: e instanceof Error ? e.message : String(e) },
    ),
  );
}
