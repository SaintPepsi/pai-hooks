/**
 * AutoWorkCreation Contract — Create session/task work directories.
 *
 * On first prompt: creates session directory + first task.
 * On subsequent prompts: classifies as continuation or new topic.
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import {
  ensureDir,
  fileExists,
  lstat,
  readJson,
  removeFile,
  symlink,
  writeFile,
} from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { UserPromptSubmitInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";
import { generatePRDFilename, generatePRDTemplate } from "@hooks/lib/prd-template";
import { getISOTimestamp, getLocalComponents } from "@hooks/lib/time";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CurrentWork {
  session_id: string;
  session_dir: string;
  current_task: string;
  task_title: string;
  task_count: number;
  created_at: string;
  prd_path?: string;
}

interface PromptClassification {
  type: "work" | "question" | "conversational";
  title: string;
  effort: "TRIVIAL" | "QUICK" | "STANDARD" | "THOROUGH";
  is_new_topic: boolean;
}

export interface AutoWorkCreationDeps {
  fileExists: (path: string) => boolean;
  readJson: <T = unknown>(path: string) => Result<T, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  ensureDir: (path: string) => Result<void, ResultError>;
  symlink: (target: string, path: string) => Result<void, ResultError>;
  removeFile: (path: string) => Result<void, ResultError>;
  lstat: (path: string) => Result<{ isSymbolicLink(): boolean }, ResultError>;
  getTimestamp: () => string;
  getLocalComponents: typeof getLocalComponents;
  generatePRDTemplate: typeof generatePRDTemplate;
  generatePRDFilename: typeof generatePRDFilename;
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

function slugify(text: string, maxLen: number = 40): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .substring(0, maxLen)
      .replace(/-$/, "") || "task"
  );
}

export function classifyPrompt(prompt: string, hasExistingSession: boolean): PromptClassification {
  const trimmed = prompt.trim();

  if (
    trimmed.length < 20 &&
    /^(yes|no|ok|okay|thanks|proceed|continue|go ahead|sure|got it|hi|hello|hey|good morning|good evening|\d{1,2})$/i.test(
      trimmed,
    )
  ) {
    return {
      type: "conversational",
      title: "",
      effort: "TRIVIAL",
      is_new_topic: false,
    };
  }

  if (!hasExistingSession) {
    const title = trimmed
      .substring(0, 60)
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .trim();
    return { type: "work", title, effort: "STANDARD", is_new_topic: true };
  }

  return {
    type: "work",
    title: trimmed
      .substring(0, 60)
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .trim(),
    effort: "STANDARD",
    is_new_topic: false,
  };
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: AutoWorkCreationDeps = {
  fileExists,
  readJson,
  writeFile,
  ensureDir,
  symlink,
  removeFile,
  lstat,
  getTimestamp: getISOTimestamp,
  getLocalComponents,
  generatePRDTemplate,
  generatePRDFilename,
  baseDir: getPaiDir(),
  stderr: defaultStderr,
};

export const AutoWorkCreation: SyncHookContract<UserPromptSubmitInput, AutoWorkCreationDeps> = {
  name: "AutoWorkCreation",
  event: "UserPromptSubmit",

  accepts(input: UserPromptSubmitInput): boolean {
    const prompt = input.prompt || input.user_prompt || "";
    return prompt.length >= 2;
  },

  execute(
    input: UserPromptSubmitInput,
    deps: AutoWorkCreationDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const prompt = input.prompt || input.user_prompt || "";
    const sessionId = input.session_id || "unknown";
    const workDir = join(deps.baseDir, "MEMORY", "WORK");
    const stateDir = join(deps.baseDir, "MEMORY", "STATE");

    deps.ensureDir(workDir);

    // Read current work state
    let currentWork: CurrentWork | null = null;
    const scopedFile = join(stateDir, `current-work-${sessionId}.json`);

    const scopedResult = deps.readJson<CurrentWork>(scopedFile);
    if (scopedResult.ok) {
      currentWork = scopedResult.value;
    }

    const isExistingSession = currentWork && currentWork.session_id === sessionId;
    const classification = classifyPrompt(prompt, !!isExistingSession);

    if (classification.type === "conversational" && !classification.is_new_topic) {
      deps.stderr("[AutoWork] Conversational continuation, no new task");
      return ok({});
    }

    if (!isExistingSession) {
      // New session
      const title = classification.title || prompt.substring(0, 50);
      const { year, month, day, hours, minutes, seconds } = deps.getLocalComponents();
      const timestamp = `${year}${month}${day}-${hours}${minutes}${seconds}`;
      const sessionDirName = `${timestamp}_${slugify(title, 50)}`;
      const sessionPath = join(workDir, sessionDirName);

      deps.ensureDir(join(sessionPath, "tasks"));
      deps.ensureDir(join(sessionPath, "scratch"));

      const meta = `id: "${sessionDirName}"\ntitle: "${title}"\nsession_id: "${sessionId}"\ncreated_at: "${deps.getTimestamp()}"\ncompleted_at: null\nstatus: "ACTIVE"\n`;
      deps.writeFile(join(sessionPath, "META.yaml"), meta);

      // Create first task
      const taskDirName = `001_${slugify(title)}`;
      const taskPath = join(sessionPath, "tasks", taskDirName);
      deps.ensureDir(taskPath);

      const prdSlug = slugify(title).substring(0, 40);
      const prdFilename = deps.generatePRDFilename(prdSlug);
      const prdContent = deps.generatePRDTemplate({
        title,
        slug: prdSlug,
        effortLevel: classification.effort,
        prompt,
      });
      deps.writeFile(join(taskPath, prdFilename), prdContent);

      const isc = {
        taskId: taskDirName,
        status: "PENDING",
        effortLevel: classification.effort,
        criteria: [],
        antiCriteria: [],
        satisfaction: null,
        createdAt: deps.getTimestamp(),
        updatedAt: deps.getTimestamp(),
      };
      deps.writeFile(join(taskPath, "ISC.json"), JSON.stringify(isc, null, 2));

      // Update current symlink
      const currentLink = join(sessionPath, "tasks", "current");
      const linkExists = deps.fileExists(currentLink) || deps.lstat(currentLink).ok;
      if (linkExists) deps.removeFile(currentLink);
      deps.symlink(taskDirName, currentLink);

      // Write state
      deps.ensureDir(stateDir);
      deps.writeFile(
        join(stateDir, `current-work-${sessionId}.json`),
        JSON.stringify(
          {
            session_id: sessionId,
            session_dir: sessionDirName,
            current_task: taskDirName,
            task_title: title,
            task_count: 1,
            created_at: deps.getTimestamp(),
            prd_path: join(taskPath, prdFilename),
          },
          null,
          2,
        ),
      );

      deps.stderr(`[AutoWork] New session with task: ${taskDirName}`);
    } else if (classification.is_new_topic && currentWork) {
      deps.stderr(`[AutoWork] New topic in session — skipped (handled by algorithm)`);
    } else {
      deps.stderr(`[AutoWork] Continuing task: ${currentWork!.current_task}`);
    }

    return ok({});
  },

  defaultDeps,
};
