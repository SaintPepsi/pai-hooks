/**
 * Narrative Reader — Picks severity-tiered agent perspective messages for hooks.
 *
 * Reads from {hookDir}/{HookName}.narrative.jsonl, where hookDir is the
 * directory of the hook contract (pass import.meta.dir from the call site).
 * Each line: {"message": "...", "score": 1|2|3}
 * Score maps to violation severity: 1 = gentle (1-2), 2 = direct (3-5), 3 = firm (6+).
 */

import { join } from "node:path";
import {
  fileExists as adapterFileExists,
  readFile as adapterReadFile,
} from "@hooks/core/adapters/fs";
import { tryCatch } from "@hooks/core/result";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NarrativeEntry {
  message: string;
  score: number;
}

export interface NarrativeReaderDeps {
  readFile: (path: string) => string | null;
  fileExists: (path: string) => boolean;
  stderr: (msg: string) => void;
}

// ─── Pure Functions ──────────────────────────────────────────────────────────

const DEFAULT_MESSAGE = "I need to fix some issues in this file before continuing.";

export function scoreFromCount(count: number): number {
  if (count <= 0) return 2;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  return 3;
}

function parseEntries(content: string): NarrativeEntry[] {
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      const result = tryCatch(
        () => JSON.parse(line) as Record<string, unknown>,
        () => null,
      );
      if (!result.ok) return [];
      const parsed = result.value;
      const entry = {
        message: String(parsed.message),
        score: Number(parsed.score),
      };
      return entry.message && [1, 2, 3].includes(entry.score) ? [entry] : [];
    });
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// ─── Main Export ─────────────────────────────────────────────────────────────

const defaultDeps: NarrativeReaderDeps = {
  readFile: (path: string) => {
    const result = adapterReadFile(path);
    return result.ok ? result.value : null;
  },
  fileExists: adapterFileExists,
  stderr: (msg) => process.stderr.write(`${msg}\n`),
};

export function pickNarrative(
  hookName: string,
  violationCount: number,
  hookDir: string,
  deps: NarrativeReaderDeps = defaultDeps,
): string {
  const filePath = join(hookDir, `${hookName}.narrative.jsonl`);

  if (!deps.fileExists(filePath)) return DEFAULT_MESSAGE;

  const content = deps.readFile(filePath);
  if (!content?.trim()) return DEFAULT_MESSAGE;

  const entries = parseEntries(content);
  if (entries.length === 0) return DEFAULT_MESSAGE;

  const targetScore = scoreFromCount(violationCount);
  const matching = entries.filter((e) => e.score === targetScore);

  if (matching.length > 0) return pickRandom(matching).message;
  return pickRandom(entries).message;
}
