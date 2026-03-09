#!/usr/bin/env bun

/**
 * Install pai-hooks into the user's Claude Code settings.
 *
 * - Reads pai-hooks.json manifest for env var name
 * - Reads settings.hooks.json for hook registrations
 * - Merges into ~/.claude/settings.json (additive, idempotent)
 * - Sets the env var to point to this repo's clone location
 */

import { readFile, writeFile, fileExists } from "@hooks/core/adapters/fs";
import { join, resolve } from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

interface HookEntry {
  type: string;
  command: string;
}

interface MatcherGroup {
  matcher: string;
  hooks: HookEntry[];
}

interface ExportedHooks {
  envVar: string;
  hooks: Record<string, MatcherGroup[]>;
}

interface Settings {
  env: Record<string, string>;
  hooks: Record<string, MatcherGroup[]>;
  [key: string]: unknown;
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

export function isAlreadyInstalled(settings: { env?: Record<string, string> }, envVar: string): boolean {
  return settings.env?.[envVar] !== undefined;
}

/**
 * Merge exported hooks into a settings object.
 *
 * - Sets the env var to the clone path
 * - Removes existing entries owned by this env var (identified by ${envVar} in command)
 * - Appends new entries from the export
 *
 * This makes re-install idempotent: old entries are replaced, not duplicated.
 */
export function mergeHooksIntoSettings(
  settings: { env?: Record<string, string>; hooks?: Record<string, MatcherGroup[]> },
  exported: ExportedHooks,
  clonePath: string,
): Settings {
  const result: Settings = JSON.parse(JSON.stringify(settings));
  const envVar = exported.envVar;
  const envVarRef = `\${${envVar}}`;

  // Set env var
  if (!result.env) result.env = {};
  result.env[envVar] = clonePath;

  // Initialize hooks if missing
  if (!result.hooks) result.hooks = {};

  // First pass: remove existing entries owned by this env var
  for (const [event, matchers] of Object.entries(result.hooks)) {
    result.hooks[event] = matchers
      .map((group: MatcherGroup) => ({
        ...group,
        hooks: group.hooks.filter((h: HookEntry) => !h.command.includes(envVarRef)),
      }))
      .filter((group: MatcherGroup) => group.hooks.length > 0);

    if (result.hooks[event].length === 0) {
      delete result.hooks[event];
    }
  }

  // Second pass: append new entries from export
  for (const [event, matchers] of Object.entries(exported.hooks)) {
    if (!result.hooks[event]) result.hooks[event] = [];
    result.hooks[event].push(...matchers);
  }

  return result;
}

// ─── Deps ───────────────────────────────────────────────────────────────────

export interface InstallDeps {
  readFile: (path: string) => { ok: boolean; value?: string; error?: { message: string } };
  writeFile: (path: string, content: string) => { ok: boolean };
  fileExists: (path: string) => boolean;
  stderr: (msg: string) => void;
  stdout: (msg: string) => void;
  homeDir: string;
}

const defaultDeps: InstallDeps = {
  readFile,
  writeFile,
  fileExists,
  stderr: (msg) => process.stderr.write(msg + "\n"),
  stdout: (msg) => process.stdout.write(msg + "\n"),
  homeDir: process.env.HOME || process.env.USERPROFILE || "",
};

// ─── CLI Entry Point ────────────────────────────────────────────────────────

export function run(deps: InstallDeps = defaultDeps): void {
  const repoRoot = resolve(import.meta.dir);

  // Read manifest
  const manifestPath = join(repoRoot, "pai-hooks.json");
  if (!deps.fileExists(manifestPath)) {
    deps.stderr("Error: pai-hooks.json not found. Are you in the pai-hooks directory?");
    return;
  }
  const manifestResult = deps.readFile(manifestPath);
  if (!manifestResult.ok) return;
  const manifest = JSON.parse(manifestResult.value!);

  // Read exported hooks
  const exportedPath = join(repoRoot, "settings.hooks.json");
  if (!deps.fileExists(exportedPath)) {
    deps.stderr("Error: settings.hooks.json not found. Run 'bun run export-settings' first.");
    return;
  }
  const exportedResult = deps.readFile(exportedPath);
  if (!exportedResult.ok) return;
  const exported: ExportedHooks = JSON.parse(exportedResult.value!);

  // Find settings.json
  const settingsPath = join(deps.homeDir, ".claude", "settings.json");
  if (!deps.fileExists(settingsPath)) {
    deps.stderr(`Error: ${settingsPath} not found. Is Claude Code installed?`);
    return;
  }
  const settingsResult = deps.readFile(settingsPath);
  if (!settingsResult.ok) return;
  const settings = JSON.parse(settingsResult.value!);

  // Check if already installed
  if (isAlreadyInstalled(settings, manifest.envVar)) {
    deps.stdout(`pai-hooks already installed (${manifest.envVar} is set). Re-installing...`);
  }

  // Merge and write
  const merged = mergeHooksIntoSettings(settings, exported, repoRoot);
  deps.writeFile(settingsPath, JSON.stringify(merged, null, 2) + "\n");

  // Count what was added
  const matcherCount = Object.values(exported.hooks).flat().length;
  const hookCount = Object.values(exported.hooks)
    .flat()
    .reduce((sum: number, g: MatcherGroup) => sum + g.hooks.length, 0);

  deps.stdout(`\nInstalled ${hookCount} hooks across ${matcherCount} matcher groups.`);
  deps.stdout(`Environment variable ${manifest.envVar} set to: ${repoRoot}`);
  deps.stdout(`\nTo uninstall: bun run uninstall.ts`);
}

if (import.meta.main) {
  run();
}
