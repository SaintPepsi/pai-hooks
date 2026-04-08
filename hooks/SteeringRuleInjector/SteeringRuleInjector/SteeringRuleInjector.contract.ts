/**
 * SteeringRuleInjector Contract — Inject steering rules into session context.
 *
 * Fires on SessionStart (always-rules with empty keywords) and
 * UserPromptSubmit (keyword-matched rules). Parses YAML frontmatter
 * from .md rule files, matches keywords case-insensitively, and
 * tracks injections per-session so each rule fires at most once.
 */

import { join } from "node:path";
import { fileExists, readFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionStartInput, UserPromptSubmitInput } from "@hooks/core/types/hook-inputs";
import type { ContextOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import { isSubagent } from "@hooks/lib/environment";
import { readHookConfig } from "@hooks/lib/hook-config";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

type SteeringRuleInput = SessionStartInput | UserPromptSubmitInput;

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
  includes: [
    "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SteeringRuleInjector/SteeringRuleInjector/steering-rules/*.md",
    "${HOME}/.claude/PAI/USER/rules/*.md",
  ],
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

function getEventType(input: SteeringRuleInput): "SessionStart" | "UserPromptSubmit" {
  return isPromptEvent(input) ? "UserPromptSubmit" : "SessionStart";
}

function getPromptText(input: SteeringRuleInput): string {
  return isPromptEvent(input) ? (input.prompt ?? "") : "";
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
    const trackerDir = join(getPaiDir(), DEFAULT_CONFIG.trackerDir);
    const trackerPath = join(trackerDir, `injections-${sessionId}.json`);
    if (!fileExists(trackerPath)) {
      return { sessionId, injected: {} };
    }
    const result = readFile(trackerPath);
    if (!result.ok) return { sessionId, injected: {} };
    const parsed = JSON.parse(result.value) as InjectionTracker;
    return parsed;
  },

  writeTracker: (tracker: InjectionTracker): void => {
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const trackerDir = join(getPaiDir(), DEFAULT_CONFIG.trackerDir);
    const trackerPath = join(trackerDir, `injections-${tracker.sessionId}.json`);
    mkdirSync(trackerDir, { recursive: true });
    writeFileSync(trackerPath, JSON.stringify(tracker, null, 2), "utf-8");
  },

  getConfig: (): SteeringRuleConfig => {
    const userConfig = readHookConfig<Partial<SteeringRuleConfig>>("steeringRuleInjector");
    return { ...DEFAULT_CONFIG, ...userConfig };
  },

  isSubagent: () => isSubagent((k) => process.env[k]),

  stderr: defaultStderr,
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const SteeringRuleInjector: SyncHookContract<
  SteeringRuleInput,
  ContextOutput | SilentOutput,
  SteeringRuleInjectorDeps
> = {
  name: "SteeringRuleInjector",
  event: ["SessionStart", "UserPromptSubmit"],

  accepts(_input: SteeringRuleInput): boolean {
    return true;
  },

  execute(
    input: SteeringRuleInput,
    deps: SteeringRuleInjectorDeps,
  ): Result<ContextOutput | SilentOutput, ResultError> {
    if (deps.isSubagent()) {
      return ok(SILENT);
    }

    const config = deps.getConfig();
    if (!config.enabled) {
      return ok(SILENT);
    }

    const eventType = getEventType(input);
    const prompt = getPromptText(input);

    // Resolve glob patterns to file paths
    const filePaths = deps.resolveGlobs(config.includes);
    if (filePaths.length === 0) {
      deps.stderr("[SteeringRuleInjector] No rule files found");
      return ok(SILENT);
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

      // For SessionStart, only inject rules with empty keywords (always-rules)
      if (eventType === "SessionStart" && rule.keywords.length > 0) continue;

      // For UserPromptSubmit with keywords, require keyword match
      if (eventType === "UserPromptSubmit" && rule.keywords.length > 0) {
        if (!matchesKeywords(prompt, rule.keywords)) continue;
      }

      bodiesToInject.push(rule.body);
      tracker.injected[rule.name] = {
        event: eventType,
        timestamp: new Date().toISOString(),
      };
    }

    if (bodiesToInject.length === 0) {
      return ok(SILENT);
    }

    // Persist tracker
    deps.writeTracker(tracker);

    const joined = bodiesToInject.join("\n\n---\n\n");
    deps.stderr(
      `[SteeringRuleInjector] Injecting ${bodiesToInject.length} rule(s) on ${eventType}`,
    );

    return ok({ type: "context", content: joined });
  },

  defaultDeps,
};
