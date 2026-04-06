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

import { dirname } from "node:path";
import { readHookConfig } from "@hooks/lib/hook-config";
import type { ObligationConfig, ObligationDeps } from "@hooks/lib/obligation-machine";
import {
  createDefaultDeps,
  blockCountPath as genericBlockCountPath,
  pendingPath as genericPendingPath,
} from "@hooks/lib/obligation-machine";

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

export interface AdditionalDoc {
  fileName: string;
  requiredSections: string[];
}

export interface HookDocEnforcerSettings {
  enabled: boolean;
  blocking: boolean;
  requiredSections: string[];
  docFileName: string;
  watchPatterns: RegExp[];
  additionalDocs: AdditionalDoc[];
  mode: "independent" | "linked";
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
  /shared\.ts$/,
  /README\.md$/,
];

function defaults(): HookDocEnforcerSettings {
  return {
    enabled: true,
    blocking: true,
    requiredSections: [...DEFAULT_REQUIRED_SECTIONS],
    docFileName: "doc.md",
    watchPatterns: [...DEFAULT_WATCH_PATTERNS],
    additionalDocs: [],
    mode: "independent",
  };
}

// ─── Settings Reader ──────────────────────────────────────────────────────────

export function readHookDocSettings(
  readFileFn?: (path: string) => string | null,
  settingsPath?: string,
): HookDocEnforcerSettings {
  const cfg = readHookConfig<Record<string, unknown>>(
    "hookDocEnforcer",
    readFileFn ?? undefined,
    settingsPath,
  );
  if (!cfg) return defaults();

  return {
    enabled: cfg.enabled !== false,
    blocking: cfg.blocking !== false,
    requiredSections: Array.isArray(cfg.requiredSections)
      ? cfg.requiredSections
      : [...DEFAULT_REQUIRED_SECTIONS],
    docFileName: typeof cfg.docFileName === "string" ? cfg.docFileName : "doc.md",
    watchPatterns: Array.isArray(cfg.watchPatterns)
      ? cfg.watchPatterns.map((p: string) => new RegExp(p))
      : [...DEFAULT_WATCH_PATTERNS],
    additionalDocs: Array.isArray(cfg.additionalDocs)
      ? (cfg.additionalDocs as Array<{ fileName?: unknown; requiredSections?: unknown }>)
          .filter((d) => typeof d.fileName === "string")
          .map((d) => ({
            fileName: d.fileName as string,
            requiredSections: Array.isArray(d.requiredSections)
              ? (d.requiredSections as string[])
              : [],
          }))
      : [],
    mode: cfg.mode === "linked" ? ("linked" as const) : ("independent" as const),
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

  return `${lines.join("\n")}\n`;
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
