/**
 * Default CLI Deps — Production CliDeps using real filesystem adapters.
 *
 * This is the ONLY place raw Node/Bun builtins are referenced for CLI deps.
 * All other modules receive CliDeps via dependency injection.
 *
 * Adapter implementations from cli/adapters/fs.ts
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-a0619c6a/cli/adapters/fs.ts).
 */

import type { CliDeps } from "@hooks/cli/types/deps";
import {
  readFile,
  writeFile,
  deleteFile,
  fileExists,
  readDir,
  ensureDir,
  removeDir,
  stat,
} from "@hooks/cli/adapters/fs";
import { cwd } from "@hooks/cli/adapters/process";

// ─── Factory ────────────────────────────────────────────────────────────────

/** Create a production CliDeps using real filesystem and process adapters. */
export function makeDefaultDeps(): CliDeps {
  return {
    readFile,
    writeFile,
    deleteFile,
    fileExists,
    readDir,
    ensureDir,
    removeDir,
    stat,
    cwd,
  };
}
