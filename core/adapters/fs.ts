/**
 * Filesystem Adapter — All file I/O wrapped in Result.
 *
 * This is one of the ONLY places try/catch exists in the hook system.
 */

import {
  appendFileSync,
  copyFileSync,
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  dirCreateFailed,
  fileNotFound,
  fileReadFailed,
  fileWriteFailed,
  type ResultError,
} from "@hooks/core/error";
import { type Result, tryCatch } from "@hooks/core/result";

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export function readFile(path: string): Result<string, ResultError> {
  if (!existsSync(path)) return { ok: false, error: fileNotFound(path) };
  return tryCatch(
    () => readFileSync(path, "utf-8") as string,
    (e) => fileReadFailed(path, e),
  );
}

export function readJson<T = unknown>(path: string): Result<T, ResultError> {
  const content = readFile(path);
  if (!content.ok) return content;
  return tryCatch(
    () => JSON.parse(content.value) as T,
    (e) => fileReadFailed(path, e),
  );
}

export function writeFile(path: string, content: string): Result<void, ResultError> {
  return tryCatch(
    () => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf-8");
    },
    (e) => fileWriteFailed(path, e),
  );
}

export function writeJson(path: string, data: unknown): Result<void, ResultError> {
  return writeFile(path, JSON.stringify(data, null, 2));
}

/**
 * Atomic exclusive-create write. Returns ok if file was created,
 * err if it already exists or another error occurs.
 * Used by the dedup guard for cross-process lock acquisition.
 */
export function writeFileExclusive(path: string, content: string): Result<void, ResultError> {
  return tryCatch(
    () => {
      writeFileSync(path, content, { flag: "wx" });
    },
    (e) => fileWriteFailed(path, e),
  );
}

/**
 * Atomic write. Writes to a temp file then renames into place.
 * Prevents partial-write corruption and reduces read-modify-write race windows.
 */
export function writeFileAtomic(path: string, content: string): Result<void, ResultError> {
  const tmpPath = `${path}.${process.pid}.tmp`;
  return tryCatch(
    () => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(tmpPath, content, "utf-8");
      renameSync(tmpPath, path);
    },
    (e) => fileWriteFailed(path, e),
  );
}

export function appendFile(path: string, content: string): Result<void, ResultError> {
  return tryCatch(
    () => {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, content, "utf-8");
    },
    (e) => fileWriteFailed(path, e),
  );
}

export function ensureDir(path: string): Result<void, ResultError> {
  return tryCatch(
    () => {
      mkdirSync(path, { recursive: true });
    },
    (e) => dirCreateFailed(path, e),
  );
}

export function removeFile(path: string): Result<void, ResultError> {
  return tryCatch(
    () => {
      unlinkSync(path);
    },
    (e) => fileWriteFailed(path, e),
  );
}

export function removeDir(path: string): Result<void, ResultError> {
  return tryCatch(
    () => {
      rmSync(path, { recursive: true, force: true });
    },
    (e) => dirCreateFailed(path, e),
  );
}

export function setFileTimes(path: string, atime: Date, mtime: Date): Result<void, ResultError> {
  return tryCatch(
    () => {
      utimesSync(path, atime, mtime);
    },
    (e) => fileWriteFailed(path, e),
  );
}

export function copyFile(src: string, dest: string): Result<void, ResultError> {
  return tryCatch(
    () => {
      copyFileSync(src, dest);
    },
    (e) => fileWriteFailed(dest, e),
  );
}

export function stat(
  path: string,
): Result<{ mtimeMs: number; isDirectory(): boolean }, ResultError> {
  return tryCatch(
    () => {
      const s = statSync(path);
      return { mtimeMs: s.mtimeMs, isDirectory: () => s.isDirectory() };
    },
    (e) => fileReadFailed(path, e),
  );
}

export function readDir(path: string, opts: { withFileTypes: true }): Result<Dirent[], ResultError>;
export function readDir(path: string): Result<string[], ResultError>;
export function readDir(
  path: string,
  opts?: { withFileTypes: true },
): Result<Dirent[] | string[], ResultError> {
  return tryCatch(
    () => (opts ? readdirSync(path, opts) : readdirSync(path)),
    (e) => fileReadFailed(path, e),
  );
}

export function symlink(target: string, path: string): Result<void, ResultError> {
  return tryCatch(
    () => {
      symlinkSync(target, path);
    },
    (e) => fileWriteFailed(path, e),
  );
}

export function lstat(path: string): Result<{ isSymbolicLink(): boolean }, ResultError> {
  return tryCatch(
    () => {
      const s = lstatSync(path);
      return { isSymbolicLink: () => s.isSymbolicLink() };
    },
    (e) => fileReadFailed(path, e),
  );
}

// Re-export for adapter completeness
export { fileExists as exists };
