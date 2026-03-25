/**
 * verify command — Validate hook integrity in source or installed mode.
 *
 * Source mode (default): Run in source repo, validate manifests match imports.
 *   - Globs all hook.json under hooks/
 *   - Compares declared deps vs actual imports (reuses validator logic from cli/core/validator.ts)
 *   - --fix rewrites hook.json to match actual imports
 *
 * Installed mode (--installed): Run in target project, check files match lockfile.
 *   - Reads lockfile, checks all files exist + match fileHashes (cli/core/lockfile.ts)
 *   - Checks commandString entries exist in settings.json (cli/core/settings.ts)
 *   - --fix NOT available → error: "Use paih update"
 *
 * Uses CliDeps for DI (cli/types/deps.ts).
 */

import type { Result } from "@hooks/cli/core/result";
import { ok, err } from "@hooks/cli/core/result";
import { tryCatch } from "@hooks/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { invalidArgs, lockMissing, PaihErrorCode, PaihError as PaihErrorClass } from "@hooks/cli/core/error";
import type { ParsedArgs } from "@hooks/cli/core/args";
import type { CliDeps } from "@hooks/cli/types/deps";
import { resolveTarget } from "@hooks/cli/core/target";
import { readLockfile, computeFileHash } from "@hooks/cli/core/lockfile";
import { readSettings } from "@hooks/cli/core/settings";

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
      return err(invalidArgs("--fix is not available in installed mode. Use \"paih update\" instead."));
    }
    return verifyInstalled(args, deps);
  }

  return verifySource(args, deps, sourceRoot, fix);
}

// ─── Source Mode ────────────────────────────────────────────────────────────

/**
 * Source-mode verify: validate hook.json manifests match actual imports.
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
  const fixedHooks: string[] = [];

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

      const result = validateHookManifest(
        hookName,
        hookDir,
        manifestPath,
        groupDir,
        deps,
        fix,
      );

      if (result.diagnostics.length > 0) {
        diagnostics.push(...result.diagnostics);
      }
      if (result.fixed) {
        fixedHooks.push(hookName);
      }
    }
  }

  if (diagnostics.length === 0 && fixedHooks.length === 0) {
    return ok("All hook manifests are valid.");
  }

  if (fix && fixedHooks.length > 0) {
    return ok(`Fixed ${fixedHooks.length} hook manifest${fixedHooks.length === 1 ? "" : "s"}: ${fixedHooks.join(", ")}`);
  }

  // Report diagnostics
  const lines = [`Found ${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"}:`];
  for (const d of diagnostics) {
    lines.push(`  [${d.code}] ${d.hookName}: ${d.message}`);
  }
  if (!fix) {
    lines.push("Run with --fix to auto-correct derivable fields.");
  }
  return ok(lines.join("\n"));
}

// ─── Manifest Validation ────────────────────────────────────────────────────

interface ManifestValidationResult {
  diagnostics: VerifyDiagnostic[];
  fixed: boolean;
}

/**
 * Validate a single hook manifest against its contract imports.
 * Optionally fix derivable fields (deps) in the manifest.
 */
function validateHookManifest(
  hookName: string,
  hookDir: string,
  manifestPath: string,
  groupDir: string,
  deps: CliDeps,
  fix: boolean,
): ManifestValidationResult {
  const diagnostics: VerifyDiagnostic[] = [];

  // Read manifest
  const manifestContent = deps.readFile(manifestPath);
  if (!manifestContent.ok) return { diagnostics, fixed: false };

  const parsed = tryCatch(
    () => JSON.parse(manifestContent.value) as Record<string, unknown>,
    () => new PaihErrorClass(
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
    return { diagnostics, fixed: false };
  }

  const manifest = parsed.value;

  // Find contract file (scan both .contract.ts and .hook.ts)
  const contractPath = `${hookDir}/${hookName}.contract.ts`;
  const hookFilePath = `${hookDir}/${hookName}.hook.ts`;
  const filesToScan = [contractPath, hookFilePath].filter((p) => deps.fileExists(p));

  if (filesToScan.length === 0) {
    return { diagnostics, fixed: false };
  }

  // Parse imports from all source files
  const allImports = new Set<string>();
  for (const filePath of filesToScan) {
    const content = deps.readFile(filePath);
    if (!content.ok) continue;
    const imports = parseRuntimeImports(content.value);
    for (const imp of imports) {
      allImports.add(imp);
    }
  }

  // Collect declared deps from manifest
  const depsObj = manifest.deps as { core?: string[]; lib?: string[]; adapters?: string[]; shared?: string[] | false } | undefined;
  if (!depsObj) return { diagnostics, fixed: false };

  const declaredDeps = new Set<string>();
  for (const dep of depsObj.core ?? []) declaredDeps.add(`core/${dep}`);
  for (const dep of depsObj.lib ?? []) declaredDeps.add(`lib/${dep}`);
  for (const dep of depsObj.adapters ?? []) declaredDeps.add(`adapters/${dep}`);

  // Bidirectional comparison
  const missing: string[] = [];
  const ghost: string[] = [];

  for (const imp of allImports) {
    if (!declaredDeps.has(imp)) {
      missing.push(imp);
      diagnostics.push({
        hookName,
        code: "MANIFEST_MISSING_DEP",
        message: `Contract imports ${imp} but manifest does not declare it`,
      });
    }
  }

  for (const dec of declaredDeps) {
    if (!allImports.has(dec)) {
      ghost.push(dec);
      diagnostics.push({
        hookName,
        code: "MANIFEST_GHOST_DEP",
        message: `Manifest declares ${dec} but contract does not import it`,
      });
    }
  }

  // Check shared file existence
  if (Array.isArray(depsObj.shared)) {
    for (const sharedFile of depsObj.shared) {
      const sharedPath = `${groupDir}/${sharedFile}`;
      if (!deps.fileExists(sharedPath)) {
        diagnostics.push({
          hookName,
          code: "MANIFEST_SHARED_MISSING",
          message: `Shared file ${sharedFile} not found at ${sharedPath}`,
        });
      }
    }
  }

  // Fix mode: rewrite manifest deps to match actual imports
  if (fix && (missing.length > 0 || ghost.length > 0)) {
    const newCore: string[] = [];
    const newLib: string[] = [];
    const newAdapters: string[] = [];

    for (const imp of allImports) {
      if (imp.startsWith("core/")) newCore.push(imp.slice(5));
      else if (imp.startsWith("lib/")) newLib.push(imp.slice(4));
      else if (imp.startsWith("adapters/")) newAdapters.push(imp.slice(9));
    }

    const updatedManifest = {
      ...manifest,
      deps: {
        ...depsObj,
        core: newCore.sort(),
        lib: newLib.sort(),
        adapters: newAdapters.sort(),
      },
    };

    const newContent = JSON.stringify(updatedManifest, null, 2) + "\n";
    deps.writeFile(manifestPath, newContent);

    return { diagnostics: [], fixed: true };
  }

  return { diagnostics, fixed: false };
}

// ─── Import Parsing ─────────────────────────────────────────────────────────

/**
 * Parse runtime @hooks/* imports from TypeScript source.
 * Returns categorized dep keys like "core/result", "lib/paths", "adapters/fs".
 * Skips type-only imports.
 */
function parseRuntimeImports(source: string): Set<string> {
  const result = new Set<string>();

  // Normalize multi-line imports
  const normalized = source.replace(
    /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;/g,
    (_fullMatch, importClause: string, modulePath: string) => {
      const collapsed = importClause.replace(/\s+/g, " ").trim();
      return `import ${collapsed} from "${modulePath}";`;
    },
  );

  const importRegex = /^import\s+(.*?)\s+from\s+["'](@hooks\/[^"']+)["']\s*;/gm;

  let match: RegExpExecArray | null = importRegex.exec(normalized);
  while (match !== null) {
    const importClause = match[1];
    const modulePath = match[2];

    // Skip pure type imports
    if (importClause.startsWith("type ")) {
      match = importRegex.exec(normalized);
      continue;
    }

    const categorized = categorizeImport(modulePath);
    if (categorized) {
      result.add(categorized);
    }

    match = importRegex.exec(normalized);
  }

  return result;
}

/**
 * Categorize a @hooks/* import path into "core/X", "lib/X", or "adapters/X".
 * Returns null for paths that should be ignored (hooks/*, cli/*).
 */
function categorizeImport(modulePath: string): string | null {
  // Ignore sibling hook imports and CLI imports
  if (modulePath.startsWith("@hooks/hooks/")) return null;
  if (modulePath.startsWith("@hooks/cli/")) return null;

  const adapterMatch = modulePath.match(/^@hooks\/core\/adapters\/(.+)$/);
  if (adapterMatch) return `adapters/${adapterMatch[1]}`;

  const coreMatch = modulePath.match(/^@hooks\/core\/(.+)$/);
  if (coreMatch) return `core/${coreMatch[1]}`;

  const libMatch = modulePath.match(/^@hooks\/lib\/(.+)$/);
  if (libMatch) return `lib/${libMatch[1]}`;

  return null;
}

// ─── Installed Mode ─────────────────────────────────────────────────────────

/**
 * Installed-mode verify: check files match lockfile hashes and settings entries exist.
 */
function verifyInstalled(
  args: ParsedArgs,
  deps: CliDeps,
): Result<string, PaihError> {
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
        if (currentHash.ok && currentHash.value !== expectedHash) {
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
