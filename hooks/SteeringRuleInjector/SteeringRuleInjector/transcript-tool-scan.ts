/**
 * Scan a transcript JSONL backwards to determine whether any of the listed
 * tool names was used by the assistant in the current turn (since the most
 * recent real user message).
 *
 * Used by SteeringRuleInjector to gate `depends-on` rules.
 */

import { fileExists, readFile } from "@hooks/core/adapters/fs";
import { tryCatch } from "@hooks/core/result";

interface ContentBlock {
  type: string;
  name?: string;
}

interface TranscriptEntry {
  type: "user" | "assistant";
  message?: {
    content?: string | ContentBlock[];
  };
}

function isRealUserMessage(entry: TranscriptEntry): boolean {
  if (entry.type !== "user") return false;
  const content = entry.message?.content;
  if (typeof content === "string") return true;
  return Array.isArray(content) && content[0]?.type === "text";
}

function parseEntry(line: string): TranscriptEntry | null {
  const result = tryCatch(
    () => JSON.parse(line) as TranscriptEntry,
    () => null,
  );
  return result.ok ? result.value : null;
}

export function transcriptHasToolCall(
  transcriptPath: string | undefined,
  toolNames: string[],
): boolean {
  if (!transcriptPath || toolNames.length === 0) return false;
  if (!fileExists(transcriptPath)) return false;

  const result = readFile(transcriptPath);
  if (!result.ok) return false;

  const lines = result.value.split("\n").filter(Boolean);
  const targets = new Set(toolNames);

  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseEntry(lines[i]);
    if (!entry) continue;

    if (isRealUserMessage(entry)) return false;

    if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        if (block.type === "tool_use" && block.name && targets.has(block.name)) {
          return true;
        }
      }
    }
  }

  return false;
}
