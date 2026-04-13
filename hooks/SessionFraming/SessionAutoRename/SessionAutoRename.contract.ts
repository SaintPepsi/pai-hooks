/**
 * SessionAutoRename Contract — Progressive session renaming from prompt content.
 *
 * UserPromptSubmit hook that extracts keywords from user prompts and builds a
 * running title for the session. Returns sessionTitle in hookSpecificOutput
 * when a rename is warranted. Tracks state in MEMORY/STATE per session and
 * marks converged once the title stabilises across N consecutive prompts.
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { ensureDir, fileExists, readJson, writeJson } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { UserPromptSubmitInput } from "@hooks/core/types/hook-inputs";
import { readHookConfig } from "@hooks/lib/hook-config";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionRenameState {
  promptCount: number;
  firstSeenAt: number;
  lastRenameAt: number;
  renameCount: number;
  titleHistory: string[];
  converged: boolean;
  customName: boolean;
  /** Accumulated keyword frequency map (serialised as object). */
  keywords: Record<string, number>;
}

interface SessionAutoRenameConfig {
  enabled?: boolean;
  intervalMinutes?: number;
  convergenceCount?: number;
}

export interface SessionAutoRenameDeps {
  fileExists: (path: string) => boolean;
  readJson: <T = unknown>(path: string) => Result<T, ResultError>;
  writeJson: (path: string, data: unknown) => Result<void, ResultError>;
  ensureDir: (path: string) => Result<void, ResultError>;
  readConfig: () => SessionAutoRenameConfig | null;
  now: () => number;
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MINUTES = 15;
const DEFAULT_CONVERGENCE_COUNT = 2;

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "up", "about", "into", "through", "is",
  "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might",
  "can", "this", "that", "these", "those", "i", "me", "my", "we", "our",
  "you", "your", "it", "its", "not", "no", "so", "if", "as", "just",
  "also", "then", "than", "very", "more", "some", "how", "what", "which",
  "who", "when", "where", "why", "all", "any", "each", "few", "most",
  "other", "own", "same", "such", "both", "only", "over", "under", "again",
  "here", "there", "once", "now", "please", "use", "make", "get", "let",
  "need", "want", "like", "look", "help", "add", "run", "check",
]);

// ─── Pure Logic ──────────────────────────────────────────────────────────────

export function getStatePath(sessionId: string, baseDir: string): string {
  return join(baseDir, "MEMORY", "STATE", `session-rename-${sessionId}.json`);
}

function emptyState(now: number): SessionRenameState {
  return {
    promptCount: 0,
    firstSeenAt: now,
    lastRenameAt: 0,
    renameCount: 0,
    titleHistory: [],
    converged: false,
    customName: false,
    keywords: {},
  };
}

export function extractKeywords(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

export function mergeKeywords(
  existing: Record<string, number>,
  newWords: string[],
): Record<string, number> {
  const updated = { ...existing };
  for (const word of newWords) {
    updated[word] = (updated[word] ?? 0) + 1;
  }
  return updated;
}

export function buildTitle(keywords: Record<string, number>): string | null {
  const sorted = Object.entries(keywords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  if (sorted.length === 0) return null;

  // Capitalise first letter of each word
  const words = sorted.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(" ");
}

export function isConverged(titleHistory: string[], convergenceCount: number): boolean {
  if (titleHistory.length < convergenceCount) return false;
  const recent = titleHistory.slice(-convergenceCount);
  return recent.every((t) => t === recent[0]);
}

export function shouldRename(
  state: SessionRenameState,
  config: SessionAutoRenameConfig,
  nowMs: number,
): boolean {
  if (state.converged) return false;
  // TODO: customName is always false — no integration sets it to true yet.
  // Future: detect manual renames via the host API and set customName: true in state.
  if (state.customName) return false;

  const intervalMs = (config.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES) * 60 * 1000;

  // Always rename on first prompt (lastRenameAt === 0)
  if (state.lastRenameAt === 0) return true;

  return nowMs - state.lastRenameAt >= intervalMs;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: SessionAutoRenameDeps = {
  fileExists,
  readJson,
  writeJson,
  ensureDir,
  readConfig: () => readHookConfig<SessionAutoRenameConfig>("sessionAutoRename"),
  now: () => Date.now(),
  baseDir: getPaiDir(),
  stderr: defaultStderr,
};

export const SessionAutoRename: SyncHookContract<UserPromptSubmitInput, SessionAutoRenameDeps> = {
  name: "SessionAutoRename",
  event: "UserPromptSubmit",

  accepts(_input: UserPromptSubmitInput): boolean {
    return true;
  },

  execute(
    input: UserPromptSubmitInput,
    deps: SessionAutoRenameDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const config = deps.readConfig() ?? {};

    // Respect enabled flag — default to true
    if (config.enabled === false) {
      return ok({ continue: true });
    }

    const sessionId = input.session_id;
    const statePath = getStatePath(sessionId, deps.baseDir);
    const nowMs = deps.now();

    // Load or create state
    let state: SessionRenameState;
    if (deps.fileExists(statePath)) {
      const loaded = deps.readJson<SessionRenameState>(statePath);
      state = loaded.ok ? loaded.value : emptyState(nowMs);
    } else {
      state = emptyState(nowMs);
    }

    // Extract keywords from this prompt
    const prompt = input.prompt || input.user_prompt || "";
    const newWords = extractKeywords(prompt);

    // Update state
    state.promptCount += 1;
    state.keywords = mergeKeywords(state.keywords, newWords);

    const shouldDoRename = shouldRename(state, config, nowMs);

    let sessionTitle: string | undefined;

    if (shouldDoRename) {
      const title = buildTitle(state.keywords);
      if (title) {
        sessionTitle = title;
        state.lastRenameAt = nowMs;
        state.renameCount += 1;
        state.titleHistory = [...state.titleHistory, title];

        const convergenceCount = config.convergenceCount ?? DEFAULT_CONVERGENCE_COUNT;
        if (isConverged(state.titleHistory, convergenceCount)) {
          state.converged = true;
          deps.stderr(`[SessionAutoRename] Converged on title: "${title}"`);
        } else {
          deps.stderr(`[SessionAutoRename] Renamed to: "${title}"`);
        }
      }
    }

    // Persist state
    const stateDir = join(deps.baseDir, "MEMORY", "STATE");
    const dirResult = deps.ensureDir(stateDir);
    if (!dirResult.ok) {
      deps.stderr(`[SessionAutoRename] Failed to ensure state directory: ${dirResult.error.message}`);
    }
    const writeResult = deps.writeJson(statePath, state);
    if (!writeResult.ok) {
      deps.stderr(`[SessionAutoRename] Failed to save state: ${writeResult.error.message}`);
    }

    if (sessionTitle) {
      return ok({
        continue: true,
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          sessionTitle,
        },
      });
    }

    return ok({ continue: true });
  },

  defaultDeps,
};
