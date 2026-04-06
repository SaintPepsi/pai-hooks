/**
 * WikiContextInjector Contract — Injects wiki page summaries as context.
 *
 * PreToolUse hook that fires on Write/Edit. Maps the target file path
 * to a wiki domain, looks up matching entity and concept pages, and
 * injects their Summary/Definition section as additionalContext.
 *
 * Token cost: ~200-500 tokens per injection. Only fires when a wiki
 * page matches the target domain.
 */

import { join } from "node:path";
import { appendFile, readDir, readFile } from "@hooks/core/adapters/fs";
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
  appendFile: (path: string, content: string) => Result<void, ResultError>;
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
    const addedKeys = new Set<string>();
    for (const domain of meta.domain) {
      const key = domain.toLowerCase();
      if (addedKeys.has(key)) continue;
      addedKeys.add(key);
      if (!index[key]) index[key] = [];
      index[key].push(entry);
    }
    // Also index by title for path-based matching (skip if already covered by domain)
    const titleKey = meta.title.toLowerCase();
    if (!addedKeys.has(titleKey)) {
      if (!index[titleKey]) index[titleKey] = [];
      index[titleKey].push(entry);
    }
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
 * Extract the ## Summary or ## Definition section content from a markdown page.
 * Checks for ## Summary first (entity pages), then ## Definition (concept pages).
 * Returns the text between the heading and the next ## heading (or EOF).
 */
export function extractSummary(markdownContent: string): string {
  const lines = markdownContent.split("\n");
  let inSection = false;
  const sectionLines: string[] = [];
  for (const line of lines) {
    if (inSection && line.startsWith("## ")) break;
    if (!inSection && (line.trim() === "## Summary" || line.trim() === "## Definition")) {
      inSection = true;
      continue;
    }
    if (inSection && line.trim()) sectionLines.push(line.trim());
  }
  return sectionLines.join(" ");
}

// ─── Internal: Parse YAML Frontmatter ───────────────────────────────────────

interface ParsedFrontmatter {
  title: string;
  domain: string[];
}

/**
 * Lightweight YAML frontmatter parser — extracts title and optional domain.
 * Avoids importing a full YAML library for two fields.
 * Title is required; domain defaults to [] if absent (concept pages).
 */
function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1];
  const titleMatch = fm.match(/^title:\s*"?([^"\n]+)"?\s*$/m);

  if (!titleMatch) return null;

  const title = titleMatch[1].trim();
  const domainMatch = fm.match(/^domain:\s*\[([^\]]*)\]\s*$/m);
  const domain = domainMatch
    ? domainMatch[1]
        .split(",")
        .map((d) => d.trim())
        .filter((d) => d.length > 0)
    : [];

  return { title, domain };
}

// ─── Internal: Load Index ───────────────────────────────────────────────────

/** Directories to scan for wiki pages. */
const WIKI_PAGE_DIRS = ["entities", "concepts"] as const;

function scanDirectory(
  deps: WikiContextInjectorDeps,
  dirName: string,
  pages: Record<string, { title: string; domain: string[]; summary: string }>,
): void {
  const dir = join(deps.wikiDir, dirName);
  const dirResult = deps.readDir(dir);
  if (!dirResult.ok) {
    deps.stderr(
      `[WikiContextInjector] Cannot read wiki ${dirName} dir: ${dirResult.error.message}`,
    );
    return;
  }

  for (const filename of dirResult.value) {
    if (!filename.endsWith(".md")) continue;

    const filePath = join(dir, filename);
    const contentResult = deps.readFile(filePath);
    if (!contentResult.ok) continue;

    const content = contentResult.value;
    const fm = parseFrontmatter(content);
    if (!fm) continue;

    // Entities require domain tags; concepts use title as implicit domain
    const domain = fm.domain.length > 0 ? fm.domain : [fm.title.toLowerCase().replace(/\s+/g, "-")];

    const summary = extractSummary(content);
    if (!summary) continue;

    pages[`${dirName}/${filename}`] = {
      title: fm.title,
      domain,
      summary,
    };
  }
}

function loadDomainIndex(deps: WikiContextInjectorDeps): DomainIndex {
  if (cachedIndex) return cachedIndex;

  const pages: Record<string, { title: string; domain: string[]; summary: string }> = {};
  for (const dirName of WIKI_PAGE_DIRS) {
    scanDirectory(deps, dirName, pages);
  }

  cachedIndex = buildDomainIndex(pages);
  return cachedIndex;
}

/** Set of file paths already injected this session — prevents duplicate injection. */
let injectedPaths: Set<string> = new Set();

/** Reset cached index and dedup set — exposed for testing only. */
export function _resetCache(): void {
  cachedIndex = null;
  injectedPaths = new Set();
}

// ─── Internal: Metrics ─────────────────────────────────────────────────────

const METRICS_FILE = ".pipeline/metrics.jsonl";

function recordInjectionMetric(
  deps: WikiContextInjectorDeps,
  sessionId: string,
  filePath: string,
  matchedPages: string[],
): void {
  const record = {
    type: "injection",
    session_id: sessionId,
    file_path: filePath,
    matched_pages: matchedPages,
    timestamp: new Date().toISOString(),
  };
  const metricsPath = join(deps.wikiDir, METRICS_FILE);
  const result = deps.appendFile(metricsPath, `${JSON.stringify(record)}\n`);
  if (!result.ok) {
    deps.stderr(`[WikiContextInjector] failed to write metric: ${result.error.message}`);
  }
}

// ─── Contract ───────────────────────────────────────────────────────────────

const defaultDeps: WikiContextInjectorDeps = {
  readDir,
  readFile,
  appendFile,
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

    // Dedup: skip if we already injected context for this exact file path
    if (injectedPaths.has(filePath)) return ok(continueOk());

    const index = loadDomainIndex(deps);
    const matches = matchDomain(filePath, index);

    if (!matches || matches.length === 0) return ok(continueOk());

    // Mark as injected to prevent duplicate injection on same file
    injectedPaths.add(filePath);

    const contextParts = matches.map((m) => `[Wiki: ${m.title}] ${m.summary}`);
    const contextText = `Wiki context for this file's domain:\n${contextParts.join("\n")}`;

    // Record injection metric
    recordInjectionMetric(
      deps,
      input.session_id,
      filePath,
      matches.map((m) => m.path),
    );

    return ok(continueOk(contextText));
  },

  defaultDeps,
};
