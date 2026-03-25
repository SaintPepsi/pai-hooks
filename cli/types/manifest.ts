/**
 * Manifest types for the paih CLI selective hook installer.
 *
 * Three manifest levels:
 *   HookManifest  — per-hook (hook.json adjacent to contract)
 *   GroupManifest — per-group (group.json in group directory)
 *   PresetConfig  — repo-level (presets.json at repo root)
 */

import type { HookEventType } from "@hooks/core/types/hook-inputs";

// ─── Schema Version ─────────────────────────────────────────────────────────

export const MANIFEST_SCHEMA_VERSION = 1;

// ─── Hook Manifest ──────────────────────────────────────────────────────────

export interface HookDeps {
  /** Core modules: contract, result, error, types/hook-inputs, adapters/fs, etc. */
  core: string[];
  /** Lib utilities: paths, algorithm-state, identity, etc. */
  lib: string[];
  /** Adapter modules: fs, process, fetch, stdin, etc. */
  adapters: string[];
  /** Shared files within the group. false = no shared deps. string[] = specific filenames. */
  shared: string[] | false;
}

export interface HookManifest {
  /** Hook name matching the contract export name. */
  name: string;
  /** Group this hook belongs to. */
  group: string;
  /** Hook event type from core/types/hook-inputs.ts. */
  event: HookEventType;
  /** Human-readable description. */
  description: string;
  /** Schema version for forward compatibility. */
  schemaVersion: number;
  /** Categorized dependency declarations. */
  deps: HookDeps;
  /** Searchable tags for catalog filtering. */
  tags: string[];
  /** Preset names this hook belongs to. */
  presets: string[];
}

// ─── Group Manifest ─────────────────────────────────────────────────────────

export interface GroupManifest {
  /** Group name matching the directory name. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Hook names in this group, alphabetically sorted. */
  hooks: string[];
  /** Shared files contributed by this group (e.g. ["shared.ts"]). */
  sharedFiles: string[];
}

// ─── Preset Config ──────────────────────────────────────────────────────────

export interface PresetEntry {
  /** Human-readable preset description. */
  description: string;
  /** Specific hooks to include. */
  hooks?: string[];
  /** Groups to include. "*" means all groups. */
  groups?: string[];
  /** Include all hooks regardless of other selections. */
  includeAll?: boolean;
}

/** Repo-level preset configuration. Keys are preset names. */
export type PresetConfig = Record<string, PresetEntry>;
