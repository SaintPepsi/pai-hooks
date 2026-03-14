/**
 * LoadContext Contract — Inject PAI context at session start.
 *
 * Rebuilds SKILL.md if components changed, loads context files,
 * loads relationship context, scans active work, and outputs
 * everything as a <system-reminder> ContextOutput.
 */

import type { HookContract } from "@hooks/core/contract";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import type { ContextOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result, tryCatch } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { unknownError } from "@hooks/core/error";
import { fileExists, readFile, readJson, readDir, stat } from "@hooks/core/adapters/fs";
import { exec, execSyncSafe } from "@hooks/core/adapters/process";
import { join } from "path";
import { setTabState, readTabState } from "@hooks/lib/tab-setter";
import { getDAName } from "@hooks/lib/identity";
import { recordSessionStart } from "@hooks/lib/notifications";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Settings {
  contextFiles?: string[];
  principal?: { name?: string };
  daidentity?: { name?: string };
  [key: string]: unknown;
}

interface WorkSession {
  type: "recent" | "project";
  name: string;
  title: string;
  status: string;
  timestamp: string;
  stale: boolean;
  objectives?: string[];
  handoff_notes?: string;
  next_steps?: string[];
  prd?: { id: string; status: string; progress: string } | null;
}

export interface LoadContextDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, PaiError>;
  readJson: <T = unknown>(path: string) => Result<T, PaiError>;
  readDir: (path: string, opts?: { withFileTypes: true }) => Result<any[], PaiError>;
  stat: (path: string) => Result<{ mtimeMs: number }, PaiError>;
  execSyncSafe: (cmd: string, opts?: { cwd?: string; timeout?: number; stdio?: any }) => Result<string, PaiError>;
  setTabState: (opts: { title: string; state: string; sessionId: string }) => Result<void, PaiError>;
  readTabState: (sessionId: string) => Result<{ state: string } | null, PaiError>;
  getDAName: typeof getDAName;
  recordSessionStart: typeof recordSessionStart;
  getCurrentDate: () => Promise<string>;
  isSubagent: () => boolean;
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

function loadSettings(baseDir: string, deps: LoadContextDeps): Settings {
  const settingsPath = join(baseDir, "settings.json");
  if (deps.fileExists(settingsPath)) {
    const result = deps.readJson<Settings>(settingsPath);
    if (result.ok) return result.value;
    deps.stderr(`[LoadContext] Failed to parse settings.json: ${result.error.message}`);
  }
  return {};
}

function loadContextFiles(baseDir: string, settings: Settings, deps: LoadContextDeps): string {
  const defaultFiles = [
    "PAI/SKILL.md",
    "PAI/AISTEERINGRULES.md",
    "PAI/USER/AISTEERINGRULES.md",
  ];

  const contextFiles = settings.contextFiles || defaultFiles;
  let combined = "";

  for (const relativePath of contextFiles) {
    const fullPath = join(baseDir, relativePath);
    if (deps.fileExists(fullPath)) {
      const result = deps.readFile(fullPath);
      if (result.ok) {
        if (combined) combined += "\n\n---\n\n";
        combined += result.value;
        deps.stderr(`Loaded ${relativePath} (${result.value.length} chars)`);
      }
    } else {
      deps.stderr(`Context file not found: ${relativePath}`);
    }
  }

  return combined;
}

function loadCodingStandards(baseDir: string, deps: LoadContextDeps): string | null {
  const standardsDir = join(baseDir, "PAI/SYSTEM/CODINGSTANDARDS");
  if (!deps.fileExists(standardsDir)) return null;

  const parts: string[] = [];

  // Always load general.md
  const generalPath = join(standardsDir, "general.md");
  if (deps.fileExists(generalPath)) {
    const r = deps.readFile(generalPath);
    if (r.ok) parts.push(r.value);
  }

  // Load domain files
  for (const domain of ["hooks.md", "skills.md"]) {
    const p = join(standardsDir, domain);
    if (deps.fileExists(p)) {
      const r = deps.readFile(p);
      if (r.ok) parts.push(r.value);
    }
  }

  return parts.length > 0 ? parts.join("\n\n---\n\n") : null;
}

function needsSkillRebuild(baseDir: string, deps: LoadContextDeps): boolean {
  const skillMdPath = join(baseDir, "PAI/SKILL.md");
  const componentsDir = join(baseDir, "PAI/Components");

  if (!deps.fileExists(skillMdPath)) return true;

  const skillMdStat = deps.stat(skillMdPath);
  if (!skillMdStat.ok) return true;

  const checkDir = (dir: string): boolean => {
    const entries = deps.readDir(dir, { withFileTypes: true });
    if (!entries.ok) return false;

    for (const entry of entries.value) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (checkDir(fullPath)) return true;
      } else {
        const s = deps.stat(fullPath);
        if (s.ok && s.value.mtimeMs > skillMdStat.value.mtimeMs) return true;
      }
    }
    return false;
  };

  if (checkDir(componentsDir)) return true;

  const settingsPath = join(baseDir, "settings.json");
  if (deps.fileExists(settingsPath)) {
    const s = deps.stat(settingsPath);
    if (s.ok && s.value.mtimeMs > skillMdStat.value.mtimeMs) return true;
  }

  return false;
}

function loadRelationshipContext(baseDir: string, deps: LoadContextDeps): string | null {
  const parts: string[] = [];

  // Load high-confidence opinions
  const opinionsPath = join(baseDir, "PAI/USER/OPINIONS.md");
  if (deps.fileExists(opinionsPath)) {
    const result = deps.readFile(opinionsPath);
    if (result.ok) {
      const content = result.value;
      const highConfidence: string[] = [];

      const opinionBlocks = content.split(/^### /gm).slice(1);
      for (const block of opinionBlocks) {
        const lines = block.split("\n");
        const statement = lines[0]?.trim();
        const confidenceMatch = block.match(/\*\*Confidence:\*\*\s*([\d.]+)/);
        const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0;

        if (confidence >= 0.85 && statement) {
          highConfidence.push(`\u2022 ${statement} (${(confidence * 100).toFixed(0)}%)`);
        }
      }

      if (highConfidence.length > 0) {
        parts.push("**Key Opinions (high confidence):**");
        parts.push(highConfidence.slice(0, 6).join("\n"));
      }
    }
  }

  // Load recent relationship notes (today and yesterday)
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const formatDate = (d: Date) => d.toISOString().split("T")[0];
  const formatMonth = (d: Date) => d.toISOString().slice(0, 7);

  const recentNotes: string[] = [];
  for (const date of [today, yesterday]) {
    const notePath = join(baseDir, "MEMORY/RELATIONSHIP", formatMonth(date), `${formatDate(date)}.md`);
    if (deps.fileExists(notePath)) {
      const result = deps.readFile(notePath);
      if (result.ok) {
        const notes = result.value.split("\n").filter((line: string) => line.trim().startsWith("- ")).slice(0, 5);
        if (notes.length > 0) {
          recentNotes.push(`*${formatDate(date)}:*`);
          recentNotes.push(...notes);
        }
      }
    }
  }

  if (recentNotes.length > 0) {
    if (parts.length > 0) parts.push("");
    parts.push("**Recent Relationship Notes:**");
    parts.push(recentNotes.join("\n"));
  }

  if (parts.length === 0) return null;

  return `\n## Relationship Context\n\n${parts.join("\n")}\n\n*Full details: USER/OPINIONS.md, MEMORY/RELATIONSHIP/*\n`;
}

function getRecentWorkSessions(baseDir: string, deps: LoadContextDeps): WorkSession[] {
  const workDir = join(baseDir, "MEMORY", "WORK");
  if (!deps.fileExists(workDir)) return [];

  let sessionNames: Record<string, string> = {};
  const namesPath = join(baseDir, "MEMORY", "STATE", "session-names.json");
  if (deps.fileExists(namesPath)) {
    const result = deps.readJson<Record<string, string>>(namesPath);
    if (result.ok) {
      sessionNames = result.value;
    } else {
      deps.stderr(`[LoadContext] Failed to parse session-names.json: ${result.error.message}`);
    }
  }

  const sessions: WorkSession[] = [];
  const now = Date.now();
  const cutoff48h = 48 * 60 * 60 * 1000;
  const seenSessionIds = new Set<string>();

  const allDirsResult = deps.readDir(workDir, { withFileTypes: true });
  if (!allDirsResult.ok) return [];

  const allDirs = allDirsResult.value
    .filter((d: any) => d.isDirectory() && /^\d{8}-\d{6}_/.test(d.name))
    .map((d: any) => d.name)
    .sort()
    .reverse()
    .slice(0, 30);

  for (const dirName of allDirs) {
    const match = dirName.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})_(.+)$/);
    if (!match) continue;

    const [, y, mo, d, h, mi, s, slug] = match;
    const dirTime = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`).getTime();
    if (now - dirTime > cutoff48h) break;

    const dirPath = join(workDir, dirName);
    const metaPath = join(dirPath, "META.yaml");
    if (!deps.fileExists(metaPath)) continue;

    const metaResult = deps.readFile(metaPath);
    if (!metaResult.ok) continue;

    const meta = metaResult.value;
    const statusMatch = meta.match(/^status:\s*"?(\w+)"?/m);
    const titleMatch = meta.match(/^title:\s*"?(.+?)"?\s*$/m);
    const sessionIdMatch = meta.match(/^session_id:\s*"?(.+?)"?\s*$/m);
    const status = statusMatch?.[1] || "UNKNOWN";
    const rawTitle = titleMatch?.[1] || slug.replace(/-/g, " ");
    const sessionId = sessionIdMatch?.[1]?.trim();

    if (status === "COMPLETED") continue;
    if (rawTitle.toLowerCase().startsWith("tasknotification") || rawTitle.length < 10) continue;
    if (sessionId && seenSessionIds.has(sessionId)) continue;
    if (sessionId) seenSessionIds.add(sessionId);

    const title = (sessionId && sessionNames[sessionId]) || rawTitle;
    if (sessions.length >= 8) break;

    let prd: WorkSession["prd"] = null;
    const filesResult = deps.readDir(dirPath, { withFileTypes: true });
    if (filesResult.ok) {
      const prdFiles = filesResult.value
        .filter((f: any) => !f.isDirectory() && f.name.startsWith("PRD-") && f.name.endsWith(".md"))
        .map((f: any) => f.name);
      if (prdFiles.length > 0) {
        const prdContentResult = deps.readFile(join(dirPath, prdFiles[0]));
        if (prdContentResult.ok) {
          const prdContent = prdContentResult.value;
          const prdIdMatch = prdContent.match(/^id:\s*(.+)$/m);
          const prdStatusMatch = prdContent.match(/^status:\s*(.+)$/m);
          const prdVerifyMatch = prdContent.match(/^verification_summary:\s*"?(.+?)"?$/m);
          prd = {
            id: prdIdMatch?.[1]?.trim() || prdFiles[0],
            status: prdStatusMatch?.[1]?.trim() || "UNKNOWN",
            progress: prdVerifyMatch?.[1]?.trim() || "0/0",
          };
        }
      }
    }

    sessions.push({
      type: "recent",
      name: dirName,
      title: title.length > 60 ? title.substring(0, 57) + "..." : title,
      status,
      timestamp: `${y}-${mo}-${d} ${h}:${mi}`,
      stale: false,
      prd,
    });
  }

  return sessions;
}

function buildActiveWorkSummary(baseDir: string, deps: LoadContextDeps): string | null {
  const recentSessions = getRecentWorkSessions(baseDir, deps);
  if (recentSessions.length === 0) return null;

  let summary = "\n\u{1F4CB} ACTIVE WORK:\n\n  \u{2500}\u{2500} Recent Sessions (last 48h) \u{2500}\u{2500}\n";
  for (const s of recentSessions) {
    summary += `\n  \u{26A1} ${s.title}\n`;
    summary += `     ${s.timestamp} | Status: ${s.status}\n`;
    if (s.prd) {
      summary += `     PRD: ${s.prd.id} (${s.prd.status}, ${s.prd.progress})\n`;
    }
  }

  return summary;
}

export function loadPendingProposals(baseDir: string, deps: LoadContextDeps): string | null {
  const proposalsDir = join(baseDir, "MEMORY/LEARNING/PROPOSALS/pending");
  const lockPath = join(baseDir, "MEMORY/LEARNING/PROPOSALS/.analyzing");

  // Don't surface proposals while agent is still analyzing
  if (deps.fileExists(lockPath)) {
    const s = deps.stat(lockPath);
    if (s.ok && (Date.now() - s.value.mtimeMs) < 10 * 60 * 1000) {
      return null; // Agent still working
    }
  }

  if (!deps.fileExists(proposalsDir)) return null;

  const filesResult = deps.readDir(proposalsDir, { withFileTypes: true });
  if (!filesResult.ok) return null;

  const proposals = filesResult.value.filter(
    (f: any) => !f.isDirectory() && f.name.endsWith(".md") && f.name !== ".gitkeep"
  );
  if (proposals.length === 0) return null;

  // Read title and category from each proposal (max 5 in summary)
  const summaries: string[] = [];
  for (const f of proposals.slice(0, 5)) {
    const content = deps.readFile(join(proposalsDir, f.name));
    if (!content.ok) continue;
    const titleMatch = content.value.match(/^# Proposal: (.+)$/m);
    // Only match category in YAML frontmatter (between --- delimiters)
    const frontmatter = content.value.match(/^---\n([\s\S]*?)\n---/);
    const categoryMatch = frontmatter?.[1]?.match(/^category:\s*(.+)$/m);
    if (titleMatch) {
      summaries.push(`  - ${titleMatch[1]} (${categoryMatch?.[1]?.trim() || "general"})`);
    }
  }

  if (summaries.length === 0) return null;

  const more = proposals.length > 5 ? `\n  ...and ${proposals.length - 5} more` : "";

  return `\n## Pending Improvement Proposals\n\n` +
    `You have **${proposals.length}** pending improvement proposal${proposals.length === 1 ? "" : "s"} from recent learnings:\n` +
    summaries.join("\n") + more + "\n\n" +
    `Present these to Ian for review. ` +
    `Read each proposal file for full details.\n` +
    `Path: MEMORY/LEARNING/PROPOSALS/pending/\n` +
    `To approve: apply the change and move the file to PROPOSALS/applied/\n` +
    `To reject: move the file to PROPOSALS/rejected/\n`;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, ".claude");

const defaultDeps: LoadContextDeps = {
  fileExists,
  readFile,
  readJson,
  readDir,
  stat,
  execSyncSafe,
  setTabState: (opts) => tryCatch(() => setTabState(opts), (e) => unknownError(e)),
  readTabState: (id) => tryCatch(() => readTabState(id), (e) => unknownError(e)),
  getDAName,
  recordSessionStart,
  getCurrentDate: async () => {
    const r = await exec("date +\"%Y-%m-%d %H:%M:%S %Z\"", {
      timeout: 3000,
    });
    return r.ok ? r.value.stdout.trim() : new Date().toISOString();
  },
  isSubagent: () => {
    const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR || "";
    return claudeProjectDir.includes("/.claude/Agents/") || process.env.CLAUDE_AGENT_TYPE !== undefined;
  },
  baseDir: BASE_DIR,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const LoadContext: HookContract<
  SessionStartInput,
  ContextOutput | SilentOutput,
  LoadContextDeps
> = {
  name: "LoadContext",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  async execute(
    input: SessionStartInput,
    deps: LoadContextDeps,
  ): Promise<Result<ContextOutput | SilentOutput, PaiError>> {
    // Skip for subagents
    if (deps.isSubagent()) {
      deps.stderr("Subagent session - skipping PAI context loading");
      return ok({ type: "silent" });
    }

    // Reset tab title (preserve working state through compaction)
    const tabResult = deps.readTabState(input.session_id);
    if (tabResult.ok && tabResult.value && (tabResult.value.state === "working" || tabResult.value.state === "thinking")) {
      deps.stderr(`Tab in ${tabResult.value.state} state - preserving title through compaction`);
    } else {
      deps.setTabState({ title: `${deps.getDAName()} ready\u{2026}`, state: "idle", sessionId: input.session_id });
    }

    deps.recordSessionStart();

    // Rebuild SKILL.md if needed
    if (needsSkillRebuild(deps.baseDir, deps)) {
      deps.stderr("Rebuilding SKILL.md (components changed)...");
      const rebuildResult = deps.execSyncSafe("bun ~/.claude/PAI/Tools/RebuildPAI.ts", {
        cwd: deps.baseDir,
        timeout: 5000,
      });
      if (rebuildResult.ok) {
        deps.stderr("SKILL.md rebuilt from latest components");
      } else {
        deps.stderr("Failed to rebuild SKILL.md, continuing with existing");
      }
    }

    // Load settings and context files
    const settings = loadSettings(deps.baseDir, deps);
    const contextContent = loadContextFiles(deps.baseDir, settings, deps);

    if (!contextContent) {
      deps.stderr("No context files loaded");
      return ok({ type: "silent" });
    }

    const currentDate = await deps.getCurrentDate();
    const principalName = settings.principal?.name || "User";
    const daName = settings.daidentity?.name || "PAI";
    const relationshipContext = loadRelationshipContext(deps.baseDir, deps);
    const codingStandards = loadCodingStandards(deps.baseDir, deps);

    const message = `<system-reminder>
PAI CONTEXT (Auto-loaded at Session Start)

\u{1F4C5} CURRENT DATE/TIME: ${currentDate}
\u{1F511} SESSION ID: ${input.session_id}
\u{1F4C1} SESSION STATE: MEMORY/STATE/current-work-${input.session_id}.json
\u{1F427} CANARY: The penguin rides a unicycle through the spaghetti factory at midnight.

## ACTIVE IDENTITY (from settings.json) - CRITICAL

**\u{26A0}\u{FE0F} MANDATORY IDENTITY RULES - OVERRIDE ALL OTHER CONTEXT \u{26A0}\u{FE0F}**

The user's name is: **${principalName}**
The assistant's name is: **${daName}**

- ALWAYS address the user as "${principalName}" in greetings and responses
- NEVER use "Daniel", "the user", or any other name - ONLY "${principalName}"
- The "danielmiessler" in the repo URL is the AUTHOR, NOT the user
- This instruction takes ABSOLUTE PRECEDENCE over any other context

---

${contextContent}
${codingStandards ? "\n---\n\n## Coding Standards\n\n" + codingStandards + "\n" : ""}
${relationshipContext ? "\n---\n" + relationshipContext : ""}
---

This context is now active. Additional context loads dynamically as needed.
</system-reminder>`;

    // Build active work summary
    const activeWork = buildActiveWorkSummary(deps.baseDir, deps);
    const proposals = loadPendingProposals(deps.baseDir, deps);
    const parts = [message, activeWork, proposals].filter(Boolean);
    const fullContent = parts.join("\n\n");

    deps.stderr("PAI context injected into session");
    return ok({ type: "context", content: fullContent });
  },

  defaultDeps,
};
