#!/usr/bin/env bun

/**
 * Ensure the pai-hooks env var is set in ~/.zshrc.
 *
 * Reads the env var name from pai-hooks.json, then writes/updates
 * the managed block in ~/.zshrc. Idempotent — safe to run on every
 * post-checkout and post-merge.
 *
 * Called by:
 *   - pai-hooks/install.ts (during first install)
 *   - Main repo .husky/post-merge and .husky/post-checkout
 */

import { join, resolve } from "node:path";
import { fileExists, readFile, writeFile } from "@hooks/core/adapters/fs";
import { addToZshrc } from "@hooks/install";

// ─── Deps ───────────────────────────────────────────────────────────────────

export interface EnsureEnvDeps {
  readFile: (path: string) => {
    ok: boolean;
    value?: string;
    error?: { message: string };
  };
  writeFile: (path: string, content: string) => { ok: boolean };
  fileExists: (path: string) => boolean;
  stderr: (msg: string) => void;
  stdout: (msg: string) => void;
  homeDir: string;
}

const defaultDeps: EnsureEnvDeps = {
  readFile,
  writeFile,
  fileExists,
  stderr: (msg) => process.stderr.write(`${msg}\n`),
  stdout: (msg) => process.stdout.write(`${msg}\n`),
  homeDir: process.env.HOME || process.env.USERPROFILE || "",
};

// ─── Core ───────────────────────────────────────────────────────────────────

/**
 * Ensure a specific env var is written to ~/.zshrc.
 * Used by install.ts (which already has the envVar from manifest)
 * and by the CLI entry point below.
 */
export function ensureEnvVar(envVar: string, deps: EnsureEnvDeps): void {
  const relPath = "pai-hooks";
  const zshrcPath = join(deps.homeDir, ".zshrc");

  if (!deps.fileExists(zshrcPath)) {
    deps.stderr("Warning: ~/.zshrc not found. Set the env var manually:");
    deps.stderr(`  export ${envVar}="$PAI_DIR/${relPath}"`);
    return;
  }

  const zshrcResult = deps.readFile(zshrcPath);
  if (!zshrcResult.ok) return;

  const updated = addToZshrc(zshrcResult.value!, envVar, relPath);
  deps.writeFile(zshrcPath, updated);
  deps.stdout(`Ensured ${envVar} in ~/.zshrc (uses $PAI_DIR/${relPath})`);
}

/**
 * CLI entry point: reads envVar from pai-hooks.json, then delegates to ensureEnvVar.
 */
export function run(deps: EnsureEnvDeps = defaultDeps): void {
  const repoRoot = resolve(import.meta.dir, "..");

  const manifestPath = join(repoRoot, "pai-hooks.json");
  if (!deps.fileExists(manifestPath)) {
    deps.stderr("Error: pai-hooks.json not found.");
    return;
  }
  const manifestResult = deps.readFile(manifestPath);
  if (!manifestResult.ok) return;
  const manifest = JSON.parse(manifestResult.value!);

  ensureEnvVar(manifest.envVar, deps);
}

if (import.meta.main) {
  run();
}
