/**
 * UpdateCounts.ts - Update MEMORY/STATE/counts.json with fresh system counts
 *
 * PURPOSE:
 * Updates counts.json at session start (background, non-blocking).
 * Banner and statusline then read from counts.json (instant, no execution).
 *
 * ARCHITECTURE:
 * SessionStart hook → spawns this as background process → MEMORY/STATE/counts.json
 * Statusline reads counts.json (instant)
 *
 * Runs as a standalone script via `bun handlers/UpdateCounts.ts`.
 */

import { join } from "node:path";
import { ensureDir, fileExists, readDir, readFile, stat, writeFile } from "@hooks/core/adapters/fs";
import { safeJsonParse } from "@hooks/core/adapters/json";
import { getPaiDir, getSettingsPath } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Counts {
  skills: number;
  hooks: number;
  signals: number;
  files: number;
  work: number;
  sessions: number;
  research: number;
  ratings: number;
  updatedAt: string;
}

interface UpdateCountsConfig {
  paiDir: string;
  settingsPath: string;
  stderr: (msg: string) => void;
}

// ─── Counting Functions ──────────────────────────────────────────────────────

function countFilesRecursive(dir: string, extension?: string): number {
  let count = 0;
  const entries = readDir(dir, { withFileTypes: true });
  if (!entries.ok) return 0;

  for (const entry of entries.value) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFilesRecursive(fullPath, extension);
    } else if (entry.isFile()) {
      if (!extension || entry.name.endsWith(extension)) {
        count++;
      }
    }
  }
  return count;
}

function countSkills(paiDir: string): number {
  let count = 0;
  const skillsDir = join(paiDir, "skills");
  const entries = readDir(skillsDir, { withFileTypes: true });
  if (!entries.ok) return 0;

  for (const entry of entries.value) {
    const entryPath = join(skillsDir, entry.name);
    const entryStat = stat(entryPath);
    const isDir =
      entry.isDirectory() ||
      (entry.isSymbolicLink() && entryStat.ok && entryStat.value.isDirectory());
    if (isDir) {
      const skillFile = join(skillsDir, entry.name, "SKILL.md");
      if (fileExists(skillFile)) {
        count++;
      }
    }
  }
  return count;
}

function countHooksFromSettings(settingsPath: string): number {
  const content = readFile(settingsPath);
  if (!content.ok) return 0;

  const parsed = safeJsonParse(content.value);
  if (!parsed.ok) return 0;
  if (typeof parsed.value !== "object" || parsed.value === null) return 0;
  const settings = parsed.value as Record<string, unknown>;
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return 0;

  // Structure: { EventName: [{ hooks: [{type, command}, ...] }, ...] }
  let count = 0;
  for (const eventGroups of Object.values(hooks as Record<string, unknown>)) {
    if (!Array.isArray(eventGroups)) continue;
    for (const group of eventGroups) {
      if (group && typeof group === "object" && "hooks" in group) {
        const innerHooks = (group as Record<string, unknown>).hooks;
        if (Array.isArray(innerHooks)) {
          count += innerHooks.length;
        }
      }
    }
  }
  return count;
}

function countRatingsLines(filePath: string): number {
  if (!fileExists(filePath)) return 0;
  const content = readFile(filePath);
  if (!content.ok) return 0;
  return content.value.split("\n").filter((l) => l.trim()).length;
}

function countSubdirs(dir: string): number {
  const entries = readDir(dir, { withFileTypes: true });
  if (!entries.ok) return 0;
  return entries.value.filter((e) => e.isDirectory()).length;
}

function getCounts(paiDir: string, settingsPath: string): Counts {
  const ratingsPath = join(paiDir, "MEMORY/LEARNING/SIGNALS/ratings.jsonl");
  return {
    skills: countSkills(paiDir),
    hooks: countHooksFromSettings(settingsPath),
    signals: countFilesRecursive(join(paiDir, "MEMORY/LEARNING"), ".md"),
    files: countFilesRecursive(join(paiDir, "PAI/USER")),
    work: countSubdirs(join(paiDir, "MEMORY/WORK")),
    sessions: countFilesRecursive(join(paiDir, "MEMORY"), ".jsonl"),
    research:
      countFilesRecursive(join(paiDir, "MEMORY/RESEARCH"), ".md") +
      countFilesRecursive(join(paiDir, "MEMORY/RESEARCH"), ".json"),
    ratings: countRatingsLines(ratingsPath),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

function run(config?: UpdateCountsConfig): void {
  const cfg: UpdateCountsConfig = config ?? {
    paiDir: getPaiDir(),
    settingsPath: getSettingsPath(),
    stderr: (msg) => process.stderr.write(`${msg}\n`),
  };

  const counts = getCounts(cfg.paiDir, cfg.settingsPath);

  const countsPath = join(cfg.paiDir, "MEMORY", "STATE", "counts.json");
  ensureDir(join(cfg.paiDir, "MEMORY", "STATE"));

  const writeResult = writeFile(countsPath, `${JSON.stringify(counts, null, 2)}\n`);
  if (!writeResult.ok) {
    cfg.stderr(`[UpdateCounts] Failed to write counts: ${writeResult.error.message}`);
    return;
  }

  cfg.stderr(
    `[UpdateCounts] Updated: SK:${counts.skills} HK:${counts.hooks} SIG:${counts.signals} F:${counts.files} W:${counts.work} SESS:${counts.sessions} RES:${counts.research} RAT:${counts.ratings}`,
  );
}

if (import.meta.main) {
  run();
}
