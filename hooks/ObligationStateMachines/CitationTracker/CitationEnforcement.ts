/**
 * CitationEnforcement — Two cooperating contracts for citation awareness.
 *
 * CitationTracker (PostToolUse): Writes a flag file when research tools
 * (WebSearch, WebFetch, Research skill) are used. Flag persists across
 * hook invocations via filesystem.
 *
 * CitationEnforcement (PostToolUse): After Write/Edit, if the research
 * flag file exists, injects a one-time citation reminder per file path.
 * Zero context cost when no research has occurred.
 */

import { join } from "node:path";
import { fileExists as fsFileExists, readFile, writeFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getFilePath } from "@hooks/lib/tool-input";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import { pickNarrative } from "@hooks/lib/narrative-reader";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CitationEnforcementDeps {
  stateDir: string;
  fileExists: (path: string) => boolean;
  writeFlag: (path: string) => void;
  readReminded: (path: string) => string[];
  writeReminded: (path: string, files: string[]) => void;
  stderr: (msg: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RESEARCH_TOOLS = new Set(["WebSearch", "WebFetch"]);

function isResearchSkill(input: ToolHookInput): boolean {
  if (input.tool_name !== "Skill") return false;
  const toolInput = input.tool_input;
  if (typeof toolInput !== "object" || toolInput === null) return false;
  return (toolInput as Record<string, unknown>).skill === "Research";
}

function flagPath(stateDir: string): string {
  return join(stateDir, "research-active");
}

function remindedPath(stateDir: string): string {
  return join(stateDir, "citation-reminded.json");
}

// ─── Default Deps ────────────────────────────────────────────────────────────

function getStateDir(): string {
  const paiDir = process.env.PAI_DIR || join(process.env.HOME!, ".claude");
  return join(paiDir, "MEMORY", "STATE", "citation");
}

const defaultDeps: CitationEnforcementDeps = {
  stateDir: getStateDir(),
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

// ─── Contract 1: CitationTracker ─────────────────────────────────────────────

export const CitationTracker: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  CitationEnforcementDeps
> = {
  name: "CitationTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (RESEARCH_TOOLS.has(input.tool_name)) return true;
    if (isResearchSkill(input)) return true;
    return false;
  },

  execute(_input: ToolHookInput, deps: CitationEnforcementDeps): Result<ContinueOutput, PaiError> {
    const flag = flagPath(deps.stateDir);
    deps.writeFlag(flag);
    deps.stderr("[CitationTracker] Research tool detected — citation enforcement active");
    return ok({ type: "continue", continue: true });
  },

  defaultDeps,
};

// ─── Contract 2: CitationEnforcement ─────────────────────────────────────────

function buildCitationReminder(): string {
  const opener = pickNarrative("CitationEnforcement", 1, join(import.meta.dir, "../CitationEnforcement"));
  return [
    opener,
    "Ensure every factual claim in your written content includes a citation:",
    "  - URLs for web sources",
    "  - File paths for codebase facts",
    "  - Documentation section names for framework claims",
    "'According to X' is not a citation. A citation is a link the user can follow.",
  ].join("\n");
}

export const CitationEnforcement: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  CitationEnforcementDeps
> = {
  name: "CitationEnforcement",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Write" || input.tool_name === "Edit";
  },

  execute(input: ToolHookInput, deps: CitationEnforcementDeps): Result<ContinueOutput, PaiError> {
    const flag = flagPath(deps.stateDir);
    if (!deps.fileExists(flag)) {
      return ok({ type: "continue", continue: true });
    }

    const filePath = getFilePath(input);
    if (!filePath) {
      return ok({ type: "continue", continue: true });
    }

    const reminded = deps.readReminded(remindedPath(deps.stateDir));
    if (reminded.includes(filePath)) {
      return ok({ type: "continue", continue: true });
    }

    reminded.push(filePath);
    deps.writeReminded(remindedPath(deps.stateDir), reminded);
    deps.stderr(`[CitationEnforcement] Injecting citation reminder for ${filePath}`);

    return ok({
      type: "continue",
      continue: true,
      additionalContext: buildCitationReminder(),
    });
  },

  defaultDeps,
};
