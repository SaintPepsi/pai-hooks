/**
 * Centralized Path Resolution
 *
 * Handles environment variable expansion for portable PAI configuration.
 * Claude Code doesn't expand $HOME in settings.json env values, so we do it here.
 *
 * Usage:
 *   import { getPaiDir, getSettingsPath } from './lib/paths';
 *   const paiDir = getPaiDir(); // Always returns expanded absolute path
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { getEnv } from "@hooks/core/adapters/process";

/**
 * Expand shell variables in a path string
 * Supports: $HOME, ${HOME}, ~
 */
export function expandPath(path: string): string {
  const home = homedir();

  return path
    .replace(/^\$HOME(?=\/|$)/, home)
    .replace(/^\$\{HOME\}(?=\/|$)/, home)
    .replace(/^~(?=\/|$)/, home);
}

/**
 * Get the user's home directory.
 * Wraps node:os homedir() for dependency injection in contracts.
 * Throws if HOME is unset to prevent incorrect path resolution (#174).
 */
export function getHomeDir(): string {
  const home = homedir();
  if (!home) {
    throw new Error("HOME environment variable is not set — cannot resolve paths");
  }
  return home;
}

/**
 * Get the PAI directory (expanded)
 * Priority: PAI_DIR env var (expanded) → ~/.claude
 */
export function getPaiDir(): string {
  const envResult = getEnv("PAI_DIR");

  if (envResult.ok) {
    return expandPath(envResult.value);
  }

  return join(homedir(), ".claude");
}

/**
 * Factory function for defaultDeps.stderr — avoids inline process.stderr in every contract.
 */
export function defaultStderr(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

/**
 * Get the settings.json path
 */
export function getSettingsPath(): string {
  return join(getPaiDir(), "settings.json");
}

/**
 * Get a path relative to PAI_DIR
 */
export function paiPath(...segments: string[]): string {
  return join(getPaiDir(), ...segments);
}

/**
 * Get the hooks directory
 */
export function getHooksDir(): string {
  return paiPath("hooks");
}

/**
 * Get the skills directory
 */
export function getSkillsDir(): string {
  return paiPath("skills");
}

/**
 * Get the MEMORY directory
 */
export function getMemoryDir(): string {
  return paiPath("MEMORY");
}
