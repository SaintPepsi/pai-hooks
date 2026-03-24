#!/usr/bin/env bun

/**
 * Export hooks from settings.json into settings.hooks.json.
 *
 * Filters hook entries by source path prefix, rewrites paths to use
 * the repo's env var, and writes the result to settings.hooks.json.
 *
 * Used by: pre-commit Husky hook (author workflow)
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

/**
 * Filter exported hooks to only those whose .hook.ts file exists in the repo.
 * Prevents exporting hooks that live in the source settings but aren't
 * implemented in this repo (e.g., PAI-specific hooks like ArticleWriter).
 *
 * Resolves the full relative path from the command (e.g., hooks/CronStatusLine/CronCreate/CronCreate.hook.ts)
 * to support both flat hooks (hooks/MyHook.hook.ts) and group hooks (hooks/Group/Hook/Hook.hook.ts).
 */
export function filterToExistingFiles(
  exported: ExportedHooks,
  repoRoot: string,
  checkExists: (path: string) => boolean,
): ExportedHooks {
  const filtered: Record<string, MatcherGroup[]> = {};
  const envVarPrefix = `\${${exported.envVar}}/`;

  for (const [event, matchers] of Object.entries(exported.hooks)) {
    const filteredMatchers: MatcherGroup[] = [];

    for (const group of matchers) {
      const existingHooks = group.hooks.filter((h) => {
        // Strip env var prefix to get relative path (e.g., hooks/CronStatusLine/CronCreate/CronCreate.hook.ts)
        const relativePath = h.command.startsWith(envVarPrefix)
          ? h.command.slice(envVarPrefix.length)
          : h.command.split("/").pop() || "";
        return checkExists(join(repoRoot, relativePath));
      });

      if (existingHooks.length > 0) {
        filteredMatchers.push({ matcher: group.matcher, hooks: existingHooks });
      }
    }

    if (filteredMatchers.length > 0) {
      filtered[event] = filteredMatchers;
    }
  }

  return { envVar: exported.envVar, hooks: filtered };
}

function safeJsonParse(content: string): Record<string, MatcherGroup[]> | null {
  const parsed = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null) return null;
  return parsed as Record<string, MatcherGroup[]>;
}

/**
 * Discover per-hook settings.hooks.json files from group directories.
 * Scans hooks/{Group}/{Hook}/settings.hooks.json and merges them into a combined registry.
 *
 * This enables hook groups where each hook owns its registration config:
 *   hooks/CronStatusLine/CronCreate/settings.hooks.json
 *   hooks/CronStatusLine/CronDelete/settings.hooks.json
 */
export function discoverGroupHooks(
  repoRoot: string,
  deps: { readFile: ExportHooksDeps["readFile"]; fileExists: ExportHooksDeps["fileExists"]; stderr: ExportHooksDeps["stderr"] },
): Record<string, MatcherGroup[]> {
  const hooksDir = join(repoRoot, "hooks");
  const discovered: Record<string, MatcherGroup[]> = {};

  if (!deps.fileExists(hooksDir)) return discovered;

  const glob = new Bun.Glob("*/*/settings.hooks.json");
  const matches = Array.from(glob.scanSync({ cwd: hooksDir }));

  for (const relPath of matches) {
    const fullPath = join(hooksDir, relPath);
    const result = deps.readFile(fullPath);
    if (!result.ok) continue;

    const config = safeJsonParse(result.value!);
    if (!config) {
      deps.stderr(`[discover-hooks] Skipping malformed ${relPath}`);
      continue;
    }

    for (const [event, matchers] of Object.entries(config)) {
      if (!discovered[event]) discovered[event] = [];
      discovered[event].push(...matchers);
    }

    deps.stderr(`[discover-hooks] Found ${relPath}`);
  }

  return discovered;
}

// ─── Deps ───────────────────────────────────────────────────────────────────

export interface ExportHooksDeps {
  readFile: (path: string) => { ok: boolean; value?: string; error?: { message: string } };
  writeFile: (path: string, content: string) => { ok: boolean };
  fileExists: (path: string) => boolean;
  stderr: (msg: string) => void;
  homeDir: string;
}

const defaultDeps: ExportHooksDeps = {
  readFile,
  writeFile,
  fileExists,
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

  const targetPrefix = `\${${envVar}}/hooks/`;
  const sourcePrefix = process.argv[2] || targetPrefix;

  const extracted = extractHooksForRepo(settings, sourcePrefix, targetPrefix);
  const exported = filterToExistingFiles(extracted, repoRoot, deps.fileExists);

  // Discover per-hook settings.hooks.json from group directories and merge
  const groupHooks = discoverGroupHooks(repoRoot, deps);
  for (const [event, matchers] of Object.entries(groupHooks)) {
    if (!exported.hooks[event]) exported.hooks[event] = [];
    // Avoid duplicates: skip matchers whose commands already exist
    for (const matcher of matchers) {
      const existingCommands = new Set(
        exported.hooks[event].flatMap(m => m.hooks.map(h => h.command)),
      );
      const newHooks = matcher.hooks.filter(h => !existingCommands.has(h.command));
      if (newHooks.length > 0) {
        exported.hooks[event].push({ ...matcher, hooks: newHooks });
      }
    }
  }

  const matcherCount = Object.values(exported.hooks).flat().length;

  // Safety guard: refuse to write empty hooks if settings.hooks.json already has content
  if (matcherCount === 0) {
    const outputPath = join(repoRoot, "settings.hooks.json");
    if (deps.fileExists(outputPath)) {
      const existing = deps.readFile(outputPath);
      if (existing.ok) {
        const parsed = JSON.parse(existing.value!);
        const existingCount = Object.values(parsed.hooks || {}).flat().length;
        if (existingCount > 0) {
          deps.stderr(`[export-hooks] ABORT: Would overwrite ${existingCount} matcher groups with 0. Source prefix "${sourcePrefix}" matched nothing in settings.json. Keeping existing file.`);
          return;
        }
      }
    }
  }

  const outputPath = join(repoRoot, "settings.hooks.json");
  deps.writeFile(outputPath, JSON.stringify(exported, null, 2) + "\n");

  const skipped = Object.values(extracted.hooks).flat().length - matcherCount;
  const skippedMsg = skipped > 0 ? ` (${skipped} skipped — no matching file in repo)` : "";
  deps.stderr(`Exported ${matcherCount} matcher groups to settings.hooks.json${skippedMsg}`);
}

if (import.meta.main) {
  run();
}
