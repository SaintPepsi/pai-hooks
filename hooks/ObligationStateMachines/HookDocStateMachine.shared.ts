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

/** Get all doc file names (primary + additional). */
export function allDocFileNames(settings: HookDocEnforcerSettings): string[] {
  return [settings.docFileName, ...settings.additionalDocs.map((d) => d.fileName)];
}

/** Tag a source path with the doc file it owes. */
export function tagPending(sourcePath: string, docFileName: string): string {
  return `${sourcePath}:${docFileName}`;
}

/** Parse a tagged pending entry back to source path and doc file name. */
export function parseTag(entry: string): { source: string; docFile: string } {
  const lastColon = entry.lastIndexOf(":");
  if (lastColon <= 0) {
    return { source: entry, docFile: "doc.md" };
  }
  const suffix = entry.slice(lastColon + 1);
  if (suffix.includes("/") || suffix.includes("\\") || !suffix.includes(".")) {
    return { source: entry, docFile: "doc.md" };
  }
  return { source: entry.slice(0, lastColon), docFile: suffix };
}

/** Check if a file path matches any doc file name (primary or additional). */
export function isAnyDocFile(filePath: string, settings: HookDocEnforcerSettings): boolean {
  return allDocFileNames(settings).some(
    (name) => filePath.endsWith(`/${name}`) || filePath === name,
  );
}

/** Extract the doc file name from a file path (e.g., "/hooks/G/H/IDEA.md" → "IDEA.md"). */
export function docFileNameFromPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
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
  const lines: string[] = [];

  // Group by directory → doc files owed
  const byDir = new Map<string, Set<string>>();
  for (const entry of pendingFiles) {
    const { source, docFile } = parseTag(entry);
    const dir = getHookDirFromPath(source);
    if (!byDir.has(dir)) byDir.set(dir, new Set());
    byDir.get(dir)!.add(docFile);
  }

  for (const [dir, docFiles] of byDir) {
    for (const docFile of docFiles) {
      lines.push(`Update \`${dir}/${docFile}\``);
    }
  }

  // Show required sections per doc type that appears in pending
  const allDocs = [
    { fileName: settings.docFileName, requiredSections: settings.requiredSections },
    ...settings.additionalDocs,
  ];

  const mentionedDocs = new Set(pendingFiles.map((e) => parseTag(e).docFile));

  for (const doc of allDocs) {
    if (!mentionedDocs.has(doc.fileName)) continue;
    if (doc.requiredSections.length === 0) continue;
    lines.push("");
    lines.push(`Required sections in \`${doc.fileName}\`:`);
    for (const section of doc.requiredSections) {
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
