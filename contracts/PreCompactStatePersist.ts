/**
 * PreCompactStatePersist Contract — Persist active PRD state before context compaction.
 *
 * Fires on PreCompact. Finds the most recently modified PRD.md under MEMORY/WORK/,
 * reads its frontmatter, and returns an additionalContext summary so the AI retains
 * task/phase/progress awareness after the compaction window resets.
 *
 * Always returns continue — never blocks compaction.
 * Fails open: any read error yields continue with no context.
 */

import type { HookContract } from "@hooks/core/contract";
import type { PreCompactInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { readFile, readDir, stat } from "@hooks/core/adapters/fs";
import { join } from "path";
import { homedir } from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PreCompactStatePersistDeps {
  readDir: (path: string, opts?: { withFileTypes: true }) => Result<unknown[], PaiError>;
  readFile: (path: string) => Result<string, PaiError>;
  stat: (path: string) => Result<{ mtimeMs: number }, PaiError>;
  stderr: (msg: string) => void;
  baseDir: string;
}

export interface PRDState {
  task: string;
  phase: string;
  progress: string;
  slug: string;
}

// ─── Dirent Shape ────────────────────────────────────────────────────────────

interface DirentLike {
  name: string;
  isDirectory(): boolean;
}

function isDirentLike(entry: unknown): entry is DirentLike {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "name" in entry &&
    "isDirectory" in entry &&
    typeof (entry as DirentLike).isDirectory === "function"
  );
}

// ─── Frontmatter Parsing ─────────────────────────────────────────────────────

/**
 * Parse simple YAML frontmatter from between the first pair of --- markers.
 * Handles only scalar string values — no arrays, no nested keys.
 * Returns null if no valid frontmatter block is found.
 */
export function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const block = match[1];
  const result: Record<string, string> = {};

  for (const line of block.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}

// ─── PRD Discovery ───────────────────────────────────────────────────────────

/**
 * Walk MEMORY/WORK/ subdirectories and return the path of the most recently
 * modified PRD.md. Returns null if none found or on any read error.
 */
export function findMostRecentPrd(
  workDir: string,
  deps: Pick<PreCompactStatePersistDeps, "readDir" | "stat" | "stderr">,
): string | null {
  const dirsResult = deps.readDir(workDir, { withFileTypes: true });
  if (!dirsResult.ok) {
    deps.stderr(`[PreCompactStatePersist] Cannot read WORK dir: ${dirsResult.error.message}`);
    return null;
  }

  let bestPath: string | null = null;
  let bestMtime = 0;

  for (const entry of dirsResult.value) {
    if (!isDirentLike(entry)) continue;
    if (!entry.isDirectory()) continue;

    const prdPath = join(workDir, entry.name, "PRD.md");
    const statResult = deps.stat(prdPath);

    if (!statResult.ok) continue;

    if (statResult.value.mtimeMs > bestMtime) {
      bestMtime = statResult.value.mtimeMs;
      bestPath = prdPath;
    }
  }

  return bestPath;
}

// ─── Summary Builder ─────────────────────────────────────────────────────────

export function buildContextSummary(state: PRDState): string {
  return [
    "[PreCompact] Active PRD state persisted before compaction:",
    `  Task:     ${state.task}`,
    `  Slug:     ${state.slug}`,
    `  Phase:    ${state.phase}`,
    `  Progress: ${state.progress}`,
  ].join("\n");
}

// ─── Contract ────────────────────────────────────────────────────────────────

const BASE_DIR = process.env.PAI_DIR || join(homedir(), ".claude");

const defaultDeps: PreCompactStatePersistDeps = {
  readDir,
  readFile,
  stat,
  stderr: (msg) => process.stderr.write(msg + "\n"),
  baseDir: BASE_DIR,
};

const CONTINUE_SILENT: ContinueOutput = { type: "continue", continue: true };

export const PreCompactStatePersist: HookContract<
  PreCompactInput,
  ContinueOutput,
  PreCompactStatePersistDeps
> = {
  name: "PreCompactStatePersist",
  event: "PreCompact",

  accepts(_input: PreCompactInput): boolean {
    return true;
  },

  execute(
    _input: PreCompactInput,
    deps: PreCompactStatePersistDeps,
  ): Result<ContinueOutput, PaiError> {
    const workDir = join(deps.baseDir, "MEMORY", "WORK");

    const prdPath = findMostRecentPrd(workDir, deps);
    if (!prdPath) {
      deps.stderr("[PreCompactStatePersist] No PRD.md found — skipping context injection");
      return ok(CONTINUE_SILENT);
    }

    const readResult = deps.readFile(prdPath);
    if (!readResult.ok) {
      deps.stderr(`[PreCompactStatePersist] Failed to read PRD: ${readResult.error.message}`);
      return ok(CONTINUE_SILENT);
    }

    const fm = parseFrontmatter(readResult.value);
    if (!fm) {
      deps.stderr(`[PreCompactStatePersist] No frontmatter in: ${prdPath}`);
      return ok(CONTINUE_SILENT);
    }

    const task = fm["task"] ?? "";
    const phase = fm["phase"] ?? "";
    const progress = fm["progress"] ?? "";
    const slug = fm["slug"] ?? "";

    if (!task && !slug) {
      deps.stderr("[PreCompactStatePersist] Frontmatter missing task and slug — skipping");
      return ok(CONTINUE_SILENT);
    }

    const state: PRDState = { task, phase, progress, slug };
    const summary = buildContextSummary(state);

    deps.stderr(`[PreCompactStatePersist] Injecting PRD context: slug=${slug} phase=${phase}`);

    return ok({ type: "continue", continue: true, additionalContext: summary });
  },

  defaultDeps,
};
