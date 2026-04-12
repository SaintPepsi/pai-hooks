/**
 * LastResponseCache Contract — Cache last assistant response for RatingCapture.
 *
 * On Stop, reads the last assistant message from the transcript and writes it
 * to MEMORY/STATE/last-response.txt (truncated to 2000 chars). RatingCapture
 * (UserPromptSubmit) reads this file to get context on the previous response.
 *
 * Always returns silent no-op (`{}`) — never blocks or delays the Stop event.
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result, tryCatch } from "@hooks/core/result";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LastResponseCacheDeps {
  readFile: (path: string) => Result<string, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  stderr: (msg: string) => void;
  baseDir: string;
}

// ─── Transcript Parsing ──────────────────────────────────────────────────────

interface ContentBlock {
  type: string;
  text?: string;
}

interface TranscriptEntry {
  type?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
}

/** Extract plain text from a transcript message's content field. */
function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join(" ");
}

/**
 * Parse the transcript JSONL and return the last assistant message text.
 * Returns empty string if the transcript is missing, unreadable, or has no
 * assistant turns.
 */
function extractLastAssistantMessage(transcriptPath: string, deps: LastResponseCacheDeps): string {
  const readResult = deps.readFile(transcriptPath);
  if (!readResult.ok) {
    deps.stderr(`[LastResponseCache] Could not read transcript: ${readResult.error.message}`);
    return "";
  }

  let lastAssistant = "";

  for (const line of readResult.value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parseResult = tryCatch(
      () => JSON.parse(trimmed) as TranscriptEntry,
      () => null,
    );
    if (!parseResult.ok || !parseResult.value) continue;
    const entry = parseResult.value;

    if (entry.type === "assistant" && entry.message?.content) {
      const text = extractText(entry.message.content);
      if (text.trim()) lastAssistant = text;
    }
  }

  return lastAssistant;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: LastResponseCacheDeps = {
  readFile,
  writeFile,
  stderr: defaultStderr,
  baseDir: getPaiDir(),
};

export const LastResponseCache: SyncHookContract<StopInput, LastResponseCacheDeps> = {
  name: "LastResponseCache",
  event: "Stop",

  accepts(input: StopInput): boolean {
    return !!input.transcript_path;
  },

  execute(input: StopInput, deps: LastResponseCacheDeps): Result<SyncHookJSONOutput, ResultError> {
    const lastResponse = extractLastAssistantMessage(input.transcript_path!, deps);

    if (!lastResponse) {
      deps.stderr("[LastResponseCache] No assistant message found in transcript");
      return ok({});
    }

    const cachePath = join(deps.baseDir, "MEMORY", "STATE", "last-response.txt");
    const writeResult = deps.writeFile(cachePath, lastResponse.slice(0, 2000));

    if (!writeResult.ok) {
      deps.stderr(`[LastResponseCache] Failed to write cache: ${writeResult.error.message}`);
    }

    return ok({});
  },

  defaultDeps,
};
