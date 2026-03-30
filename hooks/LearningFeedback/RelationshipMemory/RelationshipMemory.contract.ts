/**
 * RelationshipMemory Contract — Extract relationship notes from sessions.
 *
 * Analyzes session transcripts for preferences, frustrations, milestones,
 * and appends structured notes to the daily relationship log.
 */

import { join } from "node:path";
import { appendFile, ensureDir, fileExists, readFile, writeFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import { jsonParseFailed, type PaiError } from "@hooks/core/error";
import { ok, type Result, tryCatch } from "@hooks/core/result";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { getDAName, getPrincipalName } from "@hooks/lib/identity";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";
import { getLocalComponents } from "@hooks/lib/time";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TranscriptEntry {
  type: "user" | "assistant";
  message?: { content: string | Array<{ type: string; text?: string }> };
}

interface RelationshipNote {
  type: "W" | "B" | "O";
  entities: string[];
  content: string;
  confidence?: number;
}

export interface RelationshipMemoryDeps {
  readTranscript: (path: string) => TranscriptEntry[];
  analyzeForRelationship: (entries: TranscriptEntry[]) => RelationshipNote[];
  writeNotes: (notes: RelationshipNote[]) => void;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

function extractText(entry: TranscriptEntry): string {
  if (!entry.message?.content) return "";
  if (typeof entry.message.content === "string") return entry.message.content;
  if (Array.isArray(entry.message.content)) {
    return entry.message.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join(" ");
  }
  return "";
}

export function safeParseTranscriptLine(line: string): TranscriptEntry | null {
  if (!line.trim()) return null;
  const firstBrace = line.indexOf("{");
  if (firstBrace === -1) return null;
  const trimmed = line.slice(firstBrace);
  if (!trimmed.startsWith("{")) return null;
  // Quick structural check before attempting parse
  if (!trimmed.includes('"type"')) return null;
  const parseResult = tryCatch(
    () => JSON.parse(trimmed) as Record<string, unknown>,
    (e) => jsonParseFailed(trimmed, e),
  );
  if (!parseResult.ok) return null;
  const parsed = parseResult.value;
  if (parsed.type !== "user" && parsed.type !== "assistant") return null;
  return parsed as unknown as TranscriptEntry;
}

function defaultReadTranscript(path: string): TranscriptEntry[] {
  if (!path || !fileExists(path)) return [];
  const result = readFile(path);
  if (!result.ok) return [];
  const entries: TranscriptEntry[] = [];
  for (const line of result.value.trim().split("\n")) {
    const entry = safeParseTranscriptLine(line);
    if (entry) entries.push(entry);
  }
  return entries;
}

function defaultAnalyzeForRelationship(entries: TranscriptEntry[]): RelationshipNote[] {
  const notes: RelationshipNote[] = [];
  const patterns = {
    preference: /(?:prefer|like|want|appreciate|enjoy|love|hate|dislike)\s+(?:when|that|to)/i,
    frustration: /(?:frustrat|annoy|bother|irritat)/i,
    positive: /(?:great|awesome|perfect|excellent|good job|well done|nice)/i,
    milestone: /(?:first time|finally|breakthrough|success|accomplish)/i,
  };

  const sessionSummary: string[] = [];
  let frustrations = 0;
  let positives = 0;

  for (const entry of entries) {
    const text = extractText(entry);
    if (!text || text.length < 10) continue;

    if (entry.type === "user") {
      if (patterns.frustration.test(text)) frustrations++;
      if (patterns.positive.test(text)) positives++;
    }

    if (entry.type === "assistant") {
      const summaryMatch = text.match(/SUMMARY:\s*([^\n]+)/i);
      if (summaryMatch) sessionSummary.push(summaryMatch[1].trim());

      if (patterns.milestone.test(text)) {
        const snippet = text.match(/[^.]*(?:first time|finally|breakthrough|success)[^.]*/i)?.[0];
        if (snippet) sessionSummary.push(snippet.trim());
      }
    }
  }

  if (sessionSummary.length > 0) {
    for (const summary of [...new Set(sessionSummary)].slice(0, 3)) {
      notes.push({ type: "B", entities: [`@${getDAName()}`], content: summary });
    }
  }

  if (positives >= 2) {
    notes.push({
      type: "O",
      entities: [`@${getPrincipalName()}`],
      content: "Responded positively to this session's approach",
      confidence: 0.7,
    });
  }

  if (frustrations >= 2) {
    notes.push({
      type: "O",
      entities: [`@${getPrincipalName()}`],
      content: "Experienced frustration during this session (likely tooling-related)",
      confidence: 0.75,
    });
  }

  return notes;
}

function defaultWriteNotes(notes: RelationshipNote[]): void {
  if (notes.length === 0) return;

  const paiDir = getPaiDir();
  const { year, month, day, hours, minutes } = getLocalComponents();
  const monthDir = join(paiDir, "MEMORY", "RELATIONSHIP", `${year}-${month}`);
  ensureDir(monthDir);

  const filepath = join(monthDir, `${year}-${month}-${day}.md`);
  if (!fileExists(filepath)) {
    writeFile(
      filepath,
      `# Relationship Notes: ${year}-${month}-${day}\n\n*Auto-captured from sessions. Manual additions welcome.*\n\n---\n`,
    );
  }

  const lines: string[] = [`\n## ${hours}:${minutes} PST\n`];
  for (const note of notes) {
    const entities = note.entities.join(" ");
    const confidence = note.confidence ? `(c=${note.confidence.toFixed(2)})` : "";
    lines.push(`- ${note.type}${confidence} ${entities}: ${note.content}`);
  }

  appendFile(filepath, `${lines.join("\n")}\n`);
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: RelationshipMemoryDeps = {
  readTranscript: defaultReadTranscript,
  analyzeForRelationship: defaultAnalyzeForRelationship,
  writeNotes: defaultWriteNotes,
  stderr: defaultStderr,
};

export const RelationshipMemory: SyncHookContract<StopInput, SilentOutput, RelationshipMemoryDeps> =
  {
    name: "RelationshipMemory",
    event: "Stop",

    accepts(input: StopInput): boolean {
      return !!input.transcript_path;
    },

    execute(input: StopInput, deps: RelationshipMemoryDeps): Result<SilentOutput, PaiError> {
      const entries = deps.readTranscript(input.transcript_path!);
      if (entries.length === 0) {
        deps.stderr("[RelationshipMemory] No transcript entries, skipping");
        return ok({ type: "silent" });
      }

      deps.stderr(`[RelationshipMemory] Analyzing ${entries.length} transcript entries`);

      const notes = deps.analyzeForRelationship(entries);
      if (notes.length === 0) {
        deps.stderr("[RelationshipMemory] No relationship notes to capture");
        return ok({ type: "silent" });
      }

      deps.writeNotes(notes);
      deps.stderr(`[RelationshipMemory] Captured ${notes.length} notes`);

      return ok({ type: "silent" });
    },

    defaultDeps,
  };
