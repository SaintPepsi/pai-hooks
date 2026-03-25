/**
 * install command — Copy hooks from source repo to target .claude/hooks/.
 *
 * Pipeline: parseArgs → resolveTarget → loadManifests → resolve → stage → mergeSettings → writeLockfile
 *
 * Follows the pipe() pattern from cli/core/pipe.ts and uses CliDeps for DI.
 * Settings merge is append-only and idempotent per cli/core/settings.ts.
 * File staging is atomic per cli/core/staging.ts.
 *
 * Entry point wired from cli/bin/paih.ts routeCommand (see
 * /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-a0619c6a/cli/bin/paih.ts).
 */

import type { Result } from "@hooks/cli/core/result";
import { ok, err } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { invalidArgs } from "@hooks/cli/core/error";
import type { ParsedArgs } from "@hooks/cli/core/args";
import type { CliDeps } from "@hooks/cli/types/deps";
import type { HookDef } from "@hooks/cli/types/resolved";
import type { Lockfile, LockfileHookEntry } from "@hooks/cli/types/lockfile";
import { createLockfile } from "@hooks/cli/types/lockfile";
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
import { readLockfile, writeLockfile, addHookEntry } from "@hooks/cli/core/lockfile";
import { generateTsconfig } from "@hooks/cli/core/tsconfig-gen";

// ─── Install Pipeline ───────────────────────────────────────────────────────

/**
 * Execute the install command.
 *
 * @param args - Parsed CLI arguments with names and flags.
 * @param deps - Injectable filesystem/process dependencies.
 * @param sourceRoot - Override source repo root (defaults to deps.cwd()).
 */
export function install(
  args: ParsedArgs,
  deps: CliDeps,
  sourceRoot?: string,
): Result<string, PaihError> {
  // Validate: need at least one name or --preset flag
  if (args.names.length === 0) {
    return err(invalidArgs("install requires at least one hook, group, or preset name"));
  }

  const force = args.flags.force === true;
  const dryRun = args.flags.dryRun === true;

  // Step 1: Resolve target .claude/ directory
  const toFlag = typeof args.flags.to === "string" ? args.flags.to : undefined;
  const targetResult = resolveTarget(deps, toFlag);
  if (!targetResult.ok) return targetResult;
  const targetDir = targetResult.value;
  const claudeDir = `${targetDir}/.claude`;

  // Step 2: Load manifests from source repo
  const source = sourceRoot ?? deps.cwd();
  const manifestResult = loadManifests(source, deps);
  if (!manifestResult.ok) return manifestResult;
  const manifests = manifestResult.value;

  // Step 3: Resolve names to hooks
  const resolveResult = resolve(args.names, manifests);
  if (!resolveResult.ok) return resolveResult;
  const { hooks } = resolveResult.value;

  if (hooks.length === 0) {
    return ok("No hooks to install.");
  }

  if (dryRun) {
    return ok(formatDryRun(hooks));
  }

  // Step 4: Create staging directory
  const stagingResult = createStaging(claudeDir, deps);
  if (!stagingResult.ok) return stagingResult;
  const ctx = { ...stagingResult.value, sourceRoot: source };

  // Step 5: Stage hook files
  const stagedHooks: Array<{ hookDef: HookDef; staged: StagedFiles }> = [];
  const allCoreDeps = new Set<string>();

  for (const hookDef of hooks) {
    const stageResult = stageHook(ctx, hookDef, deps);
    if (!stageResult.ok) {
      cleanStaging(ctx.stagingDir, deps);
      return stageResult;
    }
    stagedHooks.push({ hookDef, staged: stageResult.value });

    // Collect core deps for deduplication
    collectCoreDeps(hookDef, allCoreDeps);
  }

  // Step 6: Stage core modules (deduped)
  const coreResult = stageCoreModules(ctx, allCoreDeps, deps);
  if (!coreResult.ok) {
    cleanStaging(ctx.stagingDir, deps);
    return coreResult;
  }

  // Step 7: Commit staging (atomic move)
  const commitResult = commitStaging(ctx, deps);
  if (!commitResult.ok) {
    cleanStaging(ctx.stagingDir, deps);
    return commitResult;
  }

  // Step 8: Merge settings
  const settingsResult = readSettings(claudeDir, deps);
  if (!settingsResult.ok) return settingsResult;
  let settings: SettingsJson = settingsResult.value;

  for (const { hookDef, staged } of stagedHooks) {
    const matcher = getMatcherForHook(hookDef);
    const mergeResult = mergeHookEntry(
      settings,
      hookDef.manifest.event,
      matcher,
      staged.commandString,
    );
    if (!mergeResult.ok) return mergeResult;
    settings = mergeResult.value;
  }

  const writeSettingsResult = writeSettings(claudeDir, settings, deps);
  if (!writeSettingsResult.ok) return writeSettingsResult;

  // Step 9: Write lockfile
  const existingLockResult = readLockfile(claudeDir, deps);
  if (!existingLockResult.ok) return existingLockResult;

  let lockfile: Lockfile = existingLockResult.value ?? createLockfile(source, null);

  for (const { hookDef, staged } of stagedHooks) {
    const entry: LockfileHookEntry = {
      name: hookDef.manifest.name,
      group: hookDef.manifest.group,
      event: hookDef.manifest.event,
      commandString: staged.commandString,
      files: staged.files,
    };
    lockfile = addHookEntry(lockfile, entry);
  }

  const writeLockResult = writeLockfile(claudeDir, lockfile, deps);
  if (!writeLockResult.ok) return writeLockResult;

  // Step 10: Generate tsconfig.json
  const tsconfigResult = generateTsconfig(claudeDir, deps);
  if (!tsconfigResult.ok) return tsconfigResult;

  return ok(formatSuccess(stagedHooks.map((s) => s.hookDef)));
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

function formatDryRun(hooks: HookDef[]): string {
  const lines = ["Dry run — would install:"];
  for (const hook of hooks) {
    lines.push(`  ${hook.manifest.group}/${hook.manifest.name} (${hook.manifest.event})`);
  }
  return lines.join("\n");
}

function formatSuccess(hooks: HookDef[]): string {
  const lines = [`Installed ${hooks.length} hook${hooks.length === 1 ? "" : "s"}:`];
  for (const hook of hooks) {
    lines.push(`  ${hook.manifest.group}/${hook.manifest.name} (${hook.manifest.event})`);
  }
  return lines.join("\n");
}
