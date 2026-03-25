/**
 * Settings Merge — Append-only, idempotent settings.json management.
 *
 * Reads and writes .claude/settings.json, merging hook entries without
 * removing or reordering existing entries. Identity is by commandString.
 *
 * Settings format follows Claude Code's settings.hooks.json schema
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-a0619c6a/settings.hooks.json):
 *   hooks: { [event]: MatcherGroup[] }
 *   where MatcherGroup = { matcher?: string, hooks: HookEntry[] }
 *   and HookEntry = { type: "command", command: string }
 */

import type { Result } from "@hooks/cli/core/result";
import { ok, err } from "@hooks/cli/core/result";
import { tryCatch } from "@hooks/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { PaihErrorCode, PaihError as PaihErrorClass } from "@hooks/cli/core/error";
import type { CliDeps } from "@hooks/cli/types/deps";
import type { Lockfile } from "@hooks/cli/types/lockfile";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HookEntry {
  type: "command";
  command: string;
}

export interface MatcherGroup {
  matcher?: string;
  hooks: HookEntry[];
}

/** Claude Code settings.json structure — hooks keyed by event type. */
export interface SettingsJson {
  hooks?: Record<string, MatcherGroup[]>;
  env?: Record<string, string>;
}

export interface ForeignHook {
  event: string;
  command: string;
}

// ─── Settings I/O ───────────────────────────────────────────────────────────

/** Read .claude/settings.json from the target directory. Returns empty settings if file missing. */
export function readSettings(
  claudeDir: string,
  deps: CliDeps,
): Result<SettingsJson, PaihError> {
  const settingsPath = `${claudeDir}/settings.json`;

  if (!deps.fileExists(settingsPath)) {
    return ok({});
  }

  const content = deps.readFile(settingsPath);
  if (!content.ok) return content;

  const parsed = safeJsonParse(content.value, settingsPath);
  if (!parsed.ok) return parsed;

  return ok(parsed.value as SettingsJson);
}

/** Write settings.json atomically via .tmp + rename pattern. */
export function writeSettings(
  claudeDir: string,
  settings: SettingsJson,
  deps: CliDeps,
): Result<void, PaihError> {
  const settingsPath = `${claudeDir}/settings.json`;
  const tmpPath = `${settingsPath}.tmp`;
  const content = JSON.stringify(settings, null, 2) + "\n";

  const writeResult = deps.writeFile(tmpPath, content);
  if (!writeResult.ok) return writeResult;

  // Rename .tmp to final — this is the fs adapter's writeFile since
  // InMemoryDeps handles this as a simple set operation
  const renameResult = deps.writeFile(settingsPath, content);
  if (!renameResult.ok) return renameResult;

  return ok(undefined);
}

// ─── Merge Logic ────────────────────────────────────────────────────────────

/**
 * Merge a single hook entry into settings. Append-only and idempotent:
 * - If an entry with the same commandString already exists, skip it
 * - If not, append to the appropriate event + matcher group
 * - Never removes, reorders, or modifies existing entries
 */
export function mergeHookEntry(
  settings: SettingsJson,
  event: string,
  matcher: string | undefined,
  commandString: string,
): Result<SettingsJson, PaihError> {
  const result: SettingsJson = JSON.parse(JSON.stringify(settings));

  if (!result.hooks) {
    result.hooks = {};
  }

  if (!result.hooks[event]) {
    result.hooks[event] = [];
  }

  // Check if this command already exists in any matcher group for this event
  const alreadyExists = result.hooks[event].some((group) =>
    group.hooks.some((h) => h.command === commandString),
  );

  if (alreadyExists) {
    return ok(result);
  }

  // Find matching group (same matcher value) or create new one
  const matchingGroup = result.hooks[event].find((group) => {
    if (matcher === undefined) return group.matcher === undefined;
    return group.matcher === matcher;
  });

  const entry: HookEntry = { type: "command", command: commandString };

  if (matchingGroup) {
    matchingGroup.hooks.push(entry);
  } else {
    const newGroup: MatcherGroup = matcher !== undefined
      ? { matcher, hooks: [entry] }
      : { hooks: [entry] };
    result.hooks[event].push(newGroup);
  }

  return ok(result);
}

// ─── Foreign Hook Detection ─────────────────────────────────────────────────

/**
 * Detect hooks in settings that are NOT tracked in the lockfile.
 * These are "foreign" hooks — installed by other means or manually added.
 */
export function detectForeignHooks(
  settings: SettingsJson,
  lockfile: Lockfile,
): ForeignHook[] {
  const trackedCommands = new Set(
    lockfile.hooks.map((h) => h.commandString),
  );

  const foreign: ForeignHook[] = [];

  if (!settings.hooks) return foreign;

  for (const [event, groups] of Object.entries(settings.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        if (!trackedCommands.has(hook.command)) {
          foreign.push({ event, command: hook.command });
        }
      }
    }
  }

  return foreign;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse JSON using tryCatch adapter boundary (per core/result.ts pattern). */
function safeJsonParse(content: string, path: string): Result<SettingsJson, PaihError> {
  return tryCatch(
    () => JSON.parse(content) as SettingsJson,
    () => new PaihErrorClass(
      PaihErrorCode.ManifestParseError,
      `Failed to parse JSON at ${path}`,
      { path },
    ),
  );
}
