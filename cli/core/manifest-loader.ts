/**
 * Manifest Loader — Build ManifestIndex from source repo hook/group/preset files.
 *
 * Scans the hooks/ directory structure to find hook.json and group.json manifests,
 * reads presets.json from the repo root, and builds the ManifestIndex needed
 * by the resolver (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-a0619c6a/cli/core/resolver.ts).
 *
 * Directory layout follows the hook structure documented in group.json manifests
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-a0619c6a/hooks/CodingStandards/group.json):
 *   hooks/<Group>/group.json
 *   hooks/<Group>/<Hook>/hook.json
 */

import type { Result } from "@hooks/cli/core/result";
import { ok } from "@hooks/cli/core/result";
import { tryCatch } from "@hooks/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { PaihErrorCode, PaihError as PaihErrorClass } from "@hooks/cli/core/error";
import type { CliDeps } from "@hooks/cli/types/deps";
import type { HookManifest, GroupManifest, PresetEntry } from "@hooks/cli/types/manifest";
import type { HookDef } from "@hooks/cli/types/resolved";
import type { ManifestIndex } from "@hooks/cli/core/resolver";

// ─── Loader ─────────────────────────────────────────────────────────────────

/**
 * Load all manifests from a source repo and build a ManifestIndex.
 *
 * @param sourceRoot - Absolute path to the pai-hooks repo root.
 * @param deps - Injectable filesystem dependencies.
 */
export function loadManifests(
  sourceRoot: string,
  deps: CliDeps,
): Result<ManifestIndex, PaihError> {
  const hooksDir = `${sourceRoot}/hooks`;
  const hooks = new Map<string, HookDef>();
  const groups = new Map<string, GroupManifest>();
  const presets = new Map<string, PresetEntry>();

  // Load groups and hooks from hooks/ directory
  if (deps.fileExists(hooksDir)) {
    const groupDirs = deps.readDir(hooksDir);
    if (!groupDirs.ok) return groupDirs;

    for (const groupName of groupDirs.value) {
      const groupDir = `${hooksDir}/${groupName}`;

      // Skip non-directories (e.g., .test files at group level)
      const statResult = deps.stat(groupDir);
      if (!statResult.ok || !statResult.value.isDirectory) continue;

      // Load group.json if present
      const groupJsonPath = `${groupDir}/group.json`;
      if (deps.fileExists(groupJsonPath)) {
        const groupResult = loadJson<GroupManifest>(groupJsonPath, deps);
        if (groupResult.ok) {
          groups.set(groupName, groupResult.value);
        }
      }

      // Scan hook subdirectories
      const hookDirs = deps.readDir(groupDir);
      if (!hookDirs.ok) continue;

      for (const hookName of hookDirs.value) {
        const hookDir = `${groupDir}/${hookName}`;

        const hookStat = deps.stat(hookDir);
        if (!hookStat.ok || !hookStat.value.isDirectory) continue;

        const hookJsonPath = `${hookDir}/hook.json`;
        if (!deps.fileExists(hookJsonPath)) continue;

        const hookResult = loadJson<HookManifest>(hookJsonPath, deps);
        if (!hookResult.ok) continue;

        const hookDef: HookDef = {
          manifest: hookResult.value,
          contractPath: `${hookDir}/${hookName}.contract.ts`,
          manifestPath: hookJsonPath,
          sourceDir: hookDir,
        };

        hooks.set(hookName, hookDef);
      }
    }
  }

  // Load presets.json from repo root
  const presetsPath = `${sourceRoot}/presets.json`;
  if (deps.fileExists(presetsPath)) {
    const presetsResult = loadJson<Record<string, PresetEntry>>(presetsPath, deps);
    if (presetsResult.ok) {
      for (const [name, entry] of Object.entries(presetsResult.value)) {
        presets.set(name, entry);
      }
    }
  }

  return ok({ hooks, groups, presets });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Load and parse a JSON file using tryCatch at the adapter boundary (per core/result.ts). */
function loadJson<T>(path: string, deps: CliDeps): Result<T, PaihError> {
  const content = deps.readFile(path);
  if (!content.ok) return content;

  return tryCatch(
    () => JSON.parse(content.value) as T,
    () => new PaihErrorClass(
      PaihErrorCode.ManifestParseError,
      `Failed to parse JSON at ${path}`,
      { path },
    ),
  );
}
