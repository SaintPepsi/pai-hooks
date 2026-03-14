/**
 * PRDSync Contract — Sync PRD.md frontmatter to MEMORY/STATE/work.json.
 *
 * On PostToolUse (Write/Edit), when a file matching MEMORY/WORK/**\/PRD.md is
 * written or edited, reads its YAML frontmatter and criteria checkboxes, then
 * upserts an entry in work.json keyed by slug.
 *
 * Read-only from the PRD's perspective — never modifies the PRD file.
 * Always returns ContinueOutput — never blocks the tool result.
 */

import type { HookContract } from "../core/contract";
import type { ToolHookInput } from "../core/types/hook-inputs";
import type { ContinueOutput } from "../core/types/hook-outputs";
import { ok, type Result } from "../core/result";
import type { PaiError } from "../core/error";
import {
  readFile,
  writeFile,
  fileExists,
  readJson,
} from "../core/adapters/fs";
import { join } from "path";
import { homedir } from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PRDFrontmatter {
  task?: string;
  slug?: string;
  effort?: string;
  phase?: string;
  progress?: string;
  mode?: string;
  started?: string;
  updated?: string;
}

export interface WorkEntry {
  task: string;
  phase: string;
  progress: string;
  effort: string;
  mode: string;
  started: string;
  updated: string;
  criteria_total: number;
  criteria_done: number;
}

export type WorkJson = Record<string, WorkEntry>;

export interface PRDSyncDeps {
  readFile: (path: string) => Result<string, PaiError>;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  fileExists: (path: string) => boolean;
  readJson: <T = unknown>(path: string) => Result<T, PaiError>;
  stderr: (msg: string) => void;
  baseDir: string;
}

// ─── Frontmatter Parsing ─────────────────────────────────────────────────────

/**
 * Parse simple YAML frontmatter from between the first pair of --- markers.
 * Handles only scalar string values — no arrays, no nested keys.
 * Returns null if no valid frontmatter block is found.
 */
export function parseFrontmatter(content: string): PRDFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const block = match[1];
  const result: PRDFrontmatter = {};

  for (const line of block.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes if present
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (!key || !value) continue;

    switch (key) {
      case "task":     result.task = value;     break;
      case "slug":     result.slug = value;     break;
      case "effort":   result.effort = value;   break;
      case "phase":    result.phase = value;    break;
      case "progress": result.progress = value; break;
      case "mode":     result.mode = value;     break;
      case "started":  result.started = value;  break;
      case "updated":  result.updated = value;  break;
    }
  }

  return result;
}

/**
 * Count criteria checkboxes in the document body.
 * Matches lines of the form: `- [x] ...` (done) or `- [ ] ...` (todo).
 */
export function parseCriteriaCounts(content: string): { total: number; done: number } {
  const checkedPattern = /^\s*-\s+\[x\]/gim;
  const uncheckedPattern = /^\s*-\s+\[ \]/gim;

  const done = (content.match(checkedPattern) ?? []).length;
  const todo = (content.match(uncheckedPattern) ?? []).length;

  return { total: done + todo, done };
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Read work.json, upsert the entry for the given slug, and write it back.
 * If work.json does not exist or is corrupt, starts fresh.
 */
function syncWorkJson(
  slug: string,
  entry: WorkEntry,
  workJsonPath: string,
  deps: PRDSyncDeps,
): Result<void, PaiError> {
  let existing: WorkJson = {};

  if (deps.fileExists(workJsonPath)) {
    const readResult = deps.readJson<WorkJson>(workJsonPath);
    if (readResult.ok) {
      existing = readResult.value;
    } else {
      deps.stderr(`[PRDSync] work.json unreadable, starting fresh: ${readResult.error.message}`);
    }
  }

  existing[slug] = entry;

  return deps.writeFile(workJsonPath, JSON.stringify(existing, null, 2));
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: PRDSyncDeps = {
  readFile,
  writeFile,
  fileExists,
  readJson,
  stderr: (msg) => process.stderr.write(msg + "\n"),
  baseDir: process.env.PAI_DIR || join(homedir(), ".claude"),
};

export const PRDSync: HookContract<
  ToolHookInput,
  ContinueOutput,
  PRDSyncDeps
> = {
  name: "PRDSync",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    const toolName = input.tool_name;
    if (toolName !== "Write" && toolName !== "Edit") return false;

    const filePath = (input.tool_input?.file_path as string) ?? "";
    return filePath.includes("MEMORY/WORK/") && filePath.endsWith("PRD.md");
  },

  execute(
    input: ToolHookInput,
    deps: PRDSyncDeps,
  ): Result<ContinueOutput, PaiError> {
    const filePath = (input.tool_input?.file_path as string) ?? "";

    if (!deps.fileExists(filePath)) {
      deps.stderr(`[PRDSync] PRD file not found on disk: ${filePath}`);
      return ok({ type: "continue", continue: true });
    }

    const readResult = deps.readFile(filePath);
    if (!readResult.ok) {
      deps.stderr(`[PRDSync] Failed to read PRD: ${readResult.error.message}`);
      return ok({ type: "continue", continue: true });
    }

    const content = readResult.value;
    const fm = parseFrontmatter(content);

    if (!fm) {
      deps.stderr(`[PRDSync] No frontmatter found in: ${filePath}`);
      return ok({ type: "continue", continue: true });
    }

    const slug = fm.slug;
    if (!slug) {
      deps.stderr(`[PRDSync] Frontmatter missing slug, skipping: ${filePath}`);
      return ok({ type: "continue", continue: true });
    }

    const { total, done } = parseCriteriaCounts(content);

    const entry: WorkEntry = {
      task:           fm.task     ?? "",
      phase:          fm.phase    ?? "",
      progress:       fm.progress ?? `${done}/${total}`,
      effort:         fm.effort   ?? "",
      mode:           fm.mode     ?? "",
      started:        fm.started  ?? "",
      updated:        fm.updated  ?? new Date().toISOString(),
      criteria_total: total,
      criteria_done:  done,
    };

    const workJsonPath = join(deps.baseDir, "MEMORY", "STATE", "work.json");
    const syncResult = syncWorkJson(slug, entry, workJsonPath, deps);

    if (!syncResult.ok) {
      deps.stderr(`[PRDSync] Failed to write work.json: ${syncResult.error.message}`);
    } else {
      deps.stderr(`[PRDSync] Synced ${slug} → phase=${entry.phase} progress=${entry.progress}`);
    }

    return ok({ type: "continue", continue: true });
  },

  defaultDeps,
};
