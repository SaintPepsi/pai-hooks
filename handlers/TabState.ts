/**
 * TabState.ts - Response completion title extraction.
 *
 * Previously updated Kitty terminal tab title on response completion.
 * Kitty dependency removed (#56) — title extraction logic retained
 * for potential future use, but no tab commands are issued.
 */

import { getDAName } from "@hooks/lib/identity";
import { gerundToPastTense, isValidCompletionTitle } from "@hooks/lib/output-validators";
import type { ParsedTranscript } from "@pai/Tools/TranscriptParser";

/**
 * Extract tab title from voice line. Takes first sentence, caps at 4 words.
 * If first sentence is too short (1 word like "Fixed."), combines with next words.
 * Validates with isValidCompletionTitle. Returns null if invalid.
 */
function extractTabTitle(voiceLine: string): string | null {
  if (!voiceLine || voiceLine.length < 3) return null;

  const daName = getDAName();
  const daPattern = new RegExp(`^${daName}:\\s*`, "i");

  const cleaned = voiceLine
    .replace(/^🗣️\s*/, "")
    .replace(daPattern, "")
    .replace(/^(Done\.?\s*)/i, "")
    .replace(/^(I've\s+|I\s+)/i, "")
    .trim();

  if (!cleaned || cleaned.length < 3) return null;

  // Split on sentence boundaries
  const sentences = cleaned.split(/\.\s/);
  let firstSentence = sentences[0].replace(/\.$/, "").trim();

  // If first sentence is just 1 word (e.g., "Fixed"), grab more content
  const firstWords = firstSentence.split(/\s+/);
  if (firstWords.length === 1 && sentences.length > 1) {
    const nextWords = sentences[1].split(/\s+/).slice(0, 3);
    firstSentence = `${firstWords[0]} ${nextWords.join(" ")}`;
  }

  const words = firstSentence.split(/\s+/).slice(0, 4);

  if (words.length === 0) return null;

  let result = words
    .join(" ")
    .replace(/[,;:!?\-\u2014]+$/, "")
    .trim();
  if (!result.endsWith(".")) result += ".";

  if (!isValidCompletionTitle(result)) return null;
  return result;
}

/**
 * Extract a completion title from the response content.
 * Tries TASK line, then SUMMARY section as fallback when voice line is absent.
 * Returns null if no valid title can be extracted.
 */
function extractFromResponseContent(responseText: string): string | null {
  if (!responseText || responseText.length < 10) return null;

  // Strategy 1: Extract from 🗒️ TASK: line (e.g., "Fix broken tab title update system")
  const taskMatch = responseText.match(/🗒️\s*TASK:\s*(.+?)(?:\n|$)/i);
  if (taskMatch?.[1]) {
    const taskDesc = taskMatch[1].trim();
    const words = taskDesc.split(/\s+/);
    if (words.length >= 2) {
      const firstLower = words[0].toLowerCase();
      const pastMap: Record<string, string> = {
        fix: "Fixed",
        update: "Updated",
        add: "Added",
        remove: "Removed",
        create: "Created",
        build: "Built",
        deploy: "Deployed",
        debug: "Debugged",
        test: "Tested",
        review: "Reviewed",
        refactor: "Refactored",
        implement: "Implemented",
        write: "Wrote",
        find: "Found",
        install: "Installed",
        configure: "Configured",
        run: "Ran",
        check: "Checked",
        clean: "Cleaned",
        merge: "Merged",
        change: "Changed",
        improve: "Improved",
        optimize: "Optimized",
        analyze: "Analyzed",
        research: "Researched",
        investigate: "Investigated",
        design: "Designed",
        push: "Pushed",
        pull: "Pulled",
        commit: "Committed",
        move: "Moved",
        rename: "Renamed",
        delete: "Deleted",
        start: "Started",
        stop: "Stopped",
        restart: "Restarted",
        set: "Set",
        get: "Got",
        make: "Made",
        show: "Showed",
        list: "Listed",
        search: "Searched",
        explain: "Explained",
        modify: "Modified",
      };
      const past = pastMap[firstLower];
      if (past) {
        const rest = words.slice(1, 3).join(" ");
        const candidate = `${past} ${rest}.`;
        if (isValidCompletionTitle(candidate)) return candidate;
      }
    }
  }

  // Strategy 2: Extract from 📋 SUMMARY: line
  const summaryMatch = responseText.match(/📋\s*SUMMARY:\s*(.+?)(?:\n|$)/i);
  if (summaryMatch?.[1]) {
    const summary = summaryMatch[1].trim().replace(/^\[?\d+\s*bullets?\]?\s*/i, "");
    const words = summary.split(/\s+/).slice(0, 4);
    if (words.length >= 2) {
      let candidate = words
        .join(" ")
        .replace(/[,;:!?\-\u2014]+$/, "")
        .trim();
      if (!candidate.endsWith(".")) candidate += ".";
      if (isValidCompletionTitle(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Handle tab state update with pre-parsed transcript data.
 * No-op since kitty tab management was removed (#56).
 */
export async function handleTabState(parsed: ParsedTranscript, sessionId?: string): Promise<void> {
  if (parsed.responseState === "awaitingInput") return;

  // Title extraction retained for logging/debugging purposes
  let shortTitle: string | null = null;

  if (!shortTitle) {
    shortTitle = extractTabTitle(parsed.plainCompletion);
  }

  if (!shortTitle) {
    shortTitle = extractFromResponseContent(parsed.currentResponseText);
  }

  console.error(
    `[TabState] session=${sessionId ?? "none"} title="${shortTitle || "(none)"}" (tab commands removed)`,
  );
}
