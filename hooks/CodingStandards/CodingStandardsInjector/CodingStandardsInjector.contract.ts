/**
 * CodingStandardsInjector Contract — Inject coding standards on first Write/Edit.
 *
 * PreToolUse hook that reads configured coding standards files and injects
 * them as additionalContext on the first Write/Edit tool use in a session.
 *
 * Config source: Top-level `codingStandards: string[]` in settings.json.
 * Path resolution: Relative to getPaiDir() for global standards.
 *
 * Session dedup: Module-level Set tracking injected file hashes prevents
 * duplicate injection within the same session.
 *
 * Max size guard: Files over 50KB are skipped to prevent context bloat.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readFile } from "@hooks/core/adapters/fs";
import { safeJsonParse } from "@hooks/core/adapters/json";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr, getPaiDir, getSettingsPath } from "@hooks/lib/paths";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SettingsWithCodingStandards {
  codingStandards?: string[];
}

export interface CodingStandardsInjectorDeps {
  readFile: (path: string) => Result<string, ResultError>;
  paiDir: string;
  settingsPath: string;
  stderr: (msg: string) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum file size for injection (50KB). */
const MAX_FILE_SIZE = 50 * 1024;

// ─── Session State ──────────────────────────────────────────────────────────

/** Set of content hashes already injected this session — prevents duplicates. */
let injectedHashes: Set<string> = new Set();

/** Track whether we've injected this session (first Write/Edit only). */
let hasInjectedThisSession = false;

/** Reset session state — exposed for testing only. */
export function _resetSessionState(): void {
  injectedHashes = new Set();
  hasInjectedThisSession = false;
}

// ─── Pure Functions ─────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function readCodingStandardsConfig(deps: CodingStandardsInjectorDeps): string[] | null {
  const settingsResult = deps.readFile(deps.settingsPath);
  if (!settingsResult.ok) return null;

  const parseResult = safeJsonParse(settingsResult.value);
  if (!parseResult.ok) return null;

  const settings = parseResult.value as SettingsWithCodingStandards;
  const standards = settings.codingStandards;
  if (!Array.isArray(standards)) return null;
  return standards.filter((s): s is string => typeof s === "string");
}

function resolvePath(path: string, paiDir: string): string {
  if (path.startsWith("/")) return path;
  return join(paiDir, path);
}

// ─── Contract ───────────────────────────────────────────────────────────────

const defaultDeps: CodingStandardsInjectorDeps = {
  readFile,
  paiDir: getPaiDir(),
  settingsPath: getSettingsPath(),
  stderr: defaultStderr,
};

export const CodingStandardsInjector: SyncHookContract<ToolHookInput, CodingStandardsInjectorDeps> =
  {
    name: "CodingStandardsInjector",
    event: "PreToolUse",

    accepts(input: ToolHookInput): boolean {
      return input.tool_name === "Write" || input.tool_name === "Edit";
    },

    execute(
      _input: ToolHookInput,
      deps: CodingStandardsInjectorDeps,
    ): Result<SyncHookJSONOutput, ResultError> {
      // Only inject on the first Write/Edit in a session
      if (hasInjectedThisSession) {
        return ok({ continue: true });
      }

      const standards = readCodingStandardsConfig(deps);
      if (!standards || standards.length === 0) {
        deps.stderr("[CodingStandardsInjector] No codingStandards configured — skipping");
        return ok({ continue: true });
      }

      const contextParts: string[] = [];

      for (const standardPath of standards) {
        const fullPath = resolvePath(standardPath, deps.paiDir);
        const contentResult = deps.readFile(fullPath);

        if (!contentResult.ok) {
          deps.stderr(
            `[CodingStandardsInjector] Cannot read ${fullPath}: ${contentResult.error.message}`,
          );
          continue;
        }

        const content = contentResult.value;

        // Size guard
        if (content.length > MAX_FILE_SIZE) {
          deps.stderr(`[CodingStandardsInjector] Skipping ${fullPath}: exceeds 50KB limit`);
          continue;
        }

        // Dedup by content hash
        const hash = hashContent(content);
        if (injectedHashes.has(hash)) {
          deps.stderr(
            `[CodingStandardsInjector] Skipping ${fullPath}: already injected (hash: ${hash})`,
          );
          continue;
        }

        injectedHashes.add(hash);
        contextParts.push(`[Coding Standards: ${standardPath}]\n${content}`);
      }

      // Mark session as having injected (even if all files were skipped)
      hasInjectedThisSession = true;

      if (contextParts.length === 0) {
        deps.stderr("[CodingStandardsInjector] No standards injected (all skipped or missing)");
        return ok({ continue: true });
      }

      const contextText = contextParts.join("\n\n---\n\n");
      deps.stderr(
        `[CodingStandardsInjector] Injected ${contextParts.length} coding standards file(s)`,
      );

      return ok({
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: contextText,
        },
      });
    },

    defaultDeps,
  };
