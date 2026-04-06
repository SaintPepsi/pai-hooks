/**
 * WikiContextInjector Contract — Injects wiki page summaries as context.
 *
 * PreToolUse hook that fires on Write/Edit. Maps the target file path
 * to a wiki domain, looks up matching entity pages, and injects their
 * Summary section as additionalContext.
 *
 * Token cost: ~200-500 tokens per injection. Only fires when a wiki
 * page matches the target domain.
 */

import { join } from "node:path";
import { readDir, readFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import { continueOk } from "@hooks/core/types/hook-outputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WikiPageMeta {
  title: string;
  path: string;
  summary: string;
}

export type DomainIndex = Record<string, WikiPageMeta[]>;

export interface WikiContextInjectorDeps {
  readDir: (path: string) => Result<string[], ResultError>;
  readFile: (path: string) => Result<string, ResultError>;
  wikiDir: string;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ─────────────────────────────────────────────────────────────

/** Maximum number of wiki page summaries to inject per tool call. */
const MAX_MATCHES = 2;

/** Module-level cache: built once per session, reused across invocations. */
let cachedIndex: DomainIndex | null = null;

/**
 * Build a domain index from parsed wiki page metadata.
 * Keys are lowercased domain tags and titles. Values are arrays of page metadata.
 */
export function buildDomainIndex(
  pages: Record<string, { title: string; domain: string[]; summary: string }>,
): DomainIndex {
  const index: DomainIndex = {};
  for (const [path, meta] of Object.entries(pages)) {
    const entry: WikiPageMeta = { title: meta.title, path, summary: meta.summary };
    for (const domain of meta.domain) {
      const key = domain.toLowerCase();
      if (!index[key]) index[key] = [];
      index[key].push(entry);
    }
    // Also index by title for path-based matching
    const titleKey = meta.title.toLowerCase();
    if (!index[titleKey]) index[titleKey] = [];
    index[titleKey].push(entry);
  }
  return index;
}

/**
 * Match a file path against the domain index.
 * Returns up to MAX_MATCHES matching wiki pages, or null if no match.
 */
export function matchDomain(filePath: string, index: DomainIndex): WikiPageMeta[] | null {
  const lower = filePath.toLowerCase();
  for (const [domain, pages] of Object.entries(index)) {
    // Match domain as a path segment (avoid partial substring matches)
    if (lower.includes(`/${domain}/`) || lower.includes(`/${domain}.`)) {
      return pages.slice(0, MAX_MATCHES);
    }
  }
  return null;
}

/**
 * Extract the ## Summary section content from a markdown page.
 * Returns the text between ## Summary and the next ## heading (or EOF).
 */
export function extractSummary(markdownContent: string): string {
  const lines = markdownContent.split("\n");
  let inSummary = false;
  const summaryLines: string[] = [];
  for (const line of lines) {
    if (line.trim() === "## Summary") {
      inSummary = true;
      continue;
    }
    if (inSummary && line.startsWith("## ")) break;
    if (inSummary && line.trim()) summaryLines.push(line.trim());
  }
  return summaryLines.join(" ");
}

// ─── Internal: Parse YAML Frontmatter ───────────────────────────────────────

interface ParsedFrontmatter {
  title: string;
  domain: string[];
}

/**
 * Lightweight YAML frontmatter parser — extracts only title and domain.
 * Avoids importing a full YAML library for two fields.
 */
function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1];
  const titleMatch = fm.match(/^title:\s*"?([^"\n]+)"?\s*$/m);
  const domainMatch = fm.match(/^domain:\s*\[([^\]]*)\]\s*$/m);

  if (!titleMatch || !domainMatch) return null;

  const title = titleMatch[1].trim();
  const domain = domainMatch[1]
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d.length > 0);

  return { title, domain };
}

// ─── Internal: Load Index ───────────────────────────────────────────────────

function loadDomainIndex(deps: WikiContextInjectorDeps): DomainIndex {
  if (cachedIndex) return cachedIndex;

  const entitiesDir = join(deps.wikiDir, "entities");
  const dirResult = deps.readDir(entitiesDir);
  if (!dirResult.ok) {
    deps.stderr(`[WikiContextInjector] Cannot read wiki entities dir: ${dirResult.error.message}`);
    cachedIndex = {};
    return cachedIndex;
  }

  const pages: Record<string, { title: string; domain: string[]; summary: string }> = {};
  for (const filename of dirResult.value) {
    if (!filename.endsWith(".md")) continue;

    const filePath = join(entitiesDir, filename);
    const contentResult = deps.readFile(filePath);
    if (!contentResult.ok) continue;

    const content = contentResult.value;
    const fm = parseFrontmatter(content);
    if (!fm || fm.domain.length === 0) continue;

    const summary = extractSummary(content);
    if (!summary) continue;

    pages[`entities/${filename}`] = {
      title: fm.title,
      domain: fm.domain,
      summary,
    };
  }

  cachedIndex = buildDomainIndex(pages);
  return cachedIndex;
}

/** Reset cached index — exposed for testing only. */
export function _resetCache(): void {
  cachedIndex = null;
}

// ─── Contract ───────────────────────────────────────────────────────────────

const defaultDeps: WikiContextInjectorDeps = {
  readDir,
  readFile,
  wikiDir: join(getPaiDir(), "MEMORY", "WIKI"),
  stderr: defaultStderr,
};

export const WikiContextInjector: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  WikiContextInjectorDeps
> = {
  name: "WikiContextInjector",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Write" || input.tool_name === "Edit";
  },

  execute(
    input: ToolHookInput,
    deps: WikiContextInjectorDeps,
  ): Result<ContinueOutput, ResultError> {
    const filePath =
      typeof input.tool_input === "string"
        ? input.tool_input
        : (input.tool_input?.file_path as string) || "";

    if (!filePath) return ok(continueOk());

    const index = loadDomainIndex(deps);
    const matches = matchDomain(filePath, index);

    if (!matches || matches.length === 0) return ok(continueOk());

    const contextParts = matches.map((m) => `[Wiki: ${m.title}] ${m.summary}`);
    const contextText = `Wiki context for this file's domain:\n${contextParts.join("\n")}`;

    return ok(continueOk(contextText));
  },

  defaultDeps,
};
