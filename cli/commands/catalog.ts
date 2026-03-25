/**
 * catalog command — Show available hooks from hook.json manifests.
 *
 * Reads hook manifests by scanning hooks/ directory structure using the same
 * pattern as the shared manifest loader (cli/core/manifest-loader.ts).
 * Supports default, --groups, and --presets views, each with optional --json.
 *
 * Malformed manifests are skipped with a warning to stderr (non-fatal).
 */

import type { Result } from "@hooks/cli/core/result";
import { ok } from "@hooks/cli/core/result";
import { tryCatch } from "@hooks/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { PaihErrorCode, PaihError as PaihErrorClass } from "@hooks/cli/core/error";
import type { ParsedArgs } from "@hooks/cli/core/args";
import type { CliDeps } from "@hooks/cli/types/deps";
import type { HookManifest, GroupManifest, PresetEntry } from "@hooks/cli/types/manifest";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CatalogResult {
  output: string;
  warnings: string[];
}

// ─── Command ─────────────────────────────────────────────────────────────────

/**
 * Run the catalog command.
 *
 * @param args - Parsed CLI arguments (from cli/core/args.ts).
 * @param deps - Injectable filesystem dependencies (from cli/types/deps.ts).
 * @param sourceRoot - Root of the pai-hooks repo to scan for manifests.
 */
export function catalog(
  args: ParsedArgs,
  deps: CliDeps,
  sourceRoot: string,
): Result<string, PaihError> {
  const result = loadCatalog(deps, sourceRoot);

  if (args.flags.groups) {
    return formatGroups(result.groups, result.warnings, !!args.flags.json);
  }

  if (args.flags.presets) {
    return formatPresets(result.presets, result.warnings, !!args.flags.json);
  }

  return formatHooks(result.hooks, result.warnings, !!args.flags.json);
}

// ─── Loader ──────────────────────────────────────────────────────────────────

interface CatalogData {
  hooks: HookManifest[];
  groups: GroupManifest[];
  presets: Map<string, PresetEntry>;
  warnings: string[];
}

/**
 * Scan hook manifests from source repo using the same directory structure
 * as the shared manifest loader (cli/core/manifest-loader.ts).
 *
 * Unlike loadManifests which builds a ManifestIndex with HookDef references,
 * catalog only needs the manifest data for display. We reuse the same
 * directory-walking pattern but collect warnings instead of failing.
 */
function loadCatalog(deps: CliDeps, sourceRoot: string): CatalogData {
  const hooksDir = `${sourceRoot}/hooks`;
  const hooks: HookManifest[] = [];
  const groups: GroupManifest[] = [];
  const presets = new Map<string, PresetEntry>();
  const warnings: string[] = [];

  if (!deps.fileExists(hooksDir)) {
    return { hooks, groups, presets, warnings };
  }

  const groupDirs = deps.readDir(hooksDir);
  if (!groupDirs.ok) return { hooks, groups, presets, warnings };

  for (const groupName of groupDirs.value) {
    const groupDir = `${hooksDir}/${groupName}`;

    const statResult = deps.stat(groupDir);
    if (!statResult.ok || !statResult.value.isDirectory) continue;

    // Load group.json
    const groupJsonPath = `${groupDir}/group.json`;
    if (deps.fileExists(groupJsonPath)) {
      const parsed = safeParseJson<GroupManifest>(groupJsonPath, deps);
      if (parsed.ok) {
        groups.push(parsed.value);
      } else {
        warnings.push(`Warning: Skipping malformed group.json at ${groupJsonPath}`);
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

      const parsed = safeParseJson<HookManifest>(hookJsonPath, deps);
      if (parsed.ok) {
        hooks.push(parsed.value);
      } else {
        warnings.push(`Warning: Skipping malformed hook.json at ${hookJsonPath}`);
      }
    }
  }

  // Load presets.json from repo root
  const presetsPath = `${sourceRoot}/presets.json`;
  if (deps.fileExists(presetsPath)) {
    const parsed = safeParseJson<Record<string, PresetEntry>>(presetsPath, deps);
    if (parsed.ok) {
      for (const [name, entry] of Object.entries(parsed.value)) {
        presets.set(name, entry);
      }
    } else {
      warnings.push(`Warning: Skipping malformed presets.json at ${presetsPath}`);
    }
  }

  return { hooks, groups, presets, warnings };
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatHooks(
  hooks: HookManifest[],
  warnings: string[],
  json: boolean,
): Result<string, PaihError> {
  if (hooks.length === 0) {
    const msg = json ? "[]" : "No hook manifests found. Add hook.json files to hooks/**/hook.json.";
    return ok(prependWarnings(msg, warnings, json));
  }

  if (json) {
    return ok(JSON.stringify(hooks, null, 2));
  }

  const header = hookRow("Name", "Group", "Event", "Tags", "Description");
  const separator = hookRow("────", "─────", "─────", "────", "───────────");
  const rows = hooks.map((h) =>
    hookRow(h.name, h.group, h.event, (h.tags ?? []).join(", "), truncate(h.description, 60)),
  );

  return ok(prependWarnings([header, separator, ...rows].join("\n"), warnings, json));
}

function formatGroups(
  groups: GroupManifest[],
  warnings: string[],
  json: boolean,
): Result<string, PaihError> {
  if (groups.length === 0) {
    const msg = json ? "[]" : "No group manifests found.";
    return ok(prependWarnings(msg, warnings, json));
  }

  if (json) {
    return ok(JSON.stringify(groups, null, 2));
  }

  const header = groupRow("Group", "Hook Count", "Description");
  const separator = groupRow("─────", "──────────", "───────────");
  const rows = groups.map((g) =>
    groupRow(g.name, String(g.hooks.length), truncate(g.description, 60)),
  );

  return ok(prependWarnings([header, separator, ...rows].join("\n"), warnings, json));
}

function formatPresets(
  presets: Map<string, PresetEntry>,
  warnings: string[],
  json: boolean,
): Result<string, PaihError> {
  if (presets.size === 0) {
    const msg = json ? "{}" : "No presets found.";
    return ok(prependWarnings(msg, warnings, json));
  }

  if (json) {
    const obj: Record<string, PresetEntry> = {};
    for (const [name, entry] of presets) {
      obj[name] = entry;
    }
    return ok(JSON.stringify(obj, null, 2));
  }

  const header = presetRow("Preset", "Description", "Hooks/Groups");
  const separator = presetRow("──────", "───────────", "────────────");
  const rows: string[] = [];
  for (const [name, entry] of presets) {
    const items: string[] = [];
    if (entry.includeAll) items.push("*all*");
    if (entry.groups) items.push(...entry.groups.map((g) => `group:${g}`));
    if (entry.hooks) items.push(...entry.hooks);
    rows.push(presetRow(name, truncate(entry.description, 40), items.join(", ")));
  }

  return ok(prependWarnings([header, separator, ...rows].join("\n"), warnings, json));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse JSON from a file using tryCatch at the adapter boundary
 * (per core/result.ts). Returns Result instead of throwing.
 */
function safeParseJson<T>(path: string, deps: CliDeps): Result<T, PaihError> {
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

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function hookRow(name: string, group: string, event: string, tags: string, desc: string): string {
  return [
    name.padEnd(24),
    group.padEnd(20),
    event.padEnd(16),
    tags.padEnd(20),
    desc,
  ].join("  ");
}

function groupRow(group: string, hookCount: string, desc: string): string {
  return [
    group.padEnd(24),
    hookCount.padEnd(12),
    desc,
  ].join("  ");
}

function presetRow(preset: string, desc: string, items: string): string {
  return [
    preset.padEnd(20),
    desc.padEnd(44),
    items,
  ].join("  ");
}

/** Prepend warnings to output for non-JSON modes. */
function prependWarnings(output: string, warnings: string[], json: boolean): string {
  if (json || warnings.length === 0) return output;
  return warnings.join("\n") + "\n\n" + output;
}
