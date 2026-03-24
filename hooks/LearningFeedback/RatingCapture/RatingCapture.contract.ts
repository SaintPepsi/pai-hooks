/**
 * RatingCapture Contract — Unified Rating & Sentiment Capture.
 *
 * Two responsibilities:
 * 1. Immediate: Output algorithm format reminder (ContextOutput)
 * 2. Async: Parse explicit ratings or run implicit sentiment analysis
 *
 * The contract returns ContextOutput for the algorithm reminder.
 * Rating/sentiment writes happen as side effects via deps.
 */

import type { HookContract, AsyncHookContract } from "@hooks/core/contract";
import type { UserPromptSubmitInput } from "@hooks/core/types/hook-inputs";
import type { ContextOutput } from "@hooks/core/types/hook-outputs";
import { ok, tryCatch, tryCatchAsync, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { fileExists, readFile, writeFile, appendFile, ensureDir } from "@hooks/core/adapters/fs";
import { join } from "path";
import { inference, type InferenceResult } from "@pai/Tools/Inference";
import { getIdentity, getPrincipal, getPrincipalName } from "@hooks/lib/identity";
import { getLearningCategory } from "@hooks/lib/learning-utils";
import { getISOTimestamp, getLocalComponents } from "@hooks/lib/time";
import { captureFailure } from "@pai/Tools/FailureCapture";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RatingEntry {
  timestamp: string;
  rating: number;
  session_id: string;
  comment?: string;
  source?: "implicit";
  sentiment_summary?: string;
  confidence?: number;
}

interface SentimentResult {
  rating: number | null;
  sentiment: "positive" | "negative" | "neutral";
  confidence: number;
  summary: string;
  detailed_context: string;
}

interface ContentBlock {
  type: string;
  text?: string;
}

interface TranscriptMessage {
  content?: string | ContentBlock[];
}

interface TranscriptEntry {
  type?: string;
  message?: TranscriptMessage;
}

export interface RatingCaptureDeps {
  inference: typeof inference;
  captureFailure: typeof captureFailure;
  getPrincipalName: typeof getPrincipalName;
  getPrincipal: typeof getPrincipal;
  getIdentity: typeof getIdentity;
  getLearningCategory: typeof getLearningCategory;
  getISOTimestamp: typeof getISOTimestamp;
  getLocalComponents: typeof getLocalComponents;
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, PaiError>;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  appendFile: (path: string, content: string) => Result<void, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  spawnTrending: () => void;
  readAlgoVersion: () => string;
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

const MIN_PROMPT_LENGTH = 3;
const MIN_CONFIDENCE = 0.5;

export function parseExplicitRating(prompt: string): { rating: number; comment?: string } | null {
  const trimmed = prompt.trim();
  const ratingPattern = /^(10|[1-9])(?:\s*[-:]\s*|\s+)?(.*)$/;
  const match = trimmed.match(ratingPattern);
  if (!match) return null;

  const rating = parseInt(match[1], 10);
  const comment = match[2]?.trim() || undefined;

  if (rating < 1 || rating > 10) return null;

  if (comment) {
    const sentenceStarters = /^(items?|things?|steps?|files?|lines?|bugs?|issues?|errors?|times?|minutes?|hours?|days?|seconds?|percent|%|th\b|st\b|nd\b|rd\b|of\b|in\b|at\b|to\b|the\b|a\b|an\b)/i;
    if (sentenceStarters.test(comment)) return null;
  }

  return { rating, comment };
}

function buildAlgorithmReminder(version: string): string {
  return `<user-prompt-submit-hook>
\u{1F6A8} ALGORITHM FORMAT REQUIRED - EVERY RESPONSE \u{1F6A8}

START WITH:
\u{267B}\u{FE0F} Entering the PAI ALGORITHM\u{2026} (${version} | github.com/danielmiessler/TheAlgorithm) \u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}\u{2550}

EXECUTE VOICE CURLS at each phase (OBSERVE, THINK, PLAN, BUILD, EXECUTE, VERIFY, LEARN)

USE TaskCreate for ISC criteria. USE TaskList to display them. NEVER manual tables.

END WITH:
\u{1F5E3}\u{FE0F} {DAIDENTITY.NAME}: [12-24 word spoken summary]

For MINIMAL tasks (pure greetings, ratings): Use abbreviated format but STILL include header and voice line.
</user-prompt-submit-hook>`;
}

function buildSentimentPrompt(principalName: string, assistantName: string): string {
  return `Analyze ${principalName}'s message for emotional sentiment toward ${assistantName} (the AI assistant).

CONTEXT: This is a personal AI system. ${principalName} is the ONLY user. Never say "users" - always "${principalName}."

OUTPUT FORMAT (JSON only):
{
  "rating": <1-10 or null>,
  "sentiment": "positive" | "negative" | "neutral",
  "confidence": <0.0-1.0>,
  "summary": "<brief explanation, 10 words max>",
  "detailed_context": "<comprehensive analysis for learning, 100-256 words>"
}

RATING SCALE:
- 1-2: Strong frustration, anger, disappointment with ${assistantName}
- 3-4: Mild frustration, dissatisfaction
- 5: Neutral (no strong sentiment)
- 6-7: Satisfaction, approval
- 8-9: Strong approval, impressed
- 10: Extraordinary enthusiasm, blown away

WHEN TO RETURN null FOR RATING:
- Neutral technical questions ("Can you check the logs?")
- Simple commands ("Do it", "Yes", "Continue")
- No emotional indicators present
- Emotion unrelated to ${assistantName}'s work`;
}

/** Parse a single JSONL line, returning null on invalid JSON. */
function parseJsonlEntry(line: string): TranscriptEntry | null {
  const result = tryCatch(
    () => JSON.parse(line) as TranscriptEntry,
    () => null,
  );
  return result.ok ? result.value : null;
}

/** Extract text content from a transcript message entry. */
function extractTextFromEntry(entry: TranscriptEntry): string {
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: ContentBlock) => c.type === "text")
      .map((c: ContentBlock) => c.text ?? "")
      .join(" ");
  }
  return "";
}

function getRecentContext(transcriptPath: string, deps: RatingCaptureDeps): string {
  if (!transcriptPath || !deps.fileExists(transcriptPath)) return "";

  const readResult = deps.readFile(transcriptPath);
  if (!readResult.ok) return "";

  const lines = readResult.value.trim().split("\n");
  const turns: { role: string; text: string }[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const entry = parseJsonlEntry(line);
    if (!entry) continue;

    if (entry.type === "user" && entry.message?.content) {
      const text = extractTextFromEntry(entry);
      if (text.trim()) turns.push({ role: "User", text: text.slice(0, 200) });
    }
    if (entry.type === "assistant" && entry.message?.content) {
      const text = extractTextFromEntry(entry);
      if (text) {
        const summaryMatch = text.match(/SUMMARY:\s*([^\n]+)/i);
        turns.push({ role: "Assistant", text: summaryMatch ? summaryMatch[1] : text.slice(0, 150) });
      }
    }
  }

  const recent = turns.slice(-3);
  return recent.length > 0 ? recent.map((t) => `${t.role}: ${t.text}`).join("\n") : "";
}

/** Extract the last assistant response context from a transcript file. */
function getLastAssistantContext(transcriptPath: string | undefined, deps: RatingCaptureDeps): string {
  if (!transcriptPath) return "";
  const txResult = deps.readFile(transcriptPath);
  if (!txResult.ok) return "";

  const lines = txResult.value.trim().split("\n");
  let lastAssistant = "";

  for (const line of lines) {
    const entry = parseJsonlEntry(line);
    if (!entry) continue;

    if (entry.type === "assistant" && entry.message?.content) {
      const text = extractTextFromEntry(entry);
      if (text) lastAssistant = text;
    }
  }

  const summaryMatch = lastAssistant.match(/SUMMARY:\s*([^\n]+)/i);
  return summaryMatch ? summaryMatch[1].trim() : lastAssistant.slice(0, 500);
}

// ─── Contract ────────────────────────────────────────────────────────────────

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, ".claude");

const defaultDeps: RatingCaptureDeps = {
  inference,
  captureFailure,
  getPrincipalName,
  getPrincipal,
  getIdentity,
  getLearningCategory,
  getISOTimestamp,
  getLocalComponents,
  fileExists,
  readFile,
  writeFile,
  appendFile,
  ensureDir,
  spawnTrending: () => {
    const script = join(BASE_DIR, "tools", "TrendingAnalysis.ts");
    if (fileExists(script)) {
      Bun.spawn(["bun", script, "--force"], { stdout: "ignore", stderr: "ignore" });
    }
  },
  readAlgoVersion: () => {
    const result = readFile(join(BASE_DIR, "PAI", "Algorithm", "LATEST"));
    return result.ok ? result.value.trim() : "v?.?.?";
  },
  baseDir: BASE_DIR,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const RatingCapture: AsyncHookContract<
  UserPromptSubmitInput,
  ContextOutput,
  RatingCaptureDeps
> = {
  name: "RatingCapture",
  event: "UserPromptSubmit",

  accepts(_input: UserPromptSubmitInput): boolean {
    return true;
  },

  async execute(
    input: UserPromptSubmitInput,
    deps: RatingCaptureDeps,
  ): Promise<Result<ContextOutput, PaiError>> {
    const prompt = input.prompt || input.user_prompt || "";
    const sessionId = input.session_id;
    const signalsDir = join(deps.baseDir, "MEMORY", "LEARNING", "SIGNALS");
    const ratingsFile = join(signalsDir, "ratings.jsonl");

    const algoVersion = deps.readAlgoVersion();
    const reminder = buildAlgorithmReminder(algoVersion);

    // Path 1: Explicit Rating
    const explicitResult = parseExplicitRating(prompt);
    if (explicitResult) {
      deps.stderr(`[RatingCapture] Explicit rating: ${explicitResult.rating}`);

      const entry: RatingEntry = {
        timestamp: deps.getISOTimestamp(),
        rating: explicitResult.rating,
        session_id: sessionId,
      };
      if (explicitResult.comment) entry.comment = explicitResult.comment;

      writeRating(entry, signalsDir, ratingsFile, deps);
      deps.spawnTrending();

      if (explicitResult.rating < 5) {
        const responseContext = getLastAssistantContext(input.transcript_path, deps);

        captureLowRatingLearning(explicitResult.rating, explicitResult.comment || "", responseContext, "explicit", deps);

        if (explicitResult.rating <= 3) {
          await deps.captureFailure({
            transcriptPath: input.transcript_path ?? "",
            rating: explicitResult.rating,
            sentimentSummary: explicitResult.comment || `Explicit low rating: ${explicitResult.rating}/10`,
            detailedContext: responseContext,
            sessionId,
          }).catch(() => {});
        }
      }

      return ok({ type: "context", content: reminder });
    }

    // Path 2: Implicit Sentiment
    if (prompt.length < MIN_PROMPT_LENGTH) {
      return ok({ type: "context", content: reminder });
    }

    const context = getRecentContext(input.transcript_path || "", deps);
    const principal = deps.getPrincipal();
    const identity = deps.getIdentity();
    const systemPrompt = buildSentimentPrompt(principal.name, identity.name);
    const userPrompt = context ? `CONTEXT:\n${context}\n\nCURRENT MESSAGE:\n${prompt}` : prompt;

    const inferenceResult = await tryCatchAsync<InferenceResult, null>(
      () => deps.inference({
        systemPrompt,
        userPrompt,
        expectJson: true,
        timeout: 12000,
        level: "fast",
      }),
      () => null,
    );

    if (inferenceResult.ok && inferenceResult.value?.success && inferenceResult.value.parsed) {
      const sentiment = inferenceResult.value.parsed as SentimentResult;

      // Null rating means no sentiment detected — skip recording
      if (sentiment.rating === null) {
        deps.stderr("[RatingCapture] Sentiment returned null rating, skipping");
        return ok({ type: "context", content: reminder });
      }

      if (sentiment.confidence < MIN_CONFIDENCE) {
        deps.stderr(`[RatingCapture] Confidence ${sentiment.confidence} below ${MIN_CONFIDENCE}, skipping`);
        return ok({ type: "context", content: reminder });
      }

      const entry: RatingEntry = {
        timestamp: deps.getISOTimestamp(),
        rating: sentiment.rating,
        session_id: sessionId,
        source: "implicit",
        sentiment_summary: sentiment.summary,
        confidence: sentiment.confidence,
      };

      writeRating(entry, signalsDir, ratingsFile, deps);
      deps.spawnTrending();

      if (sentiment.rating < 5) {
        captureLowRatingLearning(sentiment.rating, sentiment.summary, sentiment.detailed_context || "", "implicit", deps);

        if (sentiment.rating <= 3) {
          await deps.captureFailure({
            transcriptPath: input.transcript_path ?? "",
            rating: sentiment.rating,
            sentimentSummary: sentiment.summary,
            detailedContext: sentiment.detailed_context || "",
            sessionId,
          }).catch(() => {});
        }
      }

      deps.stderr(`[RatingCapture] Implicit: ${sentiment.rating}/10 (conf: ${sentiment.confidence})`);
    }

    return ok({ type: "context", content: reminder });
  },

  defaultDeps,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function writeRating(entry: RatingEntry, signalsDir: string, ratingsFile: string, deps: RatingCaptureDeps): void {
  deps.ensureDir(signalsDir);
  deps.appendFile(ratingsFile, JSON.stringify(entry) + "\n");
}

function captureLowRatingLearning(
  rating: number,
  summaryOrComment: string,
  detailedContext: string,
  source: "explicit" | "implicit",
  deps: RatingCaptureDeps,
): void {
  if (rating >= 5) return;
  if (!detailedContext?.trim()) return;

  const { year, month, day, hours, minutes, seconds } = deps.getLocalComponents();
  const yearMonth = `${year}-${month}`;
  const category = deps.getLearningCategory(detailedContext, summaryOrComment);
  const learningsDir = join(deps.baseDir, "MEMORY", "LEARNING", category, yearMonth);

  deps.ensureDir(learningsDir);

  const label = source === "explicit" ? `low-rating-${rating}` : `sentiment-rating-${rating}`;
  const filename = `${year}-${month}-${day}-${hours}${minutes}${seconds}_LEARNING_${label}.md`;
  const filepath = join(learningsDir, filename);

  const content = `---
capture_type: LEARNING
timestamp: ${year}-${month}-${day} ${hours}:${minutes}:${seconds} PST
rating: ${rating}
source: ${source}
auto_captured: true
---

# ${source === "explicit" ? "Low Rating" : "Implicit Low Rating"} Captured: ${rating}/10

**Date:** ${year}-${month}-${day}
**Rating:** ${rating}/10
**Detection Method:** ${source === "explicit" ? "Explicit Rating" : "Sentiment Analysis"}
${summaryOrComment ? `**Feedback:** ${summaryOrComment}` : ""}

---

## Context

${detailedContext || "No context available"}

---

## Improvement Notes

This response was rated ${rating}/10 by ${deps.getPrincipalName()}. Use this as an improvement opportunity.

---
`;

  deps.writeFile(filepath, content);
  deps.stderr(`[RatingCapture] Captured low ${source} rating learning`);
}
