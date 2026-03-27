/**
 * install command — Copy or compile hooks from source repo to target .claude/hooks/.
 *
 * Pipeline: parseArgs → resolveTarget → loadManifests → resolve → stage/compile → mergeSettings → writeLockfile
 *
 * Supports three output modes:
 *   source (default): copy .ts files, run via bun
 *   --compiled:       bun build --target=node → .js with node shebang
 *   --compiled-ts:    bun build --bundle → .ts with bun shebang
 *
 * Follows the pipe() pattern from cli/core/pipe.ts and uses CliDeps for DI.
 * Settings merge is append-only and idempotent per cli/core/settings.ts
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-ac7f9ecc/cli/core/settings.ts).
 * File staging is atomic per cli/core/staging.ts
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-ac7f9ecc/cli/core/staging.ts).
 * Compiler defined in cli/core/compiler.ts
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-ac7f9ecc/cli/core/compiler.ts).
 */

import type { Result } from "@hooks/cli/core/result";
import { ok, err } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { invalidArgs } from "@hooks/cli/core/error";
import type { ParsedArgs } from "@hooks/cli/core/args";
import type { CliDeps } from "@hooks/cli/types/deps";
import type { HookDef } from "@hooks/cli/types/resolved";
import type { Lockfile, LockfileHookEntry, OutputMode } from "@hooks/cli/types/lockfile";
import { createLockfile, DEFAULT_OUTPUT_MODE } from "@hooks/cli/types/lockfile";
import { resolveTarget } from "@hooks/cli/core/target";
import { loadManifests } from "@hooks/cli/core/manifest-loader";
import { resolve } from "@hooks/cli/core/resolver";
import {
  createStaging,
  stageHook,
  stageCoreModules,
  commitStaging,
  cleanStaging,
} from "@hooks/cli/core/staging";
import type { StagedFiles } from "@hooks/cli/core/staging";
import {
  readSettings,
  writeSettings,
  mergeHookEntry,
} from "@hooks/cli/core/settings";
import type { SettingsJson } from "@hooks/cli/core/settings";
import { readLockfile, writeLockfile, addHookEntry, computeFileHash } from "@hooks/cli/core/lockfile";
import { generateTsconfig } from "@hooks/cli/core/tsconfig-gen";
import { compileHook, compiledCommandString } from "@hooks/cli/core/compiler";
import type { CompilerDeps } from "@hooks/cli/core/compiler";

// ─── Install Pipeline ───────────────────────────────────────────────────────

/**
 * Execute the install command.
 *
 * @param args - Parsed CLI arguments with names and flags.
 * @param deps - Injectable filesystem/process dependencies (or CompilerDeps for compiled modes).
 * @param sourceRoot - Override source repo root (defaults to deps.cwd()).
 */
export function install(
  args: ParsedArgs,
  deps: CliDeps,
  sourceRoot?: string,
): Result<string, PaihError> {
  // --preset flag: push preset name into names for resolution
  if (typeof args.flags.preset === "string") {
    args.names.unshift(args.flags.preset);
  }

  // Validate: need at least one name
  if (args.names.length === 0) {
    return err(invalidArgs("install requires at least one hook, group, or preset name"));
  }

  const force = args.flags.force === true;
  const dryRun = args.flags.dryRun === true;
  const outputMode = resolveOutputMode(args);

  // Step 0: Validate bun is available on PATH before any file ops
  const bunCheck = deps.exec("bun --version");
  if (!bunCheck.ok) {
    return err(invalidArgs("bun is not available on PATH. Install bun (https://bun.sh) before running paih install."));
  }
  if (bunCheck.value.exitCode !== 0) {
    return err(invalidArgs("bun is not available on PATH. Install bun (https://bun.sh) before running paih install."));
  }

  // Step 1: Resolve target .claude/ directory
  const toFlag = typeof args.flags.to === "string" ? args.flags.to : undefined;
  const targetResult = resolveTarget(deps, toFlag);
  if (!targetResult.ok) return targetResult;
  const targetDir = targetResult.value;
  const claudeDir = `${targetDir}/.claude`;

  // Step 2: Check for mode change requiring --force
  const modeCheckResult = checkModeChange(claudeDir, outputMode, force, deps);
  if (!modeCheckResult.ok) return modeCheckResult;

  // Step 3: Load manifests from source repo
  const source = sourceRoot ?? deps.cwd();
  const manifestResult = loadManifests(source, deps);
  if (!manifestResult.ok) return manifestResult;
  const manifests = manifestResult.value;

  // Step 4: Resolve names to hooks
  const resolveResult = resolve(args.names, manifests);
  if (!resolveResult.ok) return resolveResult;
  const { hooks } = resolveResult.value;

  if (hooks.length === 0) {
    return ok("No hooks to install.");
  }

  if (dryRun) {
    return ok(formatDryRun(hooks, outputMode));
  }

  // Step 5: Create staging directory
  const stagingResult = createStaging(claudeDir, deps);
  if (!stagingResult.ok) return stagingResult;
  const ctx = { ...stagingResult.value, sourceRoot: source };

  // Step 6: Stage hook files
  const stagedHooks: Array<{ hookDef: HookDef; staged: StagedFiles }> = [];
  const allCoreDeps = new Set<string>();

  // Runner's transitive deps — always needed regardless of manifest declarations
  const RUNNER_BASELINE_DEPS = [
    "core/contract",
    "core/error",
    "core/result",
    "core/runner",
    "core/adapters/stdin",
    "core/adapters/log",
    "core/adapters/fs",
    "core/adapters/process",
    "core/types/hook-inputs",
    "core/types/hook-outputs",
    "core/language-profiles",
    "core/quality-scorer",
    "lib/paths",
    "lib/narrative-reader",
    "lib/time",
    "lib/identity",
    "lib/signal-logger",
  ];
  for (const dep of RUNNER_BASELINE_DEPS) {
    allCoreDeps.add(dep);
  }

  for (const hookDef of hooks) {
    const stageResult = stageHook(ctx, hookDef, deps);
    if (!stageResult.ok) {
      cleanStaging(ctx.stagingDir, deps);
      return stageResult;
    }
    stagedHooks.push({ hookDef, staged: stageResult.value });
    collectCoreDeps(hookDef, allCoreDeps);
  }

  // Step 7: Stage core modules (deduped)
  const coreResult = stageCoreModules(ctx, allCoreDeps, deps);
  if (!coreResult.ok) {
    cleanStaging(ctx.stagingDir, deps);
    return coreResult;
  }

  // Step 8: Commit staging (atomic move)
  const commitResult = commitStaging(ctx, deps);
  if (!commitResult.ok) {
    cleanStaging(ctx.stagingDir, deps);
    return commitResult;
  }

  // Step 8a: Remove legacy _core/ directory if it exists (migration to pai-hooks/)
  const legacyCoreDir = `${ctx.hooksDir}/_core`;
  if (deps.fileExists(legacyCoreDir)) {
    deps.removeDir(legacyCoreDir);
  }

  // Step 8b: Make hook entry files executable
  for (const { hookDef } of stagedHooks) {
    const hookFilePath = `${ctx.hooksDir}/pai-hooks/${hookDef.manifest.group}/${hookDef.manifest.name}/${hookDef.manifest.name}.hook.ts`;
    deps.chmod(hookFilePath, 0o755);
  }

  // Step 9: Compile hooks if in compiled mode
  const installedEntries: Array<{ hookDef: HookDef; commandString: string; files: string[] }> = [];

  if (outputMode !== "source") {
    const compilerDeps = deps as CompilerDeps;
    for (const { hookDef, staged } of stagedHooks) {
      const hookEntryPath = `${source}/hooks/${hookDef.manifest.group}/${hookDef.manifest.name}/${hookDef.manifest.name}.hook.ts`;
      const outputDir = `${ctx.hooksDir}/pai-hooks/${hookDef.manifest.group}/${hookDef.manifest.name}`;
      const compileResult = compileHook(
        { hookPath: hookEntryPath, mode: outputMode, outputDir, outputName: hookDef.manifest.name, sourceRoot: source },
        compilerDeps,
      );
      if (!compileResult.ok) return compileResult;

      const ext = outputMode === "compiled" ? ".js" : ".ts";
      const relPath = `.claude/hooks/pai-hooks/${hookDef.manifest.group}/${hookDef.manifest.name}/${hookDef.manifest.name}${ext}`;
      const cmdString = compiledCommandString(relPath, outputMode);
      // Make compiled output executable
      const compiledPath = `${outputDir}/${hookDef.manifest.name}${ext}`;
      deps.chmod(compiledPath, 0o755);
      installedEntries.push({ hookDef, commandString: cmdString, files: staged.files });
    }
  } else {
    for (const { hookDef, staged } of stagedHooks) {
      installedEntries.push({ hookDef, commandString: staged.commandString, files: staged.files });
    }
  }

  // Step 10: Merge settings
  const settingsResult = readSettings(claudeDir, deps);
  if (!settingsResult.ok) return settingsResult;
  let settings: SettingsJson = settingsResult.value;

  for (const { hookDef, commandString } of installedEntries) {
    const matcher = getMatcherForHook(hookDef);
    const mergeResult = mergeHookEntry(
      settings,
      hookDef.manifest.event,
      matcher,
      commandString,
    );
    if (!mergeResult.ok) return mergeResult;
    settings = mergeResult.value;
  }

  const writeSettingsResult = writeSettings(claudeDir, settings, deps);
  if (!writeSettingsResult.ok) return writeSettingsResult;

  // Step 11: Write lockfile
  const existingLockResult = readLockfile(claudeDir, deps);
  if (!existingLockResult.ok) return existingLockResult;

  let lockfile: Lockfile = existingLockResult.value ?? createLockfile(source, null, outputMode);
  lockfile = { ...lockfile, outputMode };

  for (const { hookDef, commandString, files } of installedEntries) {
    // Compute file hashes for modification detection
    const fileHashes: Record<string, string> = {};
    for (const relFile of files) {
      const absPath = `${claudeDir}/${relFile}`;
      const hashResult = computeFileHash(absPath, deps);
      if (hashResult.ok) {
        fileHashes[relFile] = hashResult.value;
      }
    }

    const entry: LockfileHookEntry = {
      name: hookDef.manifest.name,
      group: hookDef.manifest.group,
      event: hookDef.manifest.event,
      commandString,
      files,
      fileHashes,
    };
    lockfile = addHookEntry(lockfile, entry);
  }

  const writeLockResult = writeLockfile(claudeDir, lockfile, deps);
  if (!writeLockResult.ok) return writeLockResult;

  // Step 12: Generate tsconfig.json (only relevant for source mode)
  if (outputMode === "source") {
    const tsconfigResult = generateTsconfig(claudeDir, deps);
    if (!tsconfigResult.ok) return tsconfigResult;
  }

  return ok(formatSuccess(installedEntries.map((e) => e.hookDef), outputMode));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Collect core/lib/adapter deps from a hook manifest into a shared set. */
function collectCoreDeps(hookDef: HookDef, coreDeps: Set<string>): void {
  const { deps } = hookDef.manifest;

  for (const dep of deps.core) {
    coreDeps.add(`core/${dep}`);
  }
  for (const dep of deps.lib) {
    coreDeps.add(`lib/${dep}`);
  }
  for (const dep of deps.adapters) {
    coreDeps.add(`core/adapters/${dep}`);
  }
}

/**
 * Derive the settings.json matcher for a hook based on its event type.
 *
 * Hooks in settings.hooks.json use matchers to scope to specific tool names
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-a0619c6a/settings.hooks.json).
 * For source-copy installs, we do not assign a matcher — hooks are installed
 * into a matcherless group so they run for all tools under their event.
 */
function getMatcherForHook(_hookDef: HookDef): string | undefined {
  // In source-copy mode, install without a matcher.
  // Users can manually add matchers to settings.json after install.
  return undefined;
}

/**
 * Determine output mode from parsed flags.
 *
 * Flag precedence defined in cli/core/args.ts
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-ac7f9ecc/cli/core/args.ts).
 */
function resolveOutputMode(args: ParsedArgs): OutputMode {
  if (args.flags.compiled === true) return "compiled";
  if (args.flags.compiledTs === true) return "compiled-ts";
  return DEFAULT_OUTPUT_MODE;
}

/**
 * Check if the requested output mode differs from an existing lockfile's mode.
 * Mode changes require --force to prevent accidental overwrites.
 */
function checkModeChange(
  claudeDir: string,
  requestedMode: OutputMode,
  force: boolean,
  deps: CliDeps,
): Result<void, PaihError> {
  const lockResult = readLockfile(claudeDir, deps);
  if (!lockResult.ok) return lockResult;

  const existing = lockResult.value;
  if (!existing) return ok(undefined);

  if (existing.outputMode !== requestedMode && !force) {
    return err(invalidArgs(
      `Output mode change from "${existing.outputMode}" to "${requestedMode}" requires --force`,
    ));
  }

  return ok(undefined);
}

function formatDryRun(hooks: HookDef[], mode: OutputMode): string {
  const modeLabel = mode === "source" ? "" : ` [${mode}]`;
  const lines = [`Dry run — would install${modeLabel}:`];
  for (const hook of hooks) {
    lines.push(`  ${hook.manifest.group}/${hook.manifest.name} (${hook.manifest.event})`);
  }
  return lines.join("\n");
}

function formatSuccess(hooks: HookDef[], mode: OutputMode): string {
  const modeLabel = mode === "source" ? "" : ` (${mode})`;
  const lines = [`Installed ${hooks.length} hook${hooks.length === 1 ? "" : "s"}${modeLabel}:`];
  for (const hook of hooks) {
    lines.push(`  ${hook.manifest.group}/${hook.manifest.name} (${hook.manifest.event})`);
  }
  return lines.join("\n");
}
