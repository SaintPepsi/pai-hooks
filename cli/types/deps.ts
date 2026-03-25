/**
 * CLI Deps interface — Dependency injection boundary for CLI modules.
 *
 * Narrow interface: only methods that this issue's code consumes.
 * Pattern matches core/adapters but scoped to CLI needs.
 */

import type { Result } from "@hooks/cli/core/result";
import { ok, err } from "@hooks/cli/core/result";
import { PaihError, PaihErrorCode, manifestMissing } from "@hooks/cli/core/error";
import type { ExecResult } from "@hooks/cli/adapters/process";

// ─── Deps Interface ─────────────────────────────────────────────────────────

export interface CliDeps {
  // Filesystem
  readFile: (path: string) => Result<string, PaihError>;
  writeFile: (path: string, content: string) => Result<void, PaihError>;
  deleteFile: (path: string) => Result<void, PaihError>;
  fileExists: (path: string) => boolean;
  readDir: (path: string) => Result<string[], PaihError>;
  ensureDir: (path: string) => Result<void, PaihError>;
  removeDir: (path: string) => Result<void, PaihError>;
  stat: (path: string) => Result<{ isDirectory: boolean }, PaihError>;

  // Process
  cwd: () => string;
  exec: (cmd: string, opts?: { cwd?: string }) => Result<ExecResult, PaihError>;
}

// ─── InMemoryDeps ───────────────────────────────────────────────────────────

/**
 * Test double — all operations work against an in-memory file tree.
 * Constructor accepts Record<string, string> where keys are absolute paths.
 */
export class InMemoryDeps implements CliDeps {
  private files: Map<string, string>;
  private dirs: Set<string>;
  private _cwd: string;

  constructor(fileTree: Record<string, string>, cwd = "/test") {
    this.files = new Map(Object.entries(fileTree));
    this.dirs = new Set<string>();
    this._cwd = cwd;

    // Derive directories from file paths
    for (const filePath of this.files.keys()) {
      let dir = parentDir(filePath);
      while (dir !== "/" && dir !== ".") {
        this.dirs.add(dir);
        dir = parentDir(dir);
      }
      this.dirs.add("/");
    }
  }

  readFile(path: string): Result<string, PaihError> {
    const content = this.files.get(path);
    if (content === undefined) {
      return err(manifestMissing(path));
    }
    return ok(content);
  }

  writeFile(path: string, content: string): Result<void, PaihError> {
    // Derive parent dirs
    let dir = parentDir(path);
    while (dir !== "/" && dir !== ".") {
      this.dirs.add(dir);
      dir = parentDir(dir);
    }
    this.files.set(path, content);
    return ok(undefined);
  }

  deleteFile(path: string): Result<void, PaihError> {
    this.files.delete(path);
    return ok(undefined);
  }

  fileExists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  readDir(path: string): Result<string[], PaihError> {
    const entries: string[] = [];
    const prefix = path.endsWith("/") ? path : path + "/";

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relative = filePath.slice(prefix.length);
        const firstSegment = relative.split("/")[0];
        if (firstSegment && !entries.includes(firstSegment)) {
          entries.push(firstSegment);
        }
      }
    }

    for (const dirPath of this.dirs) {
      if (dirPath.startsWith(prefix)) {
        const relative = dirPath.slice(prefix.length);
        const firstSegment = relative.split("/")[0];
        if (firstSegment && !entries.includes(firstSegment)) {
          entries.push(firstSegment);
        }
      }
    }

    return ok(entries.sort());
  }

  ensureDir(path: string): Result<void, PaihError> {
    let dir = path;
    while (dir !== "/" && dir !== ".") {
      this.dirs.add(dir);
      dir = parentDir(dir);
    }
    return ok(undefined);
  }

  removeDir(path: string): Result<void, PaihError> {
    const prefix = path.endsWith("/") ? path : path + "/";
    // Remove all files under this directory
    for (const filePath of [...this.files.keys()]) {
      if (filePath.startsWith(prefix)) {
        this.files.delete(filePath);
      }
    }
    // Remove all subdirectories
    for (const dirPath of [...this.dirs]) {
      if (dirPath === path || dirPath.startsWith(prefix)) {
        this.dirs.delete(dirPath);
      }
    }
    return ok(undefined);
  }

  stat(path: string): Result<{ isDirectory: boolean }, PaihError> {
    if (this.files.has(path)) {
      return ok({ isDirectory: false });
    }
    if (this.dirs.has(path)) {
      return ok({ isDirectory: true });
    }
    return err(
      new PaihError(PaihErrorCode.ManifestMissing, `Not found: ${path}`, { path }),
    );
  }

  cwd(): string {
    return this._cwd;
  }

  exec(cmd: string, _opts?: { cwd?: string }): Result<ExecResult, PaihError> {
    // Default stub: simulate successful execution for common checks
    if (cmd === "bun --version") {
      return ok({ stdout: "1.0.0\n", stderr: "", exitCode: 0 });
    }
    return ok({ stdout: "", stderr: "", exitCode: 0 });
  }

  /** Add a file after construction (for test setup). */
  addFile(path: string, content: string): void {
    this.writeFile(path, content);
  }

  /** Get raw file map for assertions. */
  getFiles(): Map<string, string> {
    return new Map(this.files);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parentDir(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return path.slice(0, lastSlash);
}
