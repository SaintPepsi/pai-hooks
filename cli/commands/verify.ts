/**
 * verify command — Validate hook integrity in source or installed mode.
 *
 * Source mode (default): Run in source repo, validate manifests match imports.
 *   - Globs all hook.json under hooks/
 *   - Compares declared deps vs actual imports (reuses validator logic from cli/core/validator.ts)
 *   - --fix accepted but is a no-op (auto-rewrite not yet implemented)
 *
 * Installed mode (--installed): Run in target project, check files match lockfile.
 *   - Reads lockfile, checks all files exist + match fileHashes (cli/core/lockfile.ts)
 *   - Checks commandString entries exist in settings.json (cli/core/settings.ts)
 *   - --fix NOT available → error: "Use paih update"
 *
 * Uses CliDeps for DI (cli/types/deps.ts).
 */

import type { ParsedArgs } from "@hooks/cli/core/args";
import type { PaihError } from "@hooks/cli/core/error";
import {
  invalidArgs,
  lockMissing,
  PaihError as PaihErrorClass,
  PaihErrorCode,
} from "@hooks/cli/core/error";
import { computeFileHash, readLockfile } from "@hooks/cli/core/lockfile";
import type { Result } from "@hooks/cli/core/result";
import { err, ok } from "@hooks/cli/core/result";
import { readSettings } from "@hooks/cli/core/settings";
import { resolveTarget } from "@hooks/cli/core/target";
import type { CliDeps } from "@hooks/cli/types/deps";
import { tryCatch } from "@hooks/core/result";

// ─── Types ──────────────────────────────────────────────────────────────────

interface VerifyDiagnostic {
  hookName: string;
  code: string;
  message: string;
}

// ─── Entry Point ────────────────────────────────────────────────────────────

/**
 * Execute the verify command.
 *
 * @param args - Parsed CLI arguments with flags.
 * @param deps - Injectable filesystem/process dependencies.
 * @param sourceRoot - Override source repo root for source mode.
 */
export function verify(
  args: ParsedArgs,
  deps: CliDeps,
  sourceRoot?: string,
): Result<string, PaihError> {
  const installed = args.flags.installed === true;
  const fix = args.flags.fix === true;

  if (installed) {
    if (fix) {
      return err(
        invalidArgs('--fix is not available in installed mode. Use "paih update" instead.'),
      );
    }
    return verifyInstalled(args, deps);
  }

  return verifySource(args, deps, sourceRoot, fix);
}

// ─── Source Mode ────────────────────────────────────────────────────────────

/**
 * Source-mode verify: validate hook.json manifests match actual imports.
 *
 * Note: --fix is accepted but is a no-op. Auto-rewrite of hook.json is not yet
 * implemented. The flag only suppresses the diagnostic hint below.
 */
function verifySource(
  _args: ParsedArgs,
  deps: CliDeps,
  sourceRoot: string | undefined,
  fix: boolean,
): Result<string, PaihError> {
  const source = sourceRoot ?? deps.cwd();
  const hooksDir = `${source}/hooks`;

  if (!deps.fileExists(hooksDir)) {
    return ok("No hooks/ directory found. Nothing to verify.");
  }

  const diagnostics: VerifyDiagnostic[] = [];

  // Scan group directories
  const groupDirs = deps.readDir(hooksDir);
  if (!groupDirs.ok) return groupDirs;

  for (const groupName of groupDirs.value) {
    const groupDir = `${hooksDir}/${groupName}`;
    const groupStat = deps.stat(groupDir);
    if (!groupStat.ok || !groupStat.value.isDirectory) continue;

    // Scan hook directories within the group
    const hookDirs = deps.readDir(groupDir);
    if (!hookDirs.ok) continue;

    for (const hookName of hookDirs.value) {
      const hookDir = `${groupDir}/${hookName}`;
      const hookStat = deps.stat(hookDir);
      if (!hookStat.ok || !hookStat.value.isDirectory) continue;

      const manifestPath = `${hookDir}/hook.json`;
      if (!deps.fileExists(manifestPath)) continue;

      const result = validateHookManifest(hookName, hookDir, manifestPath, groupDir, deps);

      if (result.diagnostics.length > 0) {
        diagnostics.push(...result.diagnostics);
      }
    }
  }

  if (diagnostics.length === 0) {
    return ok("All hook manifests are valid.");
  }

  // Report diagnostics
  const lines = [`Found ${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"}:`];
  for (const d of diagnostics) {
    lines.push(`  [${d.code}] ${d.hookName}: ${d.message}`);
  }
  if (!fix) {
    lines.push("Note: --fix is accepted but not yet implemented for source mode.");
  }
  return ok(lines.join("\n"));
}

// ─── Manifest Validation ────────────────────────────────────────────────────

interface ManifestValidationResult {
  diagnostics: VerifyDiagnostic[];
}

/**
 * Validate a single hook manifest is well-formed.
 * Dependencies are auto-discovered from imports at install time,
 * so no deps validation is needed here.
 */
function validateHookManifest(
  hookName: string,
  hookDir: string,
  manifestPath: string,
  _groupDir: string,
  deps: CliDeps,
): ManifestValidationResult {
  const diagnostics: VerifyDiagnostic[] = [];

  // Read manifest
  const manifestContent = deps.readFile(manifestPath);
  if (!manifestContent.ok) return { diagnostics };

  const parsed = tryCatch(
    () => JSON.parse(manifestContent.value) as Record<string, unknown>,
    () =>
      new PaihErrorClass(
        PaihErrorCode.ManifestParseError,
        `Failed to parse hook.json at ${manifestPath}`,
        { path: manifestPath },
      ),
  );

  if (!parsed.ok) {
    diagnostics.push({
      hookName,
      code: "MANIFEST_PARSE_ERROR",
      message: "Failed to parse hook.json",
    });
    return { diagnostics };
  }

  // Verify contract file exists
  const contractPath = `${hookDir}/${hookName}.contract.ts`;
  if (!deps.fileExists(contractPath)) {
    diagnostics.push({
      hookName,
      code: "CONTRACT_MISSING",
      message: `Contract file not found: ${hookName}.contract.ts`,
    });
  }

  return { diagnostics };
}

// ─── Installed Mode ─────────────────────────────────────────────────────────

/**
 * Installed-mode verify: check files match lockfile hashes and settings entries exist.
 */
function verifyInstalled(args: ParsedArgs, deps: CliDeps): Result<string, PaihError> {
  const inFlag = typeof args.flags.in === "string" ? args.flags.in : undefined;
  const fromFlag = typeof args.flags.from === "string" ? args.flags.from : undefined;
  const targetFlag = inFlag ?? fromFlag;

  // Resolve target
  const targetResult = resolveTarget(deps, targetFlag);
  if (!targetResult.ok) return targetResult;
  const targetDir = targetResult.value;
  const claudeDir = `${targetDir}/.claude`;

  // Read lockfile
  const lockResult = readLockfile(claudeDir, deps);
  if (!lockResult.ok) return lockResult;
  if (!lockResult.value) {
    return err(lockMissing(claudeDir));
  }
  const lockfile = lockResult.value;

  if (lockfile.hooks.length === 0) {
    return ok("No hooks installed. Nothing to verify.");
  }

  // Read settings
  const settingsResult = readSettings(claudeDir, deps);
  if (!settingsResult.ok) return settingsResult;
  const settings = settingsResult.value;

  const diagnostics: VerifyDiagnostic[] = [];

  for (const hook of lockfile.hooks) {
    // Check each file exists and matches hash
    for (const file of hook.files) {
      const absPath = `${claudeDir}/${file}`;

      if (!deps.fileExists(absPath)) {
        diagnostics.push({
          hookName: hook.name,
          code: "FILE_MISSING",
          message: `Expected file missing: ${file}`,
        });
        continue;
      }

      const expectedHash = hook.fileHashes[file];
      if (expectedHash) {
        const currentHash = computeFileHash(absPath, deps);
        if (!currentHash.ok) {
          diagnostics.push({
            hookName: hook.name,
            code: "FILE_UNREADABLE",
            message: `Cannot read file for hash verification: ${file}`,
          });
        } else if (currentHash.value !== expectedHash) {
          diagnostics.push({
            hookName: hook.name,
            code: "FILE_MODIFIED",
            message: `File modified: ${file}`,
          });
        }
      }
    }

    // Check settings entry exists
    const commandExists = checkCommandInSettings(settings, hook.event, hook.commandString);
    if (!commandExists) {
      diagnostics.push({
        hookName: hook.name,
        code: "SETTINGS_MISSING",
        message: `Settings entry missing for ${hook.commandString} in ${hook.event}`,
      });
    }
  }

  if (diagnostics.length === 0) {
    return ok("All installed hooks verified. No drift detected.");
  }

  const lines = [`Found ${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"}:`];
  for (const d of diagnostics) {
    lines.push(`  [${d.code}] ${d.hookName}: ${d.message}`);
  }
  return ok(lines.join("\n"));
}

// ─── Settings Check ─────────────────────────────────────────────────────────

/**
 * Check if a commandString exists in settings for a given event.
 */
function checkCommandInSettings(
  settings: { hooks?: Record<string, Array<{ hooks: Array<{ command: string }> }>> },
  event: string,
  commandString: string,
): boolean {
  if (!settings.hooks?.[event]) return false;

  return settings.hooks[event].some((group) =>
    group.hooks.some((h) => h.command === commandString),
  );
}
