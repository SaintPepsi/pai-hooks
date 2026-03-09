#!/usr/bin/env bun

/**
 * Uninstall pai-hooks from the user's Claude Code settings.
 *
 * Removes all hook entries containing the env var reference,
 * removes the env var from settings.json (legacy), and removes
 * the managed block from ~/.zshrc.
 */

import { readFile, writeFile, fileExists } from "@hooks/core/adapters/fs";
import { join, resolve } from "path";
import { removeFromZshrc } from "@hooks/install";

// ─── Types ──────────────────────────────────────────────────────────────────

interface HookEntry {
  type: string;
  command: string;
}

interface MatcherGroup {
  matcher: string;
  hooks: HookEntry[];
}

interface Settings {
  env: Record<string, string>;
  hooks: Record<string, MatcherGroup[]>;
  [key: string]: unknown;
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

export function removeHooksFromSettings(
  settings: { env?: Record<string, string>; hooks?: Record<string, MatcherGroup[]> },
  envVar: string,
): Settings {
  const result: Settings = JSON.parse(JSON.stringify(settings));
  const envVarRef = `\${${envVar}}`;

  // Remove legacy env var from settings
  if (result.env) {
    delete result.env[envVar];
  }

  // Remove hook entries containing the env var
  if (result.hooks) {
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
  }

  return result;
}

// ─── Deps ───────────────────────────────────────────────────────────────────

export interface UninstallDeps {
  readFile: (path: string) => { ok: boolean; value?: string; error?: { message: string } };
  writeFile: (path: string, content: string) => { ok: boolean };
  fileExists: (path: string) => boolean;
  stderr: (msg: string) => void;
  stdout: (msg: string) => void;
  paiDir: string;
  homeDir: string;
}

const defaultDeps: UninstallDeps = {
  readFile,
  writeFile,
  fileExists,
  stderr: (msg) => process.stderr.write(msg + "\n"),
  stdout: (msg) => process.stdout.write(msg + "\n"),
  paiDir: process.env.PAI_DIR || join(process.env.HOME || process.env.USERPROFILE || "", ".claude"),
  homeDir: process.env.HOME || process.env.USERPROFILE || "",
};

// ─── CLI Entry Point ────────────────────────────────────────────────────────

export function run(deps: UninstallDeps = defaultDeps): void {
  const scriptDir = resolve(import.meta.dir);

  // Read manifest
  const manifestPath = join(scriptDir, "pai-hooks.json");
  if (!deps.fileExists(manifestPath)) {
    deps.stderr("Error: pai-hooks.json not found. Are you in the pai-hooks directory?");
    return;
  }
  const manifestResult = deps.readFile(manifestPath);
  if (!manifestResult.ok) return;
  const manifest = JSON.parse(manifestResult.value!);
  const envVar = manifest.envVar;

  // Find settings.json
  const settingsPath = join(deps.paiDir, "settings.json");
  if (!deps.fileExists(settingsPath)) {
    deps.stderr(`Error: ${settingsPath} not found.`);
    return;
  }
  const settingsResult = deps.readFile(settingsPath);
  if (!settingsResult.ok) return;
  const settings = JSON.parse(settingsResult.value!);

  // Check if installed (check both legacy env var and hook commands)
  const envVarRef = `\${${envVar}}`;
  const hasEnvVar = !!settings.env?.[envVar];
  const hasHooks = Object.values(settings.hooks || {}).some((matchers) =>
    (matchers as MatcherGroup[]).some((g) =>
      g.hooks.some((h) => h.command.includes(envVarRef)),
    ),
  );

  if (!hasEnvVar && !hasHooks) {
    deps.stdout("pai-hooks is not installed. Nothing to do.");
    return;
  }

  // Remove hooks and legacy env var from settings
  const cleaned = removeHooksFromSettings(settings, envVar);
  deps.writeFile(settingsPath, JSON.stringify(cleaned, null, 2) + "\n");

  // Remove managed block from zshrc
  const zshrcPath = join(deps.homeDir, ".zshrc");
  if (deps.fileExists(zshrcPath)) {
    const zshrcResult = deps.readFile(zshrcPath);
    if (zshrcResult.ok) {
      const updated = removeFromZshrc(zshrcResult.value!);
      if (updated !== zshrcResult.value!) {
        deps.writeFile(zshrcPath, updated);
        deps.stdout("Removed pai-hooks block from ~/.zshrc");
      }
    }
  }

  deps.stdout(`Uninstalled pai-hooks. Removed ${envVar} and all associated hook entries.`);
}

if (import.meta.main) {
  run();
}
