/**
 * File Staging — Atomic copy of hook source files to target .claude/hooks/.
 *
 * Stages files into .paih-staging/ first, then atomically renames to final
 * location on success. Cleans up staging on failure.
 *
 * Hook file layout follows the source repo structure
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-a0619c6a/hooks/CodingStandards/TypeStrictness/):
 *   .claude/hooks/<Group>/<Hook>/<Hook>.hook.ts
 *   .claude/hooks/<Group>/<Hook>/<Hook>.contract.ts
 *   .claude/hooks/<Group>/shared.ts  (if group has shared deps)
 *   .claude/hooks/pai-hooks/<module>.ts   (deduped core deps)
 */

import type { Result } from "@hooks/cli/core/result";
import { ok } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import type { CliDeps } from "@hooks/cli/types/deps";
import type { HookDef } from "@hooks/cli/types/resolved";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StagedFiles {
  /** All file paths relative to .claude/ that were staged. */
  files: string[];
  /** The command string for settings.json (relative to .claude/). */
  commandString: string;
}

export interface StagingContext {
  /** Absolute path to .claude/ directory. */
  claudeDir: string;
  /** Absolute path to staging directory (.claude/hooks/.paih-staging/). */
  stagingDir: string;
  /** Absolute path to final hooks directory (.claude/hooks/). */
  hooksDir: string;
  /** Absolute path to the source repo root. */
  sourceRoot: string;
}

// ─── Staging Lifecycle ──────────────────────────────────────────────────────

/** Create the staging directory at .claude/hooks/.paih-staging/. */
export function createStaging(
  claudeDir: string,
  deps: CliDeps,
): Result<StagingContext, PaihError> {
  const hooksDir = `${claudeDir}/hooks`;
  const stagingDir = `${hooksDir}/.paih-staging`;

  const ensureResult = deps.ensureDir(stagingDir);
  if (!ensureResult.ok) return ensureResult;

  // Derive source root: the repo containing the hook manifests.
  // In source-copy mode this is the pai-hooks repo itself.
  // For now we detect it from CWD or a known structure.
  const sourceRoot = deps.cwd();

  return ok({ claudeDir, stagingDir, hooksDir, sourceRoot });
}

/**
 * Stage a single hook's files into the staging directory.
 *
 * Copies: hook.ts, contract.ts from sourceDir.
 * Copies shared files from group dir if any are used.
 * Core deps are handled separately via stageCoreModules.
 */
export function stageHook(
  ctx: StagingContext,
  hookDef: HookDef,
  sharedFiles: string[],
  deps: CliDeps,
): Result<StagedFiles, PaihError> {
  const { manifest, sourceDir } = hookDef;
  const groupName = manifest.group;
  const hookName = manifest.name;

  // Target paths: all hooks go inside pai-hooks/ alongside core/ and lib/
  const hookDir = `${ctx.stagingDir}/pai-hooks/${groupName}/${hookName}`;
  const ensureResult = deps.ensureDir(hookDir);
  if (!ensureResult.ok) return ensureResult;

  const files: string[] = [];

  // Copy hook.ts
  const hookFile = `${sourceDir}/${hookName}.hook.ts`;
  const hookDest = `${hookDir}/${hookName}.hook.ts`;
  const hookCopy = copyFile(hookFile, hookDest, deps);
  if (!hookCopy.ok) return hookCopy;
  files.push(`hooks/pai-hooks/${groupName}/${hookName}/${hookName}.hook.ts`);

  // Copy contract.ts
  const contractFile = `${sourceDir}/${hookName}.contract.ts`;
  const contractDest = `${hookDir}/${hookName}.contract.ts`;
  if (deps.fileExists(contractFile)) {
    const contractCopy = copyFile(contractFile, contractDest, deps);
    if (!contractCopy.ok) return contractCopy;
    files.push(`hooks/pai-hooks/${groupName}/${hookName}/${hookName}.contract.ts`);
  }

  // Copy shared files discovered from imports
  if (sharedFiles.length > 0) {
    const groupSourceDir = sourceDir.substring(0, sourceDir.lastIndexOf("/"));
    for (const sharedFile of sharedFiles) {
      const sharedSrc = `${groupSourceDir}/${sharedFile}`;
      const sharedDest = `${ctx.stagingDir}/pai-hooks/${groupName}/${sharedFile}`;
      if (deps.fileExists(sharedSrc)) {
        const sharedCopy = copyFile(sharedSrc, sharedDest, deps);
        if (!sharedCopy.ok) return sharedCopy;
        files.push(`hooks/pai-hooks/${groupName}/${sharedFile}`);
      }
    }
  }

  const commandString = `bun "$CLAUDE_PROJECT_DIR"/.claude/hooks/pai-hooks/${groupName}/${hookName}/${hookName}.hook.ts`;

  return ok({ files, commandString });
}

/**
 * Stage core dependency modules into pai-hooks/ for deduplication.
 *
 * Core deps (from core/*.ts, core/adapters/*.ts, core/types/*.ts, lib/*.ts)
 * are copied once into .claude/hooks/pai-hooks/ and shared across all hooks.
 */
export function stageCoreModules(
  ctx: StagingContext,
  coreDeps: Set<string>,
  deps: CliDeps,
): Result<string[], PaihError> {
  const coreDir = `${ctx.stagingDir}/pai-hooks`;
  const ensureResult = deps.ensureDir(coreDir);
  if (!ensureResult.ok) return ensureResult;

  const files: string[] = [];

  for (const dep of coreDeps) {
    // dep format: "core/result", "core/adapters/fs", "lib/paths", etc.
    const sourcePath = `${ctx.sourceRoot}/${dep}.ts`;
    if (!deps.fileExists(sourcePath)) continue;

    const destPath = `${coreDir}/${dep}.ts`;
    const destDir = destPath.substring(0, destPath.lastIndexOf("/"));
    const ensureDirResult = deps.ensureDir(destDir);
    if (!ensureDirResult.ok) return ensureDirResult;

    const copyResult = copyFile(sourcePath, destPath, deps);
    if (!copyResult.ok) return copyResult;
    files.push(`hooks/pai-hooks/${dep}.ts`);
  }

  return ok(files);
}

/**
 * Commit staging — move staged files from .paih-staging/ to final hooks/.
 *
 * Copies each file from staging to the final location, then cleans staging.
 */
export function commitStaging(
  ctx: StagingContext,
  deps: CliDeps,
): Result<void, PaihError> {
  // Copy all staged files to their final locations
  const copyResult = copyTree(ctx.stagingDir, ctx.hooksDir, "", deps);
  if (!copyResult.ok) return copyResult;

  // Clean up staging directory
  return cleanStaging(ctx.stagingDir, deps);
}

/** Remove the staging directory (cleanup on failure or after commit). */
export function cleanStaging(
  stagingDir: string,
  deps: CliDeps,
): Result<void, PaihError> {
  // Remove all files in staging recursively
  return removeTree(stagingDir, deps);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Copy a single file using deps adapters. */
function copyFile(
  src: string,
  dest: string,
  deps: CliDeps,
): Result<void, PaihError> {
  const content = deps.readFile(src);
  if (!content.ok) return content;

  return deps.writeFile(dest, content.value);
}

/** Recursively copy a directory tree from staging to final destination. */
function copyTree(
  srcDir: string,
  destBase: string,
  relativePath: string,
  deps: CliDeps,
): Result<void, PaihError> {
  const currentSrc = relativePath ? `${srcDir}/${relativePath}` : srcDir;
  const entries = deps.readDir(currentSrc);
  if (!entries.ok) return entries;

  for (const entry of entries.value) {
    // Skip .paih-staging itself if it appears
    if (entry === ".paih-staging") continue;

    const relEntry = relativePath ? `${relativePath}/${entry}` : entry;
    const srcPath = `${srcDir}/${relEntry}`;
    const destPath = `${destBase}/${relEntry}`;

    const statResult = deps.stat(srcPath);
    if (!statResult.ok) return statResult;

    if (statResult.value.isDirectory) {
      const ensureResult = deps.ensureDir(destPath);
      if (!ensureResult.ok) return ensureResult;

      const subResult = copyTree(srcDir, destBase, relEntry, deps);
      if (!subResult.ok) return subResult;
    } else {
      const copy = copyFile(srcPath, destPath, deps);
      if (!copy.ok) return copy;
    }
  }

  return ok(undefined);
}

/** Recursively remove a directory tree. */
function removeTree(
  dir: string,
  deps: CliDeps,
): Result<void, PaihError> {
  if (!deps.fileExists(dir)) return ok(undefined);

  const entries = deps.readDir(dir);
  if (!entries.ok) return ok(undefined); // Already gone

  for (const entry of entries.value) {
    const entryPath = `${dir}/${entry}`;
    const statResult = deps.stat(entryPath);
    if (!statResult.ok) continue;

    if (statResult.value.isDirectory) {
      const subResult = removeTree(entryPath, deps);
      if (!subResult.ok) return subResult;
    } else {
      const deleteResult = deps.deleteFile(entryPath);
      if (!deleteResult.ok) return deleteResult;
    }
  }

  // Remove the now-empty directory itself
  return deps.removeDir(dir);
}
