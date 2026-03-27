/**
 * update command — Re-install hooks whose source files have changed.
 *
 * Compares current source file hashes against lockfile fileHashes to detect changes.
 * Re-installs changed hooks using uninstall + install logic.
 * Preserves outputMode per hook. Flags removed-upstream hooks without auto-deleting.
 *
 * Pipeline: readLockfile → detect source changes → check local mods → re-install changed → update lockfile
 *
 * Uses CliDeps for DI (cli/types/deps.ts).
 * File hashes from cli/core/lockfile.ts.
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
  computeFileHash,
} from "@hooks/cli/core/lockfile";

// ─── Types ──────────────────────────────────────────────────────────────────

interface UpdatePlan {
  changed: LockfileHookEntry[];
  unchanged: LockfileHookEntry[];
  removedUpstream: LockfileHookEntry[];
}

// ─── Update Pipeline ────────────────────────────────────────────────────────

/**
 * Execute the update command.
 *
 * @param args - Parsed CLI arguments with flags.
 * @param deps - Injectable filesystem/process dependencies.
 * @param sourceRoot - Override source repo root (defaults to deps.cwd()).
 */
export function update(
  args: ParsedArgs,
  deps: CliDeps,
  sourceRoot?: string,
): Result<string, PaihError> {
  const force = args.flags.force === true;
  const dryRun = args.flags.dryRun === true;
  const inFlag = typeof args.flags.in === "string" ? args.flags.in : undefined;

  // Step 1: Resolve target .claude/ directory
  const targetResult = resolveTarget(deps, inFlag);
  if (!targetResult.ok) return targetResult;
  const targetDir = targetResult.value;
  const claudeDir = `${targetDir}/.claude`;

  // Step 2: Read lockfile
  const lockResult = readLockfile(claudeDir, deps);
  if (!lockResult.ok) return lockResult;
  if (!lockResult.value) {
    return err(lockMissing(claudeDir));
  }
  const lockfile: Lockfile = lockResult.value;
  const source = sourceRoot ?? lockfile.source;

  if (lockfile.hooks.length === 0) {
    return ok("No hooks installed. Nothing to update.");
  }

  // Step 3: Build update plan — detect source changes
  const plan = buildUpdatePlan(lockfile, source, claudeDir, deps);

  if (plan.changed.length === 0 && plan.removedUpstream.length === 0) {
    return ok("All hooks up to date.");
  }

  if (dryRun) {
    return ok(formatDryRun(plan));
  }

  // Step 4: Check for local modifications on changed hooks (unless --force)
  if (!force && plan.changed.length > 0) {
    const modCheck = checkLocalModifications(plan.changed, claudeDir, deps);
    if (!modCheck.ok) return modCheck;
  }

  // Step 5: Re-install changed hooks (copy new source files over)
  const reinstallResult = reinstallHooks(plan.changed, source, claudeDir, deps);
  if (!reinstallResult.ok) return reinstallResult;

  // Step 6: Update lockfile with new hashes and timestamp
  const updatedLockfile = updateLockfileEntries(
    lockfile,
    reinstallResult.value,
  );

  const writeLockResult = writeLockfile(claudeDir, updatedLockfile, deps);
  if (!writeLockResult.ok) return writeLockResult;

  return ok(formatSuccess(plan));
}

// ─── Plan Builder ───────────────────────────────────────────────────────────

/**
 * Compare source files against lockfile hashes to detect changes.
 */
function buildUpdatePlan(
  lockfile: Lockfile,
  source: string,
  claudeDir: string,
  deps: CliDeps,
): UpdatePlan {
  const changed: LockfileHookEntry[] = [];
  const unchanged: LockfileHookEntry[] = [];
  const removedUpstream: LockfileHookEntry[] = [];

  for (const hook of lockfile.hooks) {
    // Derive source path from hook metadata
    const sourceHookDir = `${source}/hooks/${hook.group}/${hook.name}`;
    const sourceHookFile = `${sourceHookDir}/${hook.name}.hook.ts`;

    // Check if hook still exists in source
    if (!deps.fileExists(sourceHookFile)) {
      removedUpstream.push(hook);
      continue;
    }

    // Compare each file's hash against lockfile
    let hookChanged = false;
    for (const [relFile, expectedHash] of Object.entries(hook.fileHashes)) {
      // Map relative lockfile path back to source path
      const sourcePath = mapToSourcePath(relFile, source);
      if (!sourcePath || !deps.fileExists(sourcePath)) {
        hookChanged = true;
        break;
      }

      const currentHash = computeFileHash(sourcePath, deps);
      if (!currentHash.ok || currentHash.value !== expectedHash) {
        hookChanged = true;
        break;
      }
    }

    if (hookChanged) {
      changed.push(hook);
    } else {
      unchanged.push(hook);
    }
  }

  return { changed, unchanged, removedUpstream };
}

// ─── Local Modification Check ───────────────────────────────────────────────

/**
 * Verify that installed files haven't been locally modified before overwriting.
 */
function checkLocalModifications(
  hooks: LockfileHookEntry[],
  claudeDir: string,
  deps: CliDeps,
): Result<void, PaihError> {
  for (const hook of hooks) {
    for (const file of hook.files) {
      const absPath = `${claudeDir}/${file}`;
      if (!deps.fileExists(absPath)) continue;

      const expectedHash = hook.fileHashes[file];
      if (!expectedHash) continue;

      const currentHash = computeFileHash(absPath, deps);
      if (!currentHash.ok) continue;

      if (currentHash.value !== expectedHash) {
        return err(fileModified(absPath));
      }
    }
  }

  return ok(undefined);
}

// ─── Re-install ─────────────────────────────────────────────────────────────

interface ReinstalledHook {
  entry: LockfileHookEntry;
  newFileHashes: Record<string, string>;
}

/**
 * Copy updated source files for changed hooks.
 * Returns updated entries with new file hashes.
 */
function reinstallHooks(
  hooks: LockfileHookEntry[],
  source: string,
  claudeDir: string,
  deps: CliDeps,
): Result<ReinstalledHook[], PaihError> {
  const results: ReinstalledHook[] = [];

  for (const hook of hooks) {
    const newFileHashes: Record<string, string> = {};

    for (const relFile of hook.files) {
      const sourcePath = mapToSourcePath(relFile, source);
      if (!sourcePath) continue;

      const destPath = `${claudeDir}/${relFile}`;

      if (deps.fileExists(sourcePath)) {
        // Read source content and write to destination
        const content = deps.readFile(sourcePath);
        if (!content.ok) return content;

        // Ensure destination directory exists
        const destDir = destPath.substring(0, destPath.lastIndexOf("/"));
        const ensureResult = deps.ensureDir(destDir);
        if (!ensureResult.ok) return ensureResult;

        const writeResult = deps.writeFile(destPath, content.value);
        if (!writeResult.ok) return writeResult;

        // Compute hash of newly written file
        const hashResult = computeFileHash(destPath, deps);
        if (hashResult.ok) {
          newFileHashes[relFile] = hashResult.value;
        }
      }
    }

    results.push({ entry: hook, newFileHashes });
  }

  return ok(results);
}

// ─── Lockfile Update ────────────────────────────────────────────────────────

/**
 * Update lockfile entries with new hashes and timestamp.
 * Preserves outputMode from the original lockfile.
 */
function updateLockfileEntries(
  lockfile: Lockfile,
  reinstalled: ReinstalledHook[],
): Lockfile {
  const updatedHooks = lockfile.hooks.map((hook) => {
    const match = reinstalled.find((r) => r.entry.name === hook.name);
    if (match) {
      return {
        ...hook,
        fileHashes: match.newFileHashes,
      };
    }
    return hook;
  });

  return {
    ...lockfile,
    hooks: updatedHooks,
    installedAt: new Date().toISOString(),
  };
}

// ─── Path Mapping ───────────────────────────────────────────────────────────

/**
 * Map a lockfile relative path (hooks/Group/Hook/file.ts) back to source repo path.
 * pai-hooks/ (or legacy _core/) files map to source root (core/, lib/).
 * Hook files map to source hooks/ directory.
 */
function mapToSourcePath(relFile: string, source: string): string | null {
  // All installed files live under hooks/pai-hooks/ in the target project.
  // Core/lib deps: hooks/pai-hooks/core/... or hooks/pai-hooks/lib/...
  //   → /source/core/... or /source/lib/...
  // Hook files: hooks/pai-hooks/Group/Hook/file.ts
  //   → /source/hooks/Group/Hook/file.ts
  if (relFile.startsWith("hooks/pai-hooks/")) {
    const inner = relFile.replace("hooks/pai-hooks/", "");
    // Core deps start with core/ or lib/ — map directly to source root
    if (inner.startsWith("core/") || inner.startsWith("lib/")) {
      return `${source}/${inner}`;
    }
    // Everything else is a hook file — map to source hooks/ directory
    return `${source}/hooks/${inner}`;
  }

  // Legacy _core/ files: hooks/_core/core/result.ts → /source/core/result.ts
  if (relFile.startsWith("hooks/_core/")) {
    const corePath = relFile.replace("hooks/_core/", "");
    return `${source}/${corePath}`;
  }

  // Legacy flat layout: hooks/Group/Hook/file.ts → /source/hooks/Group/Hook/file.ts
  if (relFile.startsWith("hooks/")) {
    return `${source}/${relFile}`;
  }

  return null;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

function formatDryRun(plan: UpdatePlan): string {
  const lines = ["Dry run — update plan:"];

  if (plan.changed.length > 0) {
    lines.push("  Changed (would re-install):");
    for (const hook of plan.changed) {
      lines.push(`    ${hook.group}/${hook.name} (${hook.event})`);
    }
  }

  if (plan.removedUpstream.length > 0) {
    lines.push("  Removed upstream (NOT auto-deleted):");
    for (const hook of plan.removedUpstream) {
      lines.push(`    ${hook.group}/${hook.name} (${hook.event})`);
    }
  }

  if (plan.unchanged.length > 0) {
    lines.push(`  Unchanged: ${plan.unchanged.length} hook${plan.unchanged.length === 1 ? "" : "s"}`);
  }

  return lines.join("\n");
}

function formatSuccess(plan: UpdatePlan): string {
  const lines: string[] = [];

  if (plan.changed.length > 0) {
    lines.push(`Updated ${plan.changed.length} hook${plan.changed.length === 1 ? "" : "s"}:`);
    for (const hook of plan.changed) {
      lines.push(`  ${hook.group}/${hook.name} (${hook.event})`);
    }
  }

  if (plan.removedUpstream.length > 0) {
    lines.push(`Removed upstream (use "paih uninstall" to remove):`);
    for (const hook of plan.removedUpstream) {
      lines.push(`  ${hook.group}/${hook.name} (${hook.event})`);
    }
  }

  return lines.join("\n");
}
