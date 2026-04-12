/**
 * WorkCompletionLearning Contract — Capture learnings from completed work.
 *
 * Bridges WORK/ to LEARNING/. When a session ends with significant work,
 * creates a learning file with metadata and ISC for future reference.
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { ensureDir, fileExists, readFile, readJson, writeFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import { getLearningCategory } from "@hooks/lib/learning-utils";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";
import { getISOTimestamp, getLocalDate } from "@hooks/lib/time";

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
  readFile: (path: string) => Result<string, ResultError>;
  readJson: <T = unknown>(path: string) => Result<T, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  ensureDir: (path: string) => Result<void, ResultError>;
  getTimestamp: () => string;
  getLocalDate: () => string;
  getLearningCategory: (title: string, context?: string) => "SYSTEM" | "ALGORITHM";
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── YAML Parser ─────────────────────────────────────────────────────────────

type LineageKey = "tools_used" | "files_changed" | "agents_spawned";
const LINEAGE_KEYS: readonly string[] = ["tools_used", "files_changed", "agents_spawned"];

function parseYaml(content: string): WorkMeta {
  const fields: Record<string, string | string[] | null> = {};
  let lineage: Record<LineageKey, string[]> | undefined;
  const lines = content.split("\n");
  let inArray = false;
  let arrayKey = "";
  let arrayIsLineage = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("- ") && inArray) {
      const value = trimmed.slice(2).replace(/^["']|["']$/g, "");
      if (arrayIsLineage && lineage) {
        const lastKey = Object.keys(lineage).pop() as LineageKey | undefined;
        if (lastKey) lineage[lastKey].push(value);
      } else {
        const arr = fields[arrayKey];
        if (Array.isArray(arr)) arr.push(value);
      }
      continue;
    }

    const match = trimmed.match(/^([a-z_]+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;

      if (key === "lineage") {
        lineage = { tools_used: [], files_changed: [], agents_spawned: [] };
        inArray = false;
        continue;
      }

      if (value === "[]") {
        if (lineage && LINEAGE_KEYS.includes(key)) lineage[key as LineageKey] = [];
        else fields[key] = [];
        inArray = false;
      } else if (value === "") {
        if (lineage && LINEAGE_KEYS.includes(key)) {
          lineage[key as LineageKey] = [];
          arrayKey = key;
          arrayIsLineage = true;
          inArray = true;
        } else {
          fields[key] = [];
          arrayKey = key;
          arrayIsLineage = false;
          inArray = true;
        }
      } else {
        const cleanValue = value.replace(/^["']|["']$/g, "");
        if (lineage && LINEAGE_KEYS.includes(key)) {
          lineage[key as LineageKey] = cleanValue === "null" ? [] : [cleanValue];
        } else {
          fields[key] = cleanValue === "null" ? null : cleanValue;
        }
        inArray = false;
      }
    }
  }

  return {
    title: (fields.title as string) ?? "",
    created_at: (fields.created_at as string) ?? "",
    completed_at: (fields.completed_at as string | null) ?? null,
    source: (fields.source as string) ?? "",
    session_id: (fields.session_id as string) ?? "",
    ...(lineage ? { lineage } : {}),
  };
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: WorkCompletionLearningDeps = {
  fileExists,
  readFile,
  readJson,
  writeFile,
  ensureDir,
  getTimestamp: getISOTimestamp,
  getLocalDate,
  getLearningCategory,
  baseDir: getPaiDir(),
  stderr: defaultStderr,
};

export const WorkCompletionLearning: SyncHookContract<SessionEndInput, WorkCompletionLearningDeps> =
  {
    name: "WorkCompletionLearning",
    event: "SessionEnd",

    accepts(_input: SessionEndInput): boolean {
      return true;
    },

    execute(
      input: SessionEndInput,
      deps: WorkCompletionLearningDeps,
    ): Result<SyncHookJSONOutput, ResultError> {
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
        return ok({});
      }

      const currentWorkResult = deps.readJson<CurrentWork>(stateFile);
      if (!currentWorkResult.ok) {
        deps.stderr("[WorkCompletionLearning] Failed to read state file");
        return ok({});
      }
      const currentWork = currentWorkResult.value;

      if (input.session_id && currentWork.session_id !== input.session_id) {
        deps.stderr("[WorkCompletionLearning] State file belongs to different session, skipping");
        return ok({});
      }

      if (!currentWork.session_dir) {
        deps.stderr("[WorkCompletionLearning] No work directory in current session");
        return ok({});
      }

      const workPath = join(workDir, currentWork.session_dir);
      const metaPath = join(workPath, "META.yaml");
      const metaResult = deps.readFile(metaPath);
      if (!metaResult.ok) {
        deps.stderr("[WorkCompletionLearning] No META.yaml found");
        return ok({});
      }
      const metaContent = metaResult.value;
      const workMeta = parseYaml(metaContent);
      if (!workMeta.completed_at) workMeta.completed_at = deps.getTimestamp();

      // Read ISC if available
      let idealContent = "";
      const iscPath = join(workPath, "ISC.json");
      interface IscData {
        current?: { criteria?: string[]; antiCriteria?: string[] };
        satisfaction?: {
          satisfied: number;
          total: number;
          partial: number;
          failed: number;
        };
      }
      const iscResult = deps.readJson<IscData>(iscPath);
      if (iscResult.ok) {
        const iscData = iscResult.value;
        const criteria = iscData.current?.criteria;
        if (criteria && criteria.length > 0) {
          idealContent = `**Criteria:**\n${criteria.map((c: string) => `- ${c}`).join("\n")}`;
        }
        const antiCriteria = iscData.current?.antiCriteria;
        if (antiCriteria && antiCriteria.length > 0) {
          idealContent += `\n\n**Anti-Criteria:**\n${antiCriteria.map((c: string) => `- ${c}`).join("\n")}`;
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
        return ok({});
      }

      // Write learning file
      const category = deps.getLearningCategory(workMeta.title);
      const now = new Date();
      const monthDir = join(
        learningDir,
        category,
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
      );
      deps.ensureDir(monthDir);

      const dateStr = deps.getLocalDate();
      const timeStr = now.toISOString().split("T")[1].slice(0, 5).replace(":", "");
      const titleSlug = workMeta.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 30);
      const filename = `${dateStr}_${timeStr}_work_${titleSlug}.md`;
      const filepath = join(monthDir, filename);

      if (deps.fileExists(filepath)) {
        deps.stderr(`[WorkCompletionLearning] Learning already exists: ${filename}`);
        return ok({});
      }

      let duration = "Unknown";
      if (workMeta.created_at && workMeta.completed_at) {
        const minutes = Math.round(
          (new Date(workMeta.completed_at).getTime() - new Date(workMeta.created_at).getTime()) /
            60000,
        );
        duration =
          minutes < 60 ? `${minutes} minutes` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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
        return ok({});
      }
      deps.stderr(`[WorkCompletionLearning] Created learning: ${filename}`);

      return ok({});
    },

    defaultDeps,
  };
