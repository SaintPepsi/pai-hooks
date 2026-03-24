/**
 * WorkCompletionLearning Contract — Capture learnings from completed work.
 *
 * Bridges WORK/ to LEARNING/. When a session ends with significant work,
 * creates a learning file with metadata and ISC for future reference.
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { join } from "path";
import { getISOTimestamp, getLocalDate } from "@hooks/lib/time";
import { getLearningCategory } from "@hooks/lib/learning-utils";
import { fileExists, readFile, readJson, writeFile, ensureDir } from "@hooks/core/adapters/fs";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CurrentWork {
  session_id: string;
  session_dir: string;
  current_task: string;
  task_title: string;
  task_count: number;
  created_at: string;
}

interface WorkMeta {
  title: string;
  created_at: string;
  completed_at: string | null;
  source: string;
  session_id: string;
  lineage?: {
    tools_used: string[];
    files_changed: string[];
    agents_spawned: string[];
  };
}

export interface WorkCompletionLearningDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, PaiError>;
  readJson: <T = unknown>(path: string) => Result<T, PaiError>;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  getTimestamp: () => string;
  getLocalDate: () => string;
  getLearningCategory: (title: string, context?: string) => "SYSTEM" | "ALGORITHM";
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── YAML Parser ─────────────────────────────────────────────────────────────

function parseYaml(content: string): WorkMeta {
  const meta: any = {};
  const lines = content.split("\n");
  let inArray = false;
  let arrayKey = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("- ") && inArray) {
      const value = trimmed.slice(2).replace(/^["']|["']$/g, "");
      if (arrayKey === "lineage") {
        const lastKey = Object.keys(meta.lineage).pop();
        if (lastKey) meta.lineage[lastKey].push(value);
      } else {
        meta[arrayKey].push(value);
      }
      continue;
    }

    const match = trimmed.match(/^([a-z_]+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;

      if (key === "lineage") {
        meta.lineage = { tools_used: [], files_changed: [], agents_spawned: [] };
        inArray = false;
        continue;
      }

      if (value === "[]") {
        if (meta.lineage) meta.lineage[key] = [];
        else meta[key] = [];
        inArray = false;
      } else if (value === "") {
        if (meta.lineage && ["tools_used", "files_changed", "agents_spawned"].includes(key)) {
          meta.lineage[key] = [];
          arrayKey = "lineage";
          inArray = true;
        } else {
          meta[key] = [];
          arrayKey = key;
          inArray = true;
        }
      } else {
        const cleanValue = value.replace(/^["']|["']$/g, "");
        if (meta.lineage && ["tools_used", "files_changed", "agents_spawned"].includes(key)) {
          meta.lineage[key] = cleanValue === "null" ? [] : [cleanValue];
        } else {
          meta[key] = cleanValue === "null" ? null : cleanValue;
        }
        inArray = false;
      }
    }
  }

  return meta as WorkMeta;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, ".claude");

const defaultDeps: WorkCompletionLearningDeps = {
  fileExists,
  readFile,
  readJson,
  writeFile,
  ensureDir,
  getTimestamp: getISOTimestamp,
  getLocalDate,
  getLearningCategory,
  baseDir: BASE_DIR,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const WorkCompletionLearning: SyncHookContract<
  SessionEndInput,
  SilentOutput,
  WorkCompletionLearningDeps
> = {
  name: "WorkCompletionLearning",
  event: "SessionEnd",

  accepts(_input: SessionEndInput): boolean {
    return true;
  },

  execute(
    input: SessionEndInput,
    deps: WorkCompletionLearningDeps,
  ): Result<SilentOutput, PaiError> {
    const stateDir = join(deps.baseDir, "MEMORY", "STATE");
    const workDir = join(deps.baseDir, "MEMORY", "WORK");
    const learningDir = join(deps.baseDir, "MEMORY", "LEARNING");

    // Find session-scoped state file (no legacy fallback — prevents cross-session bleed)
    let stateFile: string | null = null;
    if (input.session_id) {
      const scoped = join(stateDir, `current-work-${input.session_id}.json`);
      if (deps.fileExists(scoped)) stateFile = scoped;
    }
    if (!stateFile) {
      deps.stderr("[WorkCompletionLearning] No active work session");
      return ok({ type: "silent" });
    }

    const currentWorkResult = deps.readJson<CurrentWork>(stateFile);
    if (!currentWorkResult.ok) {
      deps.stderr("[WorkCompletionLearning] Failed to read state file");
      return ok({ type: "silent" });
    }
    const currentWork = currentWorkResult.value;

    if (input.session_id && currentWork.session_id !== input.session_id) {
      deps.stderr("[WorkCompletionLearning] State file belongs to different session, skipping");
      return ok({ type: "silent" });
    }

    if (!currentWork.session_dir) {
      deps.stderr("[WorkCompletionLearning] No work directory in current session");
      return ok({ type: "silent" });
    }

    const workPath = join(workDir, currentWork.session_dir);
    const metaPath = join(workPath, "META.yaml");
    const metaResult = deps.readFile(metaPath);
    if (!metaResult.ok) {
      deps.stderr("[WorkCompletionLearning] No META.yaml found");
      return ok({ type: "silent" });
    }
    const metaContent = metaResult.value;
    const workMeta = parseYaml(metaContent);
    if (!workMeta.completed_at) workMeta.completed_at = deps.getTimestamp();

    // Read ISC if available
    let idealContent = "";
    const iscPath = join(workPath, "ISC.json");
    const iscResult = deps.readJson<any>(iscPath);
    if (iscResult.ok) {
      const iscData = iscResult.value;
      if (iscData.current?.criteria?.length > 0) {
        idealContent = "**Criteria:**\n" + iscData.current.criteria.map((c: string) => `- ${c}`).join("\n");
      }
      if (iscData.current?.antiCriteria?.length > 0) {
        idealContent += "\n\n**Anti-Criteria:**\n" + iscData.current.antiCriteria.map((c: string) => `- ${c}`).join("\n");
      }
      if (iscData.satisfaction) {
        const s = iscData.satisfaction;
        idealContent += `\n\n**Satisfaction:** ${s.satisfied}/${s.total} satisfied, ${s.partial} partial, ${s.failed} failed`;
      }
    }

    // Check for significant work
    const hasSignificantWork =
      (workMeta.lineage?.files_changed?.length || 0) > 0 ||
      currentWork.task_count > 1 ||
      workMeta.source === "MANUAL";

    if (!hasSignificantWork) {
      deps.stderr("[WorkCompletionLearning] Trivial work session, skipping learning capture");
      return ok({ type: "silent" });
    }

    // Write learning file
    const category = deps.getLearningCategory(workMeta.title);
    const now = new Date();
    const monthDir = join(learningDir, category, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
    deps.ensureDir(monthDir);

    const dateStr = deps.getLocalDate();
    const timeStr = now.toISOString().split("T")[1].slice(0, 5).replace(":", "");
    const titleSlug = workMeta.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
    const filename = `${dateStr}_${timeStr}_work_${titleSlug}.md`;
    const filepath = join(monthDir, filename);

    if (deps.fileExists(filepath)) {
      deps.stderr(`[WorkCompletionLearning] Learning already exists: ${filename}`);
      return ok({ type: "silent" });
    }

    let duration = "Unknown";
    if (workMeta.created_at && workMeta.completed_at) {
      const minutes = Math.round(
        (new Date(workMeta.completed_at).getTime() - new Date(workMeta.created_at).getTime()) / 60000,
      );
      duration = minutes < 60 ? `${minutes} minutes` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    }

    const content = `# Work Completion Learning

**Title:** ${workMeta.title}
**Duration:** ${duration}
**Category:** ${category}
**Session:** ${workMeta.session_id}

---

## Ideal State Criteria

${idealContent || "Not specified"}

## What Was Done

- **Files Changed:** ${workMeta.lineage?.files_changed?.length || 0}
- **Tools Used:** ${workMeta.lineage?.tools_used?.join(", ") || "None tracked"}
- **Agents Spawned:** ${workMeta.lineage?.agents_spawned?.length || 0}

---

*Auto-captured by WorkCompletionLearning hook at session end*
`;

    const writeResult = deps.writeFile(filepath, content);
    if (!writeResult.ok) {
      deps.stderr(`[WorkCompletionLearning] Failed to write: ${writeResult.error.message}`);
      return ok({ type: "silent" });
    }
    deps.stderr(`[WorkCompletionLearning] Created learning: ${filename}`);

    return ok({ type: "silent" });
  },

  defaultDeps,
};
