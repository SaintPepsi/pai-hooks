/**
 * PRDSync Contract — Sync PRD.md frontmatter to MEMORY/STATE/work.json.
 *
 * On PostToolUse (Write/Edit), when a file matching MEMORY/WORK/**\/PRD.md is
 * written or edited, reads its YAML frontmatter and criteria checkboxes, then
 * upserts an entry in work.json keyed by slug.
 *
 * Read-only from the PRD's perspective — never modifies the PRD file.
 * Always returns continue — never blocks the tool result.
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { fileExists, readFile, readJson, writeFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";

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
  readFile: (path: string) => Result<string, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  fileExists: (path: string) => boolean;
  readJson: <T = unknown>(path: string) => Result<T, ResultError>;
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
      case "task":
        result.task = value;
        break;
      case "slug":
        result.slug = value;
        break;
      case "effort":
        result.effort = value;
        break;
      case "phase":
        result.phase = value;
        break;
      case "progress":
        result.progress = value;
        break;
      case "mode":
        result.mode = value;
        break;
      case "started":
        result.started = value;
        break;
      case "updated":
        result.updated = value;
        break;
    }
  }

  return result;
}

/**
 * Count criteria checkboxes in the document body.
 * Matches lines of the form: `- [x] ...` (done) or `- [ ] ...` (todo).
 */
export function parseCriteriaCounts(content: string): {
  total: number;
  done: number;
} {
  const checkedPattern = /^\s*-\s+\[x\]/gim;
  const uncheckedPattern = /^\s*-\s+\[ \]/gim;

  const done = (content.match(checkedPattern) ?? []).length;
  const todo = (content.match(uncheckedPattern) ?? []).length;

  return { total: done + todo, done };
}

// ─── Session Dir Extraction ──────────────────────────────────────────────────

/**
 * Extract the first directory component after MEMORY/WORK/ from a PRD file path.
 * Returns null if the path doesn't contain MEMORY/WORK/ or has no directory after it.
 */
export function extractSessionDir(filePath: string): string | null {
  const marker = "MEMORY/WORK/";
  const idx = filePath.indexOf(marker);
  if (idx === -1) return null;

  const afterMarker = filePath.slice(idx + marker.length);
  const slashIdx = afterMarker.indexOf("/");
  if (slashIdx === -1) return null;

  const dirName = afterMarker.slice(0, slashIdx);
  return dirName || null;
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Update the session state file (current-work-{sessionId}.json) to point
 * to the correct session directory. Skips if no state file exists.
 */
function syncSessionState(
  sessionId: string,
  sessionDir: string,
  _prdPath: string,
  deps: PRDSyncDeps,
): void {
  const stateFilePath = join(deps.baseDir, "MEMORY", "STATE", `current-work-${sessionId}.json`);

  if (!deps.fileExists(stateFilePath)) {
    deps.stderr(`[PRDSync] No session state file for ${sessionId}, skipping session state sync`);
    return;
  }

  const readResult = deps.readJson<Record<string, unknown>>(stateFilePath);
  if (!readResult.ok) {
    deps.stderr(`[PRDSync] Failed to read session state: ${readResult.error.message}`);
    return;
  }

  const state = readResult.value;
  state.session_dir = sessionDir;

  const writeResult = deps.writeFile(stateFilePath, JSON.stringify(state, null, 2));
  if (!writeResult.ok) {
    deps.stderr(`[PRDSync] Failed to write session state: ${writeResult.error.message}`);
  } else {
    deps.stderr(`[PRDSync] Updated session state → session_dir=${sessionDir}`);
  }
}

/**
 * Read work.json, upsert the entry for the given slug, and write it back.
 * If work.json does not exist or is corrupt, starts fresh.
 */
function syncWorkJson(
  slug: string,
  entry: WorkEntry,
  workJsonPath: string,
  deps: PRDSyncDeps,
): Result<void, ResultError> {
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
  stderr: defaultStderr,
  baseDir: getPaiDir(),
};

export const PRDSync: SyncHookContract<ToolHookInput, PRDSyncDeps> = {
  name: "PRDSync",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    const toolName = input.tool_name;
    if (toolName !== "Write" && toolName !== "Edit") return false;

    const filePath = (input.tool_input?.file_path as string) ?? "";
    return filePath.includes("MEMORY/WORK/") && filePath.endsWith("PRD.md");
  },

  execute(input: ToolHookInput, deps: PRDSyncDeps): Result<SyncHookJSONOutput, ResultError> {
    const filePath = (input.tool_input?.file_path as string) ?? "";

    if (!deps.fileExists(filePath)) {
      deps.stderr(`[PRDSync] PRD file not found on disk: ${filePath}`);
      return ok({ continue: true });
    }

    const readResult = deps.readFile(filePath);
    if (!readResult.ok) {
      deps.stderr(`[PRDSync] Failed to read PRD: ${readResult.error.message}`);
      return ok({ continue: true });
    }

    const content = readResult.value;
    const fm = parseFrontmatter(content);

    if (!fm) {
      deps.stderr(`[PRDSync] No frontmatter found in: ${filePath}`);
      return ok({ continue: true });
    }

    const slug = fm.slug;
    if (!slug) {
      deps.stderr(`[PRDSync] Frontmatter missing slug, skipping: ${filePath}`);
      return ok({ continue: true });
    }

    const { total, done } = parseCriteriaCounts(content);

    const entry: WorkEntry = {
      task: fm.task ?? "",
      phase: fm.phase ?? "",
      progress: fm.progress ?? `${done}/${total}`,
      effort: fm.effort ?? "",
      mode: fm.mode ?? "",
      started: fm.started ?? "",
      updated: fm.updated ?? new Date().toISOString(),
      criteria_total: total,
      criteria_done: done,
    };

    const workJsonPath = join(deps.baseDir, "MEMORY", "STATE", "work.json");
    const syncResult = syncWorkJson(slug, entry, workJsonPath, deps);

    if (!syncResult.ok) {
      deps.stderr(`[PRDSync] Failed to write work.json: ${syncResult.error.message}`);
    } else {
      deps.stderr(`[PRDSync] Synced ${slug} → phase=${entry.phase} progress=${entry.progress}`);
    }

    // Sync session state file so downstream consumers (ArticleWriter, etc.)
    // can find the PRD via the correct session directory
    const sessionDir = extractSessionDir(filePath);
    if (sessionDir) {
      syncSessionState(input.session_id, sessionDir, filePath, deps);
    }

    return ok({ continue: true });
  },

  defaultDeps,
};
