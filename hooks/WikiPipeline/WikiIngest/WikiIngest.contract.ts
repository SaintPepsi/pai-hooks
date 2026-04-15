/**
 * WikiIngest Contract — Auto-ingest session knowledge into the wiki at session end.
 *
 * Runs the Filter -> Extract -> Seed pipeline automatically after each session.
 * Gates: size check (<5KB skip), wiki-only guard, dedup check.
 * Calls pipeline tools via shell (they live in MEMORY/WIKI/.pipeline/).
 * Always returns silent no-op ({}) — never blocks session end.
 */

import { basename, join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import {
  appendFile,
  ensureDir,
  fileExists,
  readDir,
  readFile,
  stat,
} from "@hooks/core/adapters/fs";
import { safeJsonParse } from "@hooks/core/adapters/json";
import { exec } from "@hooks/core/adapters/process";
import type { AsyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";
import { getISOTimestamp } from "@hooks/lib/time";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FilterResultJson {
  sessionId: string;
  classification: string;
  digestPath: string | null;
  messageCount: number;
  keptMessageCount: number;
  decisionsFound: number;
  entitiesFound: string[];
  confidence: string;
}

export interface ExtractionJson {
  sessionId: string;
  entities: Array<{ name: string; type: string; description: string }>;
  decisions: string[];
  concepts: Array<{ name: string; description: string }>;
  confidence: string;
  skipReason?: string;
  cost: { inputTokens: number; outputTokens: number; totalCost: number };
}

export interface AuditEntry {
  session_id: string;
  timestamp: string;
  classification: string;
  extractionCost: number;
  pagesCreated: number;
  skipped?: boolean;
  skipReason?: string;
}

export interface WikiIngestDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, ResultError>;
  readDir: (path: string) => Result<string[], ResultError>;
  appendFile: (path: string, content: string) => Result<void, ResultError>;
  ensureDir: (path: string) => Result<void, ResultError>;
  stat: (path: string) => Result<{ mtimeMs: number }, ResultError>;
  exec: (
    cmd: string,
    opts?: { timeout?: number; cwd?: string },
  ) => Promise<Result<{ stdout: string; stderr: string; exitCode: number }, ResultError>>;
  getTimestamp: () => string;
  baseDir: string;
  pipelineDir: string;
  stderr: (msg: string) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SIZE_GATE_BYTES = 5 * 1024; // 5KB minimum
const WIKI_PATH_MARKER = "MEMORY/WIKI/";

// ─── Pure Logic ─────────────────────────────────────────────────────────────

/**
 * Find the session transcript JSONL. Prefers input.transcript_path if present,
 * otherwise searches the Claude projects directory for a matching session ID.
 */
export function findTranscriptPath(input: SessionEndInput, deps: WikiIngestDeps): string | null {
  if (input.transcript_path && deps.fileExists(input.transcript_path)) {
    return input.transcript_path;
  }

  // Search common transcript locations
  const projectsDir = join(deps.baseDir, "projects");
  const dirResult = deps.readDir(projectsDir);
  if (!dirResult.ok) return null;

  for (const project of dirResult.value) {
    const sessionPath = join(projectsDir, project, `${input.session_id}.jsonl`);
    if (deps.fileExists(sessionPath)) return sessionPath;
  }

  return null;
}

/**
 * Quick-scan transcript content to detect wiki-only sessions.
 * If the ONLY files touched are under MEMORY/WIKI/, skip ingestion
 * to avoid circular self-referencing.
 */
export function isWikiOnlySession(content: string): boolean {
  // Look for file paths in Edit/Write/Read tool calls
  const filePathPattern = /(?:file_path|path)"?\s*[:=]\s*"?([^\s"',}]+)/g;
  const paths: string[] = [];

  let match = filePathPattern.exec(content);
  while (match !== null) {
    paths.push(match[1]);
    match = filePathPattern.exec(content);
  }

  if (paths.length === 0) return false;

  const nonWikiPaths = paths.filter((p) => !p.includes(WIKI_PATH_MARKER));
  return nonWikiPaths.length === 0;
}

/**
 * Check if this session has already been extracted.
 */
export function hasExistingExtraction(sessionId: string, deps: WikiIngestDeps): boolean {
  const extractionPath = join(deps.pipelineDir, "extractions", "haiku", `${sessionId}.json`);
  return deps.fileExists(extractionPath);
}

/**
 * Parse JSON output from filter.ts CLI.
 */
export function parseFilterOutput(stdout: string): FilterResultJson | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return null;
  const parseResult = safeJsonParse(trimmed);
  if (!parseResult.ok) return null;
  const result = parseResult.value;
  if (typeof result.sessionId !== "string") return null;
  if (typeof result.classification !== "string") return null;
  if (result.digestPath !== null && typeof result.digestPath !== "string") return null;
  if (typeof result.messageCount !== "number") return null;
  if (typeof result.keptMessageCount !== "number") return null;
  if (typeof result.decisionsFound !== "number") return null;
  if (!Array.isArray(result.entitiesFound)) return null;
  if (typeof result.confidence !== "string") return null;
  return result as unknown as FilterResultJson;
}

/**
 * Parse JSON extraction file.
 */
export function parseExtractionFile(content: string): ExtractionJson | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  const parseResult = safeJsonParse(trimmed);
  if (!parseResult.ok) return null;
  const result = parseResult.value;
  if (typeof result.sessionId !== "string") return null;
  if (!Array.isArray(result.entities)) return null;
  if (!Array.isArray(result.decisions)) return null;
  if (!Array.isArray(result.concepts)) return null;
  if (typeof result.confidence !== "string") return null;
  if (typeof result.cost !== "object" || result.cost === null) return null;
  const cost = result.cost as Record<string, unknown>;
  if (typeof cost.inputTokens !== "number") return null;
  if (typeof cost.outputTokens !== "number") return null;
  if (typeof cost.totalCost !== "number") return null;
  return result as unknown as ExtractionJson;
}

/**
 * Count pages that would be created from an extraction (entities + concepts
 * that don't already have wiki pages).
 */
export function countNewPages(extraction: ExtractionJson, deps: WikiIngestDeps): number {
  let count = 0;
  const wikiDir = join(deps.baseDir, "MEMORY", "WIKI");

  for (const entity of extraction.entities) {
    const slug = entity.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const pagePath = join(wikiDir, "entities", `${slug}.md`);
    if (!deps.fileExists(pagePath)) count++;
  }

  for (const concept of extraction.concepts) {
    const slug = concept.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const pagePath = join(wikiDir, "concepts", `${slug}.md`);
    if (!deps.fileExists(pagePath)) count++;
  }

  return count;
}

/**
 * Write an audit trail entry.
 */
function writeAuditEntry(entry: AuditEntry, deps: WikiIngestDeps): void {
  const auditPath = join(deps.pipelineDir, "audit.jsonl");
  deps.ensureDir(deps.pipelineDir);
  deps.appendFile(auditPath, `${JSON.stringify(entry)}\n`);
}

/**
 * Append a human-readable entry to log.md.
 */
function writeLogEntry(
  sessionId: string,
  classification: string,
  pagesCreated: number,
  extractionCost: number,
  deps: WikiIngestDeps,
  skipped?: boolean,
  skipReason?: string,
): void {
  const date = deps.getTimestamp().slice(0, 10);
  const shortId = sessionId.slice(0, 8);
  const description = skipped
    ? `session ${shortId} — skipped: ${skipReason}`
    : `session ${shortId} — ${classification}, ${pagesCreated} pages, $${extractionCost.toFixed(4)}`;
  const logPath = join(deps.baseDir, "MEMORY", "WIKI", "log.md");
  deps.appendFile(logPath, `## [${date}] ingest | ${description}\n`);
}

/**
 * Get the current extraction counter from audit.jsonl line count.
 */
function getExtractionCount(deps: WikiIngestDeps): number {
  const auditPath = join(deps.pipelineDir, "audit.jsonl");
  const result = deps.readFile(auditPath);
  if (!result.ok) return 0;
  return result.value
    .trim()
    .split("\n")
    .filter((l) => l.trim()).length;
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: WikiIngestDeps = {
  fileExists,
  readFile,
  readDir: (path: string) => {
    const result = readDir(path);
    if (!result.ok) return result;
    return {
      ok: true,
      value: result.value.map((e) =>
        typeof e === "string" ? e : ((e as { name?: string }).name ?? ""),
      ),
    } as Result<string[], ResultError>;
  },
  appendFile,
  ensureDir,
  stat,
  exec,
  getTimestamp: getISOTimestamp,
  get baseDir() {
    return getPaiDir();
  },
  get pipelineDir() {
    return join(this.baseDir, "MEMORY", "WIKI", ".pipeline");
  },
  stderr: defaultStderr,
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const WikiIngest: AsyncHookContract<SessionEndInput, WikiIngestDeps> = {
  name: "WikiIngest",
  event: "SessionEnd",

  accepts(_input: SessionEndInput): boolean {
    return true;
  },

  async execute(
    input: SessionEndInput,
    deps: WikiIngestDeps,
  ): Promise<Result<SyncHookJSONOutput, ResultError>> {
    const sessionId = input.session_id;
    if (!sessionId) {
      deps.stderr("[WikiIngest] No session_id, skipping");
      return ok({});
    }

    // 1. Find transcript
    const transcriptPath = findTranscriptPath(input, deps);
    if (!transcriptPath) {
      deps.stderr("[WikiIngest] No transcript found, skipping");
      return ok({});
    }

    // 2. Size gate — read transcript to check byte length
    const contentResult = deps.readFile(transcriptPath);
    if (!contentResult.ok) {
      deps.stderr(`[WikiIngest] Cannot read transcript: ${contentResult.error.message}`);
      return ok({});
    }

    const fileSizeBytes = Buffer.byteLength(contentResult.value, "utf-8");
    if (fileSizeBytes < SIZE_GATE_BYTES) {
      deps.stderr(
        `[WikiIngest] Session too small (${fileSizeBytes}B < ${SIZE_GATE_BYTES}B), skipping`,
      );
      return ok({});
    }

    // 3. Wiki-only guard
    if (isWikiOnlySession(contentResult.value)) {
      deps.stderr("[WikiIngest] Wiki-only session detected, skipping self-reference");
      return ok({});
    }

    // 4. Dedup check
    if (hasExistingExtraction(sessionId, deps)) {
      deps.stderr(`[WikiIngest] Session ${sessionId} already extracted, skipping`);
      return ok({});
    }

    // 5. Filter — run pipeline filter tool
    const digestsDir = join(deps.pipelineDir, "digests");
    const filterCmd = `bun "${join(deps.pipelineDir, "tools", "filter.ts")}" "${transcriptPath}" "${digestsDir}"`;
    const filterResult = await deps.exec(filterCmd, { timeout: 30000 });

    if (!filterResult.ok) {
      deps.stderr(`[WikiIngest] Filter exec failed: ${filterResult.error.message}`);
      return ok({});
    }

    if (filterResult.value.exitCode !== 0) {
      deps.stderr(
        `[WikiIngest] Filter failed (exit ${filterResult.value.exitCode}): ${filterResult.value.stderr}`,
      );
      return ok({});
    }

    const filterOutput = parseFilterOutput(filterResult.value.stdout);
    if (!filterOutput?.digestPath) {
      deps.stderr(
        "[WikiIngest] Filter produced no digest (session likely classified as skip/low-value)",
      );
      writeAuditEntry(
        {
          session_id: sessionId,
          timestamp: deps.getTimestamp(),
          classification: filterOutput?.classification || "unknown",
          extractionCost: 0,
          pagesCreated: 0,
          skipped: true,
          skipReason: "no digest produced",
        },
        deps,
      );
      writeLogEntry(
        sessionId,
        filterOutput?.classification || "unknown",
        0,
        0,
        deps,
        true,
        "no digest produced",
      );
      return ok({});
    }

    deps.stderr(
      `[WikiIngest] Filter complete: ${filterOutput.classification}, ${filterOutput.keptMessageCount} messages kept`,
    );

    // 6. Extract — run pipeline extract tool via Claude CLI
    const extractionsDir = join(deps.pipelineDir, "extractions", "haiku");
    const extractCmd = `bun "${join(deps.pipelineDir, "tools", "extract.ts")}" "${filterOutput.digestPath}" "${extractionsDir}"`;
    const extractResult = await deps.exec(extractCmd, { timeout: 120000 });

    if (!extractResult.ok) {
      deps.stderr(`[WikiIngest] Extract exec failed: ${extractResult.error.message}`);
      writeAuditEntry(
        {
          session_id: sessionId,
          timestamp: deps.getTimestamp(),
          classification: filterOutput.classification,
          extractionCost: 0,
          pagesCreated: 0,
          skipped: true,
          skipReason: "extract exec failed",
        },
        deps,
      );
      writeLogEntry(
        sessionId,
        filterOutput.classification,
        0,
        0,
        deps,
        true,
        "extract exec failed",
      );
      return ok({});
    }

    if (extractResult.value.exitCode !== 0) {
      deps.stderr(
        `[WikiIngest] Extract failed (exit ${extractResult.value.exitCode}): ${extractResult.value.stderr}`,
      );
      writeAuditEntry(
        {
          session_id: sessionId,
          timestamp: deps.getTimestamp(),
          classification: filterOutput.classification,
          extractionCost: 0,
          pagesCreated: 0,
          skipped: true,
          skipReason: `extract exit ${extractResult.value.exitCode}`,
        },
        deps,
      );
      writeLogEntry(
        sessionId,
        filterOutput.classification,
        0,
        0,
        deps,
        true,
        `extract exit ${extractResult.value.exitCode}`,
      );
      return ok({});
    }

    deps.stderr("[WikiIngest] Extraction complete");

    // 7. Seed — read extraction and create wiki pages
    const extractionFilePath = join(
      extractionsDir,
      `${basename(filterOutput.digestPath, ".md")}.json`,
    );
    const extractionContent = deps.readFile(extractionFilePath);
    let pagesCreated = 0;
    let extractionCost = 0;

    if (extractionContent.ok) {
      const extraction = parseExtractionFile(extractionContent.value);
      if (extraction && !extraction.skipReason) {
        extractionCost = extraction.cost?.totalCost || 0;
        pagesCreated = countNewPages(extraction, deps);

        if (pagesCreated > 0) {
          // Run seed tool to actually create the pages
          const seedCmd = `bun "${join(deps.pipelineDir, "tools", "seed.ts")}" "${extractionsDir}"`;
          const seedResult = await deps.exec(seedCmd, { timeout: 30000 });
          if (seedResult.ok && seedResult.value.exitCode === 0) {
            deps.stderr(`[WikiIngest] Seeded ${pagesCreated} new wiki pages`);
          } else {
            deps.stderr("[WikiIngest] Seed step failed (non-critical)");
            pagesCreated = 0;
          }
        }
      } else if (extraction?.skipReason) {
        deps.stderr(`[WikiIngest] Extraction skipped: ${extraction.skipReason}`);
      }
    }

    // 8. Audit trail + operation log
    writeAuditEntry(
      {
        session_id: sessionId,
        timestamp: deps.getTimestamp(),
        classification: filterOutput.classification,
        extractionCost,
        pagesCreated,
      },
      deps,
    );
    writeLogEntry(sessionId, filterOutput.classification, pagesCreated, extractionCost, deps);

    // 9. Counter milestone logging
    const totalExtractions = getExtractionCount(deps);
    if (totalExtractions > 0 && totalExtractions % 50 === 0) {
      deps.stderr(`[WikiIngest] Milestone: ${totalExtractions} sessions ingested into wiki`);
    }

    deps.stderr(
      `[WikiIngest] Done — ${filterOutput.classification}, cost $${extractionCost.toFixed(4)}, ${pagesCreated} pages`,
    );
    return ok({});
  },

  defaultDeps,
};
