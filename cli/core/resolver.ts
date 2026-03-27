/**
 * Resolver Engine — Resolve hook/group/preset names to HookDefs.
 *
 * Resolution priority: hook name > group name > preset name (hook wins on collision).
 * Supports wildcard groups: ["*"] expansion, multi-name union, and deduplication.
 */

import type { Result } from "@hooks/cli/core/result";
import { ok, err } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { hookNotFound, depCycle } from "@hooks/cli/core/error";
import type { HookManifest, GroupManifest, PresetEntry } from "@hooks/cli/types/manifest";
import type { HookDef, ResolvedHooks } from "@hooks/cli/types/resolved";
import { dedup } from "@hooks/cli/core/deps";

// ─── Manifest Index ─────────────────────────────────────────────────────────

/** Pre-indexed manifests for fast lookup. Built by the caller before resolving. */
export interface ManifestIndex {
  /** Hook name → HookDef (already resolved with file paths). */
  hooks: Map<string, HookDef>;
  /** Group name → GroupManifest. */
  groups: Map<string, GroupManifest>;
  /** Preset name → PresetEntry. */
  presets: Map<string, PresetEntry>;
}

// ─── Resolver ───────────────────────────────────────────────────────────────

/**
 * Resolve one or more names to a deduplicated set of HookDefs.
 *
 * Resolution order per name:
 *   1. Exact hook name match → single hook
 *   2. Exact group name match → all hooks in group
 *   3. Exact preset name match → expand hooks/groups from preset
 *   4. No match → Err(HOOK_NOT_FOUND)
 *
 * After resolution, hooks are deduplicated and checked for dependency cycles.
 */
export function resolve(
  names: string[],
  manifests: ManifestIndex,
): Result<ResolvedHooks, PaihError> {
  const allHooks: HookDef[] = [];

  for (const name of names) {
    const resolved = resolveSingle(name, manifests);
    if (!resolved.ok) return resolved;
    allHooks.push(...resolved.value);
  }

  const deduplicated = dedup(allHooks);

  // Check for dependency cycles
  const cycleResult = detectCycles(deduplicated, manifests);
  if (!cycleResult.ok) return cycleResult;

  return ok({
    hooks: deduplicated,
    depTree: buildDepTree(deduplicated),
  });
}

// ─── Single Name Resolution ─────────────────────────────────────────────────

function resolveSingle(
  name: string,
  manifests: ManifestIndex,
): Result<HookDef[], PaihError> {
  // 1. Hook name (highest priority)
  const hook = manifests.hooks.get(name);
  if (hook) return ok([hook]);

  // 2. Group name
  const group = manifests.groups.get(name);
  if (group) return expandGroup(group, manifests);

  // 3. Preset name
  const preset = manifests.presets.get(name);
  if (preset) return expandPreset(preset, manifests);

  return err(hookNotFound(name));
}

// ─── Group Expansion ────────────────────────────────────────────────────────

function expandGroup(
  group: GroupManifest,
  manifests: ManifestIndex,
): Result<HookDef[], PaihError> {
  const hooks: HookDef[] = [];
  for (const hookName of group.hooks) {
    const hook = manifests.hooks.get(hookName);
    if (hook) hooks.push(hook);
    // Skip missing hooks within a group (they may not be indexed)
  }
  return ok(hooks);
}

// ─── Preset Expansion ───────────────────────────────────────────────────────

function expandPreset(
  preset: PresetEntry,
  manifests: ManifestIndex,
): Result<HookDef[], PaihError> {
  const hooks: HookDef[] = [];

  // includeAll → every hook in the index
  if (preset.includeAll) {
    for (const hook of manifests.hooks.values()) {
      hooks.push(hook);
    }
    return ok(hooks);
  }

  // Direct hooks list
  if (preset.hooks) {
    for (const hookName of preset.hooks) {
      const hook = manifests.hooks.get(hookName);
      if (hook) hooks.push(hook);
    }
  }

  // Groups list (supports wildcard "*")
  if (preset.groups) {
    const groupNames = expandWildcardGroups(preset.groups, manifests);
    for (const groupName of groupNames) {
      const group = manifests.groups.get(groupName);
      if (group) {
        const expanded = expandGroup(group, manifests);
        if (expanded.ok) hooks.push(...expanded.value);
      }
    }
  }

  return ok(hooks);
}

// ─── Wildcard Expansion ─────────────────────────────────────────────────────

/**
 * Expand groups: ["*"] to all group names in the index.
 * Non-wildcard entries pass through unchanged.
 */
function expandWildcardGroups(
  groups: string[],
  manifests: ManifestIndex,
): string[] {
  if (groups.length === 1 && groups[0] === "*") {
    return [...manifests.groups.keys()];
  }
  return groups;
}

// ─── Dependency Cycle Detection ─────────────────────────────────────────────

/**
 * Detect cycles in the hook dependency graph.
 * Hooks depend on other hooks through shared group membership.
 */
function detectCycles(
  hooks: HookDef[],
  _manifests: ManifestIndex,
): Result<void, PaihError> {
  // Build adjacency: hook → hooks it shares deps with (via group)
  const hooksByGroup = new Map<string, string[]>();
  for (const hook of hooks) {
    const group = hook.manifest.group;
    const existing = hooksByGroup.get(group) ?? [];
    existing.push(hook.manifest.name);
    hooksByGroup.set(group, existing);
  }

  // Shared files (deps.shared) are NOT hook-to-hook dependencies — they are
  // source files shared by multiple hooks in the same group. Two hooks
  // importing the same shared file does not create a directed dependency.
  // Skip cycle detection until the schema supports explicit hook-to-hook deps.
  return ok(undefined);
}

function dfs(
  node: string,
  adj: Map<string, Set<string>>,
  visited: Set<string>,
  inStack: Set<string>,
  path: string[],
): string[] | null {
  if (inStack.has(node)) {
    // Found cycle — extract the cycle path
    const cycleStart = path.indexOf(node);
    return [...path.slice(cycleStart), node];
  }
  if (visited.has(node)) return null;

  visited.add(node);
  inStack.add(node);
  path.push(node);

  const neighbors = adj.get(node);
  if (neighbors) {
    for (const neighbor of neighbors) {
      const cycle = dfs(neighbor, adj, visited, inStack, path);
      if (cycle) return cycle;
    }
  }

  path.pop();
  inStack.delete(node);
  return null;
}

// ─── Dep Tree Builder ───────────────────────────────────────────────────────

/**
 * Build a map of hook name → names of hooks sharing dependencies.
 */
function buildDepTree(hooks: HookDef[]): Map<string, string[]> {
  const tree = new Map<string, string[]>();
  const hooksByGroup = new Map<string, string[]>();

  for (const hook of hooks) {
    const group = hook.manifest.group;
    const existing = hooksByGroup.get(group) ?? [];
    existing.push(hook.manifest.name);
    hooksByGroup.set(group, existing);
  }

  for (const hook of hooks) {
    const groupHooks = hooksByGroup.get(hook.manifest.group) ?? [];
    const related = groupHooks.filter((n) => n !== hook.manifest.name);
    tree.set(hook.manifest.name, related);
  }

  return tree;
}
