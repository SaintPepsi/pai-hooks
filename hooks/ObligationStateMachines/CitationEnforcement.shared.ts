/**
 * CitationEnforcement — Shared types, helpers, and default deps.
 * Used by both CitationTracker and CitationEnforcement.
 */

import { join } from "node:path";
import { fileExists as fsFileExists, readFile, writeFile } from "@hooks/core/adapters/fs";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getFilePath } from "@hooks/lib/tool-input";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CitationEnforcementDeps {
  stateDir: string;
  fileExists: (path: string) => boolean;
  writeFlag: (path: string) => void;
  readReminded: (path: string) => string[];
  writeReminded: (path: string, files: string[]) => void;
  stderr: (msg: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const RESEARCH_TOOLS = new Set(["WebSearch", "WebFetch"]);

export function isResearchSkill(input: ToolHookInput): boolean {
  if (input.tool_name !== "Skill") return false;
  const toolInput = input.tool_input;
  if (typeof toolInput !== "object" || toolInput === null) return false;
  return (toolInput as Record<string, unknown>).skill === "Research";
}

export function flagPath(stateDir: string): string {
  return join(stateDir, "research-active");
}

export function remindedPath(stateDir: string): string {
  return join(stateDir, "citation-reminded.json");
}

// ─── Default Deps ─────────────────────────────────────────────────────────────

function getStateDir(baseDir: string): string {
  return join(baseDir, "MEMORY", "STATE", "citation");
}

export const defaultDeps: CitationEnforcementDeps = {
  stateDir: getStateDir(process.env.PAI_DIR || join(process.env.HOME!, ".claude")),
  fileExists: (path: string) => fsFileExists(path),
  writeFlag: (path: string) => {
    writeFile(path, new Date().toISOString());
  },
  readReminded: (path: string) => {
    const result = readFile(path);
    if (!result.ok) return [];
    const parsed = JSON.parse(result.value);
    return Array.isArray(parsed) ? parsed : [];
  },
  writeReminded: (path: string, files: string[]) => {
    writeFile(path, JSON.stringify(files));
  },
  stderr: (msg) => process.stderr.write(`${msg}\n`),
};
