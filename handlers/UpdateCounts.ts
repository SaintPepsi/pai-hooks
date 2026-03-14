/**
 * UpdateCounts.ts - Update settings.json with fresh system counts
 *
 * PURPOSE:
 * Updates the counts section of settings.json at the end of each session.
 * Banner and statusline then read from settings.json (instant, no execution).
 *
 * ARCHITECTURE:
 * SessionEnd hook → spawns this as background process → settings.json
 * Session start → Banner reads settings.json (instant)
 *
 * Runs as a standalone script via `bun handlers/UpdateCounts.ts`.
 * Usage cache refresh is handled by the statusline independently.
 */

import { readFile, writeFile, readDir, fileExists, stat } from "@hooks/core/adapters/fs";
import { getPaiDir, getSettingsPath } from "@hooks/lib/paths";
import { join } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Counts {
  skills: number;
  workflows: number;
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

function countWorkflowFiles(dir: string): number {
  let count = 0;
  const entries = readDir(dir, { withFileTypes: true });
  if (!entries.ok) return 0;

  for (const entry of entries.value) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase() === "workflows") {
        count += countFilesRecursive(fullPath, ".md");
      } else {
        count += countWorkflowFiles(fullPath);
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

function countHooks(paiDir: string): number {
  let count = 0;
  const hooksDir = join(paiDir, "pai-hooks", "hooks");
  const entries = readDir(hooksDir, { withFileTypes: true });
  if (!entries.ok) return 0;

  for (const entry of entries.value) {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      count++;
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

function getCounts(paiDir: string): Counts {
  const ratingsPath = join(paiDir, "MEMORY/LEARNING/SIGNALS/ratings.jsonl");
  return {
    skills: countSkills(paiDir),
    workflows: countWorkflowFiles(join(paiDir, "skills")),
    hooks: countHooks(paiDir),
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
    stderr: (msg) => process.stderr.write(msg + "\n"),
  };

  const counts = getCounts(cfg.paiDir);

  const settingsContent = readFile(cfg.settingsPath);
  if (!settingsContent.ok) {
    cfg.stderr(`[UpdateCounts] Failed to read settings: ${settingsContent.error.message}`);
    return;
  }

  const settings = JSON.parse(settingsContent.value) as Record<string, unknown>;
  settings.counts = counts;

  const writeResult = writeFile(cfg.settingsPath, JSON.stringify(settings, null, 2) + "\n");
  if (!writeResult.ok) {
    cfg.stderr(`[UpdateCounts] Failed to write settings: ${writeResult.error.message}`);
    return;
  }

  cfg.stderr(
    `[UpdateCounts] Updated: SK:${counts.skills} WF:${counts.workflows} HK:${counts.hooks} SIG:${counts.signals} F:${counts.files} W:${counts.work} SESS:${counts.sessions} RES:${counts.research} RAT:${counts.ratings}`,
  );
}

if (import.meta.main) {
  run();
}
