#!/usr/bin/env bun

/**
 * Import hooks from settings.hooks.json into settings.json.
 *
 * Used by: post-merge Husky hook (author workflow) and install.ts
 * Reuses mergeHooksIntoSettings from install.ts for the actual merge logic.
 */

import { join, resolve } from "node:path";
import { fileExists, readFile, writeFile } from "@hooks/core/adapters/fs";
import { mergeHooksIntoSettings } from "@hooks/install";

// ─── Deps ───────────────────────────────────────────────────────────────────

export interface ImportHooksDeps {
  readFile: (path: string) => {
    ok: boolean;
    value?: string;
    error?: { message: string };
  };
  writeFile: (path: string, content: string) => { ok: boolean };
  fileExists: (path: string) => boolean;
  stderr: (msg: string) => void;
  homeDir: string;
}

const defaultDeps: ImportHooksDeps = {
  readFile,
  writeFile,
  fileExists,
  stderr: (msg) => process.stderr.write(`${msg}\n`),
  homeDir: process.env.HOME || process.env.USERPROFILE || "",
};

// ─── CLI Entry Point ────────────────────────────────────────────────────────

export function run(deps: ImportHooksDeps = defaultDeps): void {
  const repoRoot = resolve(import.meta.dir, "..");

  const manifestPath = join(repoRoot, "pai-hooks.json");
  if (!deps.fileExists(manifestPath)) {
    deps.stderr("Error: pai-hooks.json not found.");
    return;
  }
  const manifestResult = deps.readFile(manifestPath);
  if (!manifestResult.ok) return;
  const _manifest = JSON.parse(manifestResult.value!);

  const exportedPath = join(repoRoot, "settings.hooks.json");
  if (!deps.fileExists(exportedPath)) {
    deps.stderr("No settings.hooks.json found. Skipping import.");
    return;
  }
  const exportedResult = deps.readFile(exportedPath);
  if (!exportedResult.ok) return;
  const exported = JSON.parse(exportedResult.value!);

  const settingsPath = join(deps.homeDir, ".claude", "settings.json");
  if (!deps.fileExists(settingsPath)) {
    deps.stderr(`${settingsPath} not found. Skipping import.`);
    return;
  }
  const settingsResult = deps.readFile(settingsPath);
  if (!settingsResult.ok) return;
  const settings = JSON.parse(settingsResult.value!);

  const merged = mergeHooksIntoSettings(settings, exported);
  deps.writeFile(settingsPath, `${JSON.stringify(merged, null, 2)}\n`);

  deps.stderr("Imported settings.hooks.json into settings.json");
}

if (import.meta.main) {
  run();
}
