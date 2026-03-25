/**
 * uninstall command — Remove installed hooks from a target project.
 *
 * Supports hook-level and group-level uninstall with modification detection,
 * shared file ref-counting, and _core/ directory cleanup.
 *
 * Pipeline: parseArgs → resolveTarget → readLockfile → detect modifications → remove files → update settings → update lockfile
 *
 * Uses CliDeps for DI (cli/types/deps.ts).
 * Settings unmerge is the inverse of merge (cli/core/settings.ts).
 * File hashes track modifications (cli/core/lockfile.ts).
 */

import type { Result } from "@hooks/cli/core/result";
import { ok, err } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { invalidArgs, lockMissing, fileModified } from "@hooks/cli/core/error";
import type { ParsedArgs } from "@hooks/cli/core/args";
import type { CliDeps } from "@hooks/cli/types/deps";
import type { Lockfile, LockfileHookEntry } from "@hooks/cli/types/lockfile";
import { resolveTarget } from "@hooks/cli/core/target";
import {
  readLockfile,
  writeLockfile,
  removeHookEntry,
  computeFileHash,
} from "@hooks/cli/core/lockfile";
import {
  readSettings,
  writeSettings,
  unmergeHookEntry,
} from "@hooks/cli/core/settings";
import type { SettingsJson } from "@hooks/cli/core/settings";

// ─── Types ──────────────────────────────────────────────────────────────────

interface UninstallPlan {
  hooksToRemove: LockfileHookEntry[];
  sharedFilesToRemove: string[];
  removeCoreDir: boolean;
}

// ─── Uninstall Pipeline ─────────────────────────────────────────────────────

/**
 * Execute the uninstall command.
 *
 * @param args - Parsed CLI arguments with hook/group names and flags.
 * @param deps - Injectable filesystem/process dependencies.
 */
export function uninstall(
  args: ParsedArgs,
  deps: CliDeps,
): Result<string, PaihError> {
  if (args.names.length === 0) {
    return err(invalidArgs("uninstall requires at least one hook or group name"));
  }

  const force = args.flags.force === true;
  const dryRun = args.flags.dryRun === true;
  const fromFlag = typeof args.flags.from === "string" ? args.flags.from : undefined;

  // Step 1: Resolve target .claude/ directory
  const targetResult = resolveTarget(deps, fromFlag);
  if (!targetResult.ok) return targetResult;
  const targetDir = targetResult.value;
  const claudeDir = `${targetDir}/.claude`;

  // Step 2: Read lockfile
  const lockResult = readLockfile(claudeDir, deps);
  if (!lockResult.ok) return lockResult;
  if (!lockResult.value) {
    return err(lockMissing(claudeDir));
  }
  let lockfile: Lockfile = lockResult.value;

  // Step 3: Resolve names to hook entries (hook name or group name)
  const planResult = buildUninstallPlan(args.names, lockfile);
  if (!planResult.ok) return planResult;
  const plan = planResult.value;

  if (plan.hooksToRemove.length === 0) {
    return ok("No matching hooks found in lockfile.");
  }

  if (dryRun) {
    return ok(formatDryRun(plan));
  }

  // Step 4: Check for modifications (unless --force)
  if (!force) {
    const modCheck = checkModifications(plan.hooksToRemove, claudeDir, deps);
    if (!modCheck.ok) return modCheck;
  }

  // Step 5: Remove hook files
  const removeResult = removeHookFiles(plan.hooksToRemove, claudeDir, deps);
  if (!removeResult.ok) return removeResult;

  // Step 6: Remove shared files that are no longer referenced
  for (const sharedFile of plan.sharedFilesToRemove) {
    const absPath = `${claudeDir}/${sharedFile}`;
    if (deps.fileExists(absPath)) {
      deps.deleteFile(absPath);
    }
  }

  // Step 7: Update settings
  const settingsResult = readSettings(claudeDir, deps);
  if (!settingsResult.ok) return settingsResult;
  let settings: SettingsJson = settingsResult.value;

  for (const hook of plan.hooksToRemove) {
    const unmergeResult = unmergeHookEntry(settings, hook.event, hook.commandString);
    if (!unmergeResult.ok) return unmergeResult;
    settings = unmergeResult.value;
  }

  const writeSettingsResult = writeSettings(claudeDir, settings, deps);
  if (!writeSettingsResult.ok) return writeSettingsResult;

  // Step 8: Update lockfile
  for (const hook of plan.hooksToRemove) {
    lockfile = removeHookEntry(lockfile, hook.name);
  }

  const writeLockResult = writeLockfile(claudeDir, lockfile, deps);
  if (!writeLockResult.ok) return writeLockResult;

  // Step 9: Clean up empty directories
  cleanupEmptyDirs(plan, claudeDir, deps);

  // Step 10: Remove _core/ if no hooks remain
  if (plan.removeCoreDir) {
    const corePath = `${claudeDir}/hooks/_core`;
    if (deps.fileExists(corePath)) {
      deps.removeDir(corePath);
    }
  }

  return ok(formatSuccess(plan.hooksToRemove));
}

// ─── Plan Builder ───────────────────────────────────────────────────────────

/**
 * Build a plan of what to uninstall. Resolves names against lockfile entries.
 * Supports both hook names and group names.
 */
function buildUninstallPlan(
  names: string[],
  lockfile: Lockfile,
): Result<UninstallPlan, PaihError> {
  const hooksToRemove: LockfileHookEntry[] = [];
  const seenNames = new Set<string>();

  for (const name of names) {
    // Try hook name first
    const hookMatch = lockfile.hooks.find((h) => h.name === name);
    if (hookMatch && !seenNames.has(hookMatch.name)) {
      hooksToRemove.push(hookMatch);
      seenNames.add(hookMatch.name);
      continue;
    }

    // Try group name — find all hooks in this group
    const groupHooks = lockfile.hooks.filter((h) => h.group === name);
    if (groupHooks.length > 0) {
      for (const gh of groupHooks) {
        if (!seenNames.has(gh.name)) {
          hooksToRemove.push(gh);
          seenNames.add(gh.name);
        }
      }
      continue;
    }

    // Not found is not an error — idempotent
    if (!hookMatch && groupHooks.length === 0) {
      // Warn but continue
    }
  }

  // Determine shared files to remove via ref-counting
  const sharedFilesToRemove = computeSharedFilesToRemove(hooksToRemove, lockfile);

  // Determine if _core/ should be removed
  const remainingHooks = lockfile.hooks.filter((h) => !seenNames.has(h.name));
  const removeCoreDir = remainingHooks.length === 0;

  return ok({ hooksToRemove, sharedFilesToRemove, removeCoreDir });
}

// ─── Shared File Ref-Counting ───────────────────────────────────────────────

/**
 * Determine which shared files should be removed.
 * A shared file is removed only if no remaining hooks in the same group reference it.
 */
function computeSharedFilesToRemove(
  hooksToRemove: LockfileHookEntry[],
  lockfile: Lockfile,
): string[] {
  const removingNames = new Set(hooksToRemove.map((h) => h.name));
  const sharedFilesToRemove: string[] = [];

  // Collect shared files from hooks being removed
  const sharedFilesByGroup = new Map<string, Set<string>>();
  for (const hook of hooksToRemove) {
    for (const file of hook.files) {
      // Shared files are at the group level: hooks/<Group>/<file> (not in a hook subdir)
      const parts = file.split("/");
      // hooks/<Group>/<file> has 3 parts; hooks/<Group>/<Hook>/<file> has 4
      if (parts.length === 3 && parts[0] === "hooks") {
        const group = parts[1];
        const existing = sharedFilesByGroup.get(group) ?? new Set();
        existing.add(file);
        sharedFilesByGroup.set(group, existing);
      }
    }
  }

  // Check if any remaining hooks in the same group still reference these shared files
  for (const [group, sharedFiles] of sharedFilesByGroup) {
    const remainingGroupHooks = lockfile.hooks.filter(
      (h) => h.group === group && !removingNames.has(h.name),
    );

    for (const sharedFile of sharedFiles) {
      const stillReferenced = remainingGroupHooks.some((h) =>
        h.files.includes(sharedFile),
      );
      if (!stillReferenced) {
        sharedFilesToRemove.push(sharedFile);
      }
    }
  }

  return sharedFilesToRemove;
}

// ─── Modification Detection ─────────────────────────────────────────────────

/**
 * Check that installed files have not been modified since install.
 * Compares current content hash against lockfile fileHashes.
 */
function checkModifications(
  hooks: LockfileHookEntry[],
  claudeDir: string,
  deps: CliDeps,
): Result<void, PaihError> {
  for (const hook of hooks) {
    for (const file of hook.files) {
      const absPath = `${claudeDir}/${file}`;

      // Idempotency: file in lockfile but missing on disk → warn, continue
      if (!deps.fileExists(absPath)) continue;

      const expectedHash = hook.fileHashes[file];
      if (!expectedHash) continue; // No hash recorded (old lockfile)

      const currentHash = computeFileHash(absPath, deps);
      if (!currentHash.ok) continue; // Cannot hash → skip

      if (currentHash.value !== expectedHash) {
        return err(fileModified(absPath));
      }
    }
  }

  return ok(undefined);
}

// ─── File Removal ───────────────────────────────────────────────────────────

/** Remove all files belonging to the hooks being uninstalled. */
function removeHookFiles(
  hooks: LockfileHookEntry[],
  claudeDir: string,
  deps: CliDeps,
): Result<void, PaihError> {
  for (const hook of hooks) {
    for (const file of hook.files) {
      const absPath = `${claudeDir}/${file}`;

      // Idempotency: missing file → warn, continue
      if (!deps.fileExists(absPath)) continue;

      const deleteResult = deps.deleteFile(absPath);
      if (!deleteResult.ok) return deleteResult;
    }
  }

  return ok(undefined);
}

// ─── Directory Cleanup ──────────────────────────────────────────────────────

/** Clean up empty hook directories after file removal. */
function cleanupEmptyDirs(
  plan: UninstallPlan,
  claudeDir: string,
  deps: CliDeps,
): void {
  // Collect hook directories that may now be empty
  for (const hook of plan.hooksToRemove) {
    const hookDir = `${claudeDir}/hooks/${hook.group}/${hook.name}`;
    if (deps.fileExists(hookDir)) {
      const entries = deps.readDir(hookDir);
      if (entries.ok && entries.value.length === 0) {
        deps.removeDir(hookDir);
      }
    }

    // Check if group directory is now empty
    const groupDir = `${claudeDir}/hooks/${hook.group}`;
    if (deps.fileExists(groupDir)) {
      const entries = deps.readDir(groupDir);
      if (entries.ok && entries.value.length === 0) {
        deps.removeDir(groupDir);
      }
    }
  }
}

// ─── Formatting ─────────────────────────────────────────────────────────────

function formatDryRun(plan: UninstallPlan): string {
  const lines = ["Dry run — would uninstall:"];
  for (const hook of plan.hooksToRemove) {
    lines.push(`  ${hook.group}/${hook.name} (${hook.event})`);
    for (const file of hook.files) {
      lines.push(`    - ${file}`);
    }
  }
  if (plan.sharedFilesToRemove.length > 0) {
    lines.push("  Shared files to remove:");
    for (const f of plan.sharedFilesToRemove) {
      lines.push(`    - ${f}`);
    }
  }
  if (plan.removeCoreDir) {
    lines.push("  Would remove _core/ directory (no hooks remaining)");
  }
  return lines.join("\n");
}

function formatSuccess(hooks: LockfileHookEntry[]): string {
  const lines = [`Uninstalled ${hooks.length} hook${hooks.length === 1 ? "" : "s"}:`];
  for (const hook of hooks) {
    lines.push(`  ${hook.group}/${hook.name} (${hook.event})`);
  }
  return lines.join("\n");
}
