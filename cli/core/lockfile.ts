/**
 * Lockfile I/O — Read, write, and update paih.lock.json.
 *
 * The lockfile tracks which hooks were installed, their source,
 * and the command strings written to settings.json.
 *
 * Stored at .claude/hooks/pai-hooks/paih.lock.json
 * (schema defined in cli/types/lockfile.ts).
 */

import type { Result } from "@hooks/cli/core/result";
import { ok, err } from "@hooks/cli/core/result";
import { tryCatch } from "@hooks/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { lockCorrupt, PaihErrorCode, PaihError as PaihErrorClass } from "@hooks/cli/core/error";
import type { CliDeps } from "@hooks/cli/types/deps";
import type { Lockfile, LockfileHookEntry } from "@hooks/cli/types/lockfile";
import { DEFAULT_OUTPUT_MODE } from "@hooks/cli/types/lockfile";

// ─── Read / Write ───────────────────────────────────────────────────────────

/** Read paih.lock.json. Returns null if file does not exist. */
export function readLockfile(
  claudeDir: string,
  deps: CliDeps,
): Result<Lockfile | null, PaihError> {
  const lockPath = `${claudeDir}/hooks/pai-hooks/paih.lock.json`;

  if (!deps.fileExists(lockPath)) {
    return ok(null);
  }

  const content = deps.readFile(lockPath);
  if (!content.ok) return content;

  const parsed = safeJsonParse(content.value, lockPath);
  if (!parsed.ok) return parsed;

  const lockfile = parsed.value as Lockfile;

  if (lockfile.lockfileVersion !== 1) {
    return err(lockCorrupt(lockPath));
  }

  return ok(lockfile);
}

/** Write paih.lock.json to .claude/hooks/. */
export function writeLockfile(
  claudeDir: string,
  lockfile: Lockfile,
  deps: CliDeps,
): Result<void, PaihError> {
  const lockPath = `${claudeDir}/hooks/pai-hooks/paih.lock.json`;
  const content = JSON.stringify(lockfile, null, 2) + "\n";

  const ensureResult = deps.ensureDir(`${claudeDir}/hooks/pai-hooks`);
  if (!ensureResult.ok) return ensureResult;

  return deps.writeFile(lockPath, content);
}

// ─── Mutation ───────────────────────────────────────────────────────────────

/** Add a hook entry to the lockfile. Deduplicates by commandString. */
export function addHookEntry(
  lockfile: Lockfile,
  entry: LockfileHookEntry,
): Lockfile {
  const existing = lockfile.hooks.findIndex(
    (h) => h.commandString === entry.commandString,
  );

  const hooks = [...lockfile.hooks];
  if (existing >= 0) {
    hooks[existing] = entry;
  } else {
    hooks.push(entry);
  }

  return { ...lockfile, hooks };
}

/** Remove a hook entry from the lockfile by name. */
export function removeHookEntry(
  lockfile: Lockfile,
  hookName: string,
): Lockfile {
  const hooks = lockfile.hooks.filter((h) => h.name !== hookName);
  return { ...lockfile, hooks };
}

/** Compute SHA-256 content hash of a file. */
export function computeFileHash(
  filePath: string,
  deps: CliDeps,
): Result<string, PaihError> {
  const content = deps.readFile(filePath);
  if (!content.ok) return content;

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content.value);
  return ok(hasher.digest("hex"));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse JSON using tryCatch at the adapter boundary (per core/result.ts). */
function safeJsonParse(content: string, path: string): Result<Lockfile, PaihError> {
  return tryCatch(
    () => JSON.parse(content) as Lockfile,
    () => new PaihErrorClass(
      PaihErrorCode.LockCorrupt,
      `Failed to parse lockfile at ${path}`,
      { path },
    ),
  );
}
