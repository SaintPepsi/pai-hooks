/**
 * Target Resolution — Locate the .claude/ directory by walking up the filesystem.
 *
 * Starting from a given directory, walks up parent directories until it finds
 * a `.claude/` directory. This identifies the Claude Code project root.
 */

import type { Result } from "@hooks/cli/core/result";
import { ok } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { targetNotFound } from "@hooks/cli/core/error";
import type { CliDeps } from "@hooks/cli/types/deps";

/**
 * Walk up from startDir looking for a `.claude/` directory.
 * Returns the absolute path to the directory containing `.claude/`.
 *
 * @param deps - Injectable filesystem dependencies
 * @param startDir - Directory to start searching from (defaults to deps.cwd())
 */
export function resolveTarget(
  deps: CliDeps,
  startDir?: string,
): Result<string, PaihError> {
  const start = startDir ?? deps.cwd();
  let current = start;

  // Walk up until we find .claude/ or hit the filesystem root
  for (;;) {
    const candidatePath = current.endsWith("/")
      ? `${current}.claude`
      : `${current}/.claude`;

    if (deps.fileExists(candidatePath)) {
      return ok(current);
    }

    const parent = parentDir(current);
    if (parent === current) {
      // Reached filesystem root without finding .claude/
      return { ok: false, error: targetNotFound(start) };
    }
    current = parent;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parentDir(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return path.slice(0, lastSlash);
}
