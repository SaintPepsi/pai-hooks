/**
 * Dependency Deduplication — Remove duplicate HookDefs by identity.
 *
 * Identity is defined as hook name + source directory path.
 * First-seen-wins ordering (stable).
 */

import type { HookDef } from "@hooks/cli/types/resolved";

/**
 * Deduplicate hooks by identity (name + sourceDir).
 * First occurrence wins — preserves insertion order.
 */
export function dedup(hooks: HookDef[]): HookDef[] {
  const seen = new Set<string>();
  const result: HookDef[] = [];

  for (const hook of hooks) {
    const identity = `${hook.manifest.name}::${hook.sourceDir}`;
    if (!seen.has(identity)) {
      seen.add(identity);
      result.push(hook);
    }
  }

  return result;
}
