/**
 * Resolved hook types — output of the resolver engine.
 */

import type { HookManifest } from "@hooks/cli/types/manifest";

// ─── HookDef ────────────────────────────────────────────────────────────────

/** A fully resolved hook with its manifest and file paths. */
export interface HookDef {
  /** Hook manifest data. */
  manifest: HookManifest;
  /** Absolute path to the hook's contract file. */
  contractPath: string;
  /** Absolute path to the hook's manifest (hook.json). */
  manifestPath: string;
  /** Absolute path to the hook's source directory. */
  sourceDir: string;
}

// ─── ResolvedHooks ──────────────────────────────────────────────────────────

/** Result of the resolver: deduplicated hooks + dep tree info. */
export interface ResolvedHooks {
  /** Deduplicated, ordered list of hooks to install. */
  hooks: HookDef[];
  /** Map of hook name → names of hooks it depends on (shared deps). */
  depTree: Map<string, string[]>;
}
