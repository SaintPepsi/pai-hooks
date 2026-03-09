#!/usr/bin/env bun

/**
 * Export hooks from settings.json into settings.hooks.json.
 *
 * Filters hook entries by source path prefix, rewrites paths to use
 * the repo's env var, and writes the result to settings.hooks.json.
 *
 * Used by: pre-commit Husky hook (author workflow)
 */

import { readFile, writeFile } from "@hooks/core/adapters/fs";
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

interface SettingsHooks {
  [event: string]: MatcherGroup[];
}

export interface ExportedHooks {
  envVar: string;
  hooks: Record<string, MatcherGroup[]>;
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

export function extractHooksForRepo(
  settings: { hooks: SettingsHooks },
  sourcePrefix: string,
  targetPrefix: string,
): ExportedHooks {
  const result: Record<string, MatcherGroup[]> = {};

  for (const [event, matchers] of Object.entries(settings.hooks)) {
    const filteredMatchers: MatcherGroup[] = [];

    for (const group of matchers) {
      const filteredHooks = group.hooks
        .filter((h) => h.command.startsWith(sourcePrefix))
        .map((h) => ({
          ...h,
          command: h.command.replace(sourcePrefix, targetPrefix),
        }));

      if (filteredHooks.length > 0) {
        filteredMatchers.push({ matcher: group.matcher, hooks: filteredHooks });
      }
    }

    if (filteredMatchers.length > 0) {
      result[event] = filteredMatchers;
    }
  }

  const envVar = targetPrefix.replace(/^\$\{/, "").replace(/\}.*$/, "");
  return { envVar, hooks: result };
}

// ─── Deps ───────────────────────────────────────────────────────────────────

export interface ExportHooksDeps {
  readFile: (path: string) => { ok: boolean; value?: string; error?: { message: string } };
  writeFile: (path: string, content: string) => { ok: boolean };
  stderr: (msg: string) => void;
  homeDir: string;
}

const defaultDeps: ExportHooksDeps = {
  readFile,
  writeFile,
  stderr: (msg) => process.stderr.write(msg + "\n"),
  homeDir: process.env.HOME || process.env.USERPROFILE || "~",
};

// ─── CLI Entry Point ────────────────────────────────────────────────────────

export function run(deps: ExportHooksDeps = defaultDeps): void {
  const repoRoot = resolve(import.meta.dir, "..");
  const manifestResult = deps.readFile(join(repoRoot, "pai-hooks.json"));
  if (!manifestResult.ok) {
    deps.stderr("Error: pai-hooks.json not found.");
    return;
  }
  const manifest = JSON.parse(manifestResult.value!);
  const envVar = manifest.envVar;

  const settingsPath = join(deps.homeDir, ".claude", "settings.json");
  const settingsResult = deps.readFile(settingsPath);
  if (!settingsResult.ok) {
    deps.stderr(`Error: ${settingsPath} not found.`);
    return;
  }
  const settings = JSON.parse(settingsResult.value!);

  const sourcePrefix = process.argv[2] || "${PAI_DIR}/hooks/";
  const targetPrefix = `\${${envVar}}/hooks/`;

  const exported = extractHooksForRepo(settings, sourcePrefix, targetPrefix);

  const outputPath = join(repoRoot, "settings.hooks.json");
  deps.writeFile(outputPath, JSON.stringify(exported, null, 2) + "\n");

  deps.stderr(`Exported ${Object.values(exported.hooks).flat().length} matcher groups to settings.hooks.json`);
}

if (import.meta.main) {
  run();
}
