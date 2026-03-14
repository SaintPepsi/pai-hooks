/**
 * Narrative Reader — Picks severity-tiered agent perspective messages for hooks.
 *
 * Reads from pai-hooks/narrative/{HookName}.narrative.jsonl.
 * Each line: {"message": "...", "score": 1|2|3}
 * Score maps to violation severity: 1 = gentle (1-2), 2 = direct (3-5), 3 = firm (6+).
 */

import { readFile as adapterReadFile, fileExists as adapterFileExists } from "@hooks/core/adapters/fs";
import { join } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NarrativeEntry {
  message: string;
  score: number;
}

export interface NarrativeReaderDeps {
  readFile: (path: string) => string | null;
  fileExists: (path: string) => boolean;
  baseDir: string;
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
    .filter(line => line.trim().length > 0)
    .map(line => {
      const parsed = JSON.parse(line);
      return { message: String(parsed.message), score: Number(parsed.score) };
    })
    .filter(e => e.message && [1, 2, 3].includes(e.score));
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
  baseDir: process.env.PAI_DIR || join(process.env.HOME!, ".claude"),
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export function pickNarrative(
  hookName: string,
  violationCount: number,
  deps: NarrativeReaderDeps = defaultDeps,
): string {
  const filePath = join(deps.baseDir, "pai-hooks", "narrative", `${hookName}.narrative.jsonl`);

  if (!deps.fileExists(filePath)) return DEFAULT_MESSAGE;

  const content = deps.readFile(filePath);
  if (!content || !content.trim()) return DEFAULT_MESSAGE;

  const entries = parseEntries(content);
  if (entries.length === 0) return DEFAULT_MESSAGE;

  const targetScore = scoreFromCount(violationCount);
  const matching = entries.filter(e => e.score === targetScore);

  if (matching.length > 0) return pickRandom(matching).message;
  return pickRandom(entries).message;
}
