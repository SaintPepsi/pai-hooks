/**
 * SteeringRuleInjector Contract — Inject steering rules into session context.
 *
 * Fires on SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
 * SubagentStart, and PreCompact. Parses YAML frontmatter from .md rule files,
 * matches keywords case-insensitively, and tracks injections per-session so
 * each rule fires at most once.
 */

import { join } from "node:path";
import { fileExists, readFile, readJson, writeJson } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionStartInput, UserPromptSubmitInput, ToolHookInput, SubagentStartInput, PreCompactInput } from "@hooks/core/types/hook-inputs";
import type { ContextOutput, ContinueOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import { isSubagent } from "@hooks/lib/environment";
import { readHookConfig } from "@hooks/lib/hook-config";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

type SteeringRuleInput = SessionStartInput | UserPromptSubmitInput | ToolHookInput | SubagentStartInput | PreCompactInput;

type SteeringEventType = "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "SubagentStart" | "PreCompact";

export interface RuleFrontmatter {
  name: string;
  events: string[];
  keywords: string[];
  body: string;
}

export interface SteeringRuleConfig {
  enabled: boolean;
  includes: string[];
  trackerDir: string;
}

export interface InjectionTracker {
  sessionId: string;
  injected: Record<string, { event: string; timestamp: string }>;
}

export interface SteeringRuleInjectorDeps {
  resolveGlobs: (patterns: string[]) => string[];
  readFile: (path: string) => string | null;
  readTracker: (sessionId: string) => InjectionTracker;
  writeTracker: (tracker: InjectionTracker) => void;
  getConfig: () => SteeringRuleConfig;
  isSubagent: () => boolean;
  stderr: (msg: string) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SILENT: SilentOutput = { type: "silent" };

const DEFAULT_CONFIG: SteeringRuleConfig = {
  enabled: true,
  includes: [],
  trackerDir: "MEMORY/STATE/.injections",
};

// ─── Frontmatter Parser ─────────────────────────────────────────────────────

export function parseFrontmatter(content: string): RuleFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const [, yaml, body] = match;
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const eventsMatch = yaml.match(/^events:\s*\[([^\]]*)\]$/m);
  const keywordsMatch = yaml.match(/^keywords:\s*\[([^\]]*)\]$/m);

  if (!nameMatch || !eventsMatch) return null;

  const name = nameMatch[1].trim();
  const events = eventsMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const keywords = keywordsMatch
    ? keywordsMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return { name, events, keywords, body: body.trim() };
}

// ─── Keyword Matching ───────────────────────────────────────────────────────

export function matchesKeywords(prompt: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const lower = prompt.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

// ─── Event Detection ────────────────────────────────────────────────────────

function isPromptEvent(input: SteeringRuleInput): input is UserPromptSubmitInput {
  return "prompt" in input && input.prompt != null;
}

function isToolEvent(input: SteeringRuleInput): input is ToolHookInput {
  return "tool_name" in input;
}

function isPreCompactEvent(input: SteeringRuleInput): input is PreCompactInput {
  return "trigger" in input && (input as PreCompactInput).trigger != null;
}

function getEventType(input: SteeringRuleInput): SteeringEventType {
  if (isToolEvent(input)) {
    return "tool_response" in input && input.tool_response !== undefined ? "PostToolUse" : "PreToolUse";
  }
  if (isPromptEvent(input)) return "UserPromptSubmit";
  if (isPreCompactEvent(input)) return "PreCompact";
  if ("transcript_path" in input && (input as SubagentStartInput).transcript_path != null) return "SubagentStart";
  return "SessionStart";
}

function getMatchText(input: SteeringRuleInput): string {
  if (isToolEvent(input)) {
    const filePath = typeof input.tool_input["file_path"] === "string" ? input.tool_input["file_path"] : "";
    return `${input.tool_name} ${filePath}`;
  }
  if (isPromptEvent(input)) return input.prompt ?? "";
  // SubagentStart/PreCompact/SessionStart use always-inject only — keyword matching is skipped in execute()
  return "";
}

// ─── Env Expansion (used only in defaultDeps) ───────────────────────────────

function expandEnvVars(pattern: string, getEnv: (key: string) => string | undefined): string {
  return pattern.replace(/\$\{(\w+)\}/g, (_match, name: string) => getEnv(name) ?? "");
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: SteeringRuleInjectorDeps = {
  resolveGlobs: (patterns: string[]): string[] => {
    const getEnv = (k: string): string | undefined => process.env[k];
    const files: string[] = [];
    for (const pattern of patterns) {
      const expanded = expandEnvVars(pattern, getEnv);
      const glob = new Bun.Glob(expanded);
      for (const path of glob.scanSync({ absolute: true })) {
        files.push(path);
      }
    }
    return files;
  },

  readFile: (path: string): string | null => {
    const result = readFile(path);
    return result.ok ? result.value : null;
  },

  readTracker: (sessionId: string): InjectionTracker => {
    const trackerPath = join(getPaiDir(), DEFAULT_CONFIG.trackerDir, `injections-${sessionId}.json`);
    if (!fileExists(trackerPath)) return { sessionId, injected: {} };
    const result = readJson<InjectionTracker>(trackerPath);
    return result.ok ? result.value : { sessionId, injected: {} };
  },

  writeTracker: (tracker: InjectionTracker): void => {
    const trackerPath = join(getPaiDir(), DEFAULT_CONFIG.trackerDir, `injections-${tracker.sessionId}.json`);
    writeJson(trackerPath, tracker);
  },

  getConfig: (): SteeringRuleConfig => {
    const userConfig = readHookConfig<Partial<SteeringRuleConfig>>("steeringRuleInjector");
    return { ...DEFAULT_CONFIG, ...userConfig };
  },

  isSubagent: () => isSubagent((k) => process.env[k]),

  stderr: defaultStderr,
};

// ─── Contract ───────────────────────────────────────────────────────────────

const BARE_CONTINUE: ContinueOutput = { type: "continue", continue: true };

export const SteeringRuleInjector: SyncHookContract<
  SteeringRuleInput,
  ContextOutput | ContinueOutput | SilentOutput,
  SteeringRuleInjectorDeps
> = {
  name: "SteeringRuleInjector",
  event: ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart", "PreCompact"],

  accepts(_input: SteeringRuleInput): boolean {
    return true;
  },

  execute(
    input: SteeringRuleInput,
    deps: SteeringRuleInjectorDeps,
  ): Result<ContextOutput | ContinueOutput | SilentOutput, ResultError> {
    if (deps.isSubagent()) {
      return ok(SILENT);
    }

    const config = deps.getConfig();
    if (!config.enabled) {
      return ok(SILENT);
    }

    const eventType = getEventType(input);
    const matchText = getMatchText(input);
    const isToolEventType = eventType === "PreToolUse" || eventType === "PostToolUse";

    // Resolve glob patterns to file paths
    const filePaths = deps.resolveGlobs(config.includes);
    if (filePaths.length === 0) {
      deps.stderr("[SteeringRuleInjector] No rule files found");
      return ok(isToolEventType ? BARE_CONTINUE : SILENT);
    }

    // Load tracker for deduplication
    const tracker = deps.readTracker(input.session_id);
    const bodiesToInject: string[] = [];

    for (const filePath of filePaths) {
      const content = deps.readFile(filePath);
      if (!content) continue;

      const rule = parseFrontmatter(content);
      if (!rule) continue;

      // Filter by event type
      if (!rule.events.includes(eventType)) continue;

      // Skip already-injected rules
      if (tracker.injected[rule.name]) continue;

      // For always-events (SessionStart, SubagentStart, PreCompact), only inject empty-keyword rules
      if ((eventType === "SessionStart" || eventType === "SubagentStart" || eventType === "PreCompact") && rule.keywords.length > 0) continue;

      // For keyword-events (UserPromptSubmit, PreToolUse, PostToolUse), require a keyword match
      if (eventType === "UserPromptSubmit" || isToolEventType) {
        if (!matchesKeywords(matchText, rule.keywords)) continue;
      }

      bodiesToInject.push(rule.body);
      tracker.injected[rule.name] = {
        event: eventType,
        timestamp: new Date().toISOString(),
      };
    }

    if (bodiesToInject.length === 0) {
      return ok(isToolEventType ? BARE_CONTINUE : SILENT);
    }

    // Persist tracker
    deps.writeTracker(tracker);

    const joined = bodiesToInject.join("\n\n---\n\n");
    deps.stderr(
      `[SteeringRuleInjector] Injecting ${bodiesToInject.length} rule(s) on ${eventType}`,
    );

    if (isToolEventType) {
      return ok({ type: "continue", continue: true, additionalContext: joined });
    }

    return ok({ type: "context", content: joined });
  },

  defaultDeps,
};
