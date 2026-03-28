/**
 * HookDocStateMachine — Domain logic for hook documentation enforcement.
 *
 * Builds on the generic ObligationMachine for state management.
 * Adds: settings reader (hookConfig.hookDocEnforcer), file classification,
 * section validation, and suggestion builder.
 *
 * Configuration via ~/.claude/settings.json:
 *   hookConfig.hookDocEnforcer.enabled       — enable/disable (default: true)
 *   hookConfig.hookDocEnforcer.blocking      — block or warn (default: true)
 *   hookConfig.hookDocEnforcer.requiredSections — headings to enforce
 *   hookConfig.hookDocEnforcer.docFileName   — doc file name (default: "doc.md")
 *   hookConfig.hookDocEnforcer.watchPatterns  — regex strings for watched files
 */

import type { ObligationConfig } from "@hooks/lib/obligation-machine";
import { createDefaultDeps, pendingPath as genericPendingPath, blockCountPath as genericBlockCountPath } from "@hooks/lib/obligation-machine";
import type { ObligationDeps } from "@hooks/lib/obligation-machine";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { readFile } from "@hooks/core/adapters/fs";
import { tryCatch } from "@hooks/core/result";
import { jsonParseFailed } from "@hooks/core/error";
import { getSettingsPath } from "@hooks/lib/paths";
import { dirname } from "path";

// ─── Re-export generic deps type for contracts ───────────────────────────────

export type HookDocDeps = ObligationDeps;

// ─── Obligation Config ────────────────────────────────────────────────────────

export const HOOK_DOC_CONFIG: ObligationConfig = {
  name: "HookDoc",
  stateSubdir: "hook-doc-obligation",
  pendingPrefix: "hookdoc-pending",
  blockCountPrefix: "hookdoc-block-count",
  maxBlocks: 1,
};

// ─── Settings Types ───────────────────────────────────────────────────────────

export interface HookDocEnforcerSettings {
  enabled: boolean;
  blocking: boolean;
  requiredSections: string[];
  docFileName: string;
  watchPatterns: RegExp[];
}

interface SettingsJson {
  hookConfig?: {
    hookDocEnforcer?: {
      enabled?: boolean;
      blocking?: boolean;
      requiredSections?: string[];
      docFileName?: string;
      watchPatterns?: string[];
    };
  };
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_REQUIRED_SECTIONS = [
  "## Overview",
  "## Event",
  "## When It Fires",
  "## What It Does",
  "## Examples",
  "## Dependencies",
];

const DEFAULT_WATCH_PATTERNS = [
  /\.contract\.ts$/,
  /hook\.json$/,
  /group\.json$/,
];

function defaults(): HookDocEnforcerSettings {
  return {
    enabled: true,
    blocking: true,
    requiredSections: [...DEFAULT_REQUIRED_SECTIONS],
    docFileName: "doc.md",
    watchPatterns: [...DEFAULT_WATCH_PATTERNS],
  };
}

// ─── Settings Reader ──────────────────────────────────────────────────────────

export function readHookDocSettings(
  readFileFn?: (path: string) => string | null,
  settingsPath?: string,
): HookDocEnforcerSettings {
  const path = settingsPath ?? getSettingsPath();
  const reader = readFileFn ?? ((p: string) => {
    const r = readFile(p);
    return r.ok ? r.value : null;
  });
  const raw = reader(path);
  if (!raw) return defaults();

  const parseResult = tryCatch(
    () => JSON.parse(raw) as SettingsJson,
    (cause) => jsonParseFailed(raw.slice(0, 100), cause),
  );
  if (!parseResult.ok) return defaults();

  const cfg = parseResult.value?.hookConfig?.hookDocEnforcer;
  if (!cfg || typeof cfg !== "object") return defaults();

  return {
    enabled: cfg.enabled !== false,
    blocking: cfg.blocking !== false,
    requiredSections: Array.isArray(cfg.requiredSections) ? cfg.requiredSections : [...DEFAULT_REQUIRED_SECTIONS],
    docFileName: typeof cfg.docFileName === "string" ? cfg.docFileName : "doc.md",
    watchPatterns: Array.isArray(cfg.watchPatterns)
      ? cfg.watchPatterns.map((p: string) => new RegExp(p))
      : [...DEFAULT_WATCH_PATTERNS],
  };
}

// ─── Domain Helpers ───────────────────────────────────────────────────────────

/** Check if a file path matches any of the watched patterns (hook source files). */
export function isHookSourceFile(filePath: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(filePath));
}

/** Check if a file path is a hook documentation file. */
export function isHookDocFile(filePath: string, docFileName: string): boolean {
  return filePath.endsWith(`/${docFileName}`) || filePath === docFileName;
}

/** Extract the parent directory from a file path. */
export function getHookDirFromPath(filePath: string): string {
  return dirname(filePath);
}

/** Extract file_path from a tool hook input. */
export function getFilePath(input: ToolHookInput): string | null {
  if (typeof input.tool_input !== "object" || input.tool_input === null) return null;
  return ((input.tool_input as Record<string, unknown>).file_path as string) ?? null;
}

// ─── Section Validation ───────────────────────────────────────────────────────

/** Validate that a doc file contains all required section headings. */
export function validateDocSections(
  content: string,
  requiredSections: string[],
): { valid: boolean; missing: string[] } {
  const missing = requiredSections.filter((section) => !content.includes(section));
  return { valid: missing.length === 0, missing };
}

/** Build a suggestion string telling Claude what sections to add. */
export function buildDocSuggestions(
  pendingFiles: string[],
  settings: HookDocEnforcerSettings,
): string {
  const hookDirs = [...new Set(pendingFiles.map(getHookDirFromPath))];
  const lines: string[] = [];

  for (const dir of hookDirs) {
    lines.push(`Create or update \`${dir}/${settings.docFileName}\``);
  }

  if (settings.requiredSections.length > 0) {
    lines.push("");
    lines.push(`Required sections in \`${settings.docFileName}\`:`);
    for (const section of settings.requiredSections) {
      lines.push(`  - ${section}`);
    }
  }

  return lines.join("\n") + "\n";
}

// ─── Path Helpers (convenience wrappers) ──────────────────────────────────────

export function pendingPath(stateDir: string, sessionId: string): string {
  return genericPendingPath(stateDir, HOOK_DOC_CONFIG.pendingPrefix, sessionId);
}

export function blockCountPath(stateDir: string, sessionId: string): string {
  return genericBlockCountPath(stateDir, HOOK_DOC_CONFIG.blockCountPrefix, sessionId);
}

// ─── Default Deps ─────────────────────────────────────────────────────────────

export const defaultDeps: HookDocDeps = createDefaultDeps(HOOK_DOC_CONFIG);
