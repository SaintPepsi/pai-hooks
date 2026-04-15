# RatingCapture

## Overview

RatingCapture is a dual-purpose hook that captures both explicit user ratings (e.g., "8" or "3 - too verbose") and implicit sentiment from natural language prompts. On every prompt, it also injects an algorithm format reminder into the context so Claude follows the PAI Algorithm structure in its responses.

Explicit ratings are parsed directly from the prompt text. Implicit sentiment is analyzed via a fast inference call that scores the user's emotional state on a 1-10 scale. Low ratings (below 5) trigger learning capture to MEMORY/LEARNING/, and very low ratings (3 or below) trigger the FailureCapture system for deeper analysis. Rating data is appended to `MEMORY/LEARNING/SIGNALS/ratings.jsonl` and a trending analysis is spawned after each capture.

## Event

`UserPromptSubmit` — fires on every user prompt, returning an algorithm format reminder as context and asynchronously capturing any rating or sentiment signal.

## When It Fires

- Every user prompt triggers this hook (accepts always returns true)
- Explicit rating path: prompt matches the pattern of a number 1-10 optionally followed by a comment
- Implicit sentiment path: prompt is at least 3 characters and inference returns a non-null rating with confidence >= 0.5

It does **not** fire when:

- Implicit sentiment analysis returns a null rating (no sentiment detected)
- Implicit sentiment confidence is below 0.5
- The prompt is shorter than 3 characters (implicit path skipped, but algorithm reminder still returned)

## What It Does

1. Reads the current algorithm version and builds the format reminder (always returned as context)
2. **Explicit path**: Parses the prompt for a leading number 1-10
   - Records the rating to `ratings.jsonl`
   - Spawns trending analysis
   - For ratings < 5: captures a learning file with response context
   - For ratings <= 3: calls FailureCapture for deep analysis
3. **Implicit path**: Sends the prompt plus recent transcript context to a fast inference model
   - The model scores sentiment on a 1-10 scale with confidence
   - Records the rating to `ratings.jsonl` with `source: "implicit"`
   - For ratings < 5: captures a learning file
   - For ratings <= 3: calls FailureCapture

```typescript
// Two paths: explicit rating or implicit sentiment
const explicitResult = parseExplicitRating(prompt);
if (explicitResult) {
  writeRating(entry, signalsDir, ratingsFile, deps);
  if (explicitResult.rating < 5) captureLowRatingLearning(...);
  return ok({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: reminder,
    },
  });
}

// Implicit: inference-based sentiment analysis
const sentiment = await deps.inference({ systemPrompt, prompt: userPrompt, level: "fast" });
if (sentiment.rating !== null && sentiment.confidence >= MIN_CONFIDENCE) {
  writeRating(entry, signalsDir, ratingsFile, deps);
}
```

## Examples

### Example 1: Explicit high rating

> You type "8 - great refactoring approach". RatingCapture parses this as rating 8 with comment "great refactoring approach", appends it to ratings.jsonl, spawns trending analysis, and returns the algorithm format reminder. No learning file is created since the rating is above 5.

### Example 2: Implicit frustration detected

> You type "Why did you ignore what I said about the config file?" with no explicit number. RatingCapture sends this to the inference model with recent transcript context. The model returns `{rating: 3, sentiment: "negative", confidence: 0.85, summary: "Frustrated about ignored instruction"}`. The rating is recorded as implicit, a learning file is created, and FailureCapture is triggered for deep analysis.

### Example 3: Neutral prompt skipped

> You type "Can you check the test output?" The inference model returns `{rating: null, sentiment: "neutral", confidence: 0.9}`. Since the rating is null, no rating entry is recorded. Only the algorithm format reminder is returned.

## Dependencies

| Dependency           | Type    | Purpose                                               |
| -------------------- | ------- | ----------------------------------------------------- |
| `Inference`          | tool    | Fast LLM inference for sentiment analysis             |
| `FailureCapture`     | tool    | Deep analysis of low-rating sessions                  |
| `lib/identity`       | lib     | Principal name, DA identity for sentiment prompts     |
| `lib/learning-utils` | lib     | Categorizes learning files (SYSTEM/ALGORITHM)         |
| `lib/time`           | lib     | Timestamps and date components for file naming        |
| `core/adapters/fs`   | adapter | File read/write/append for ratings and learning files |

## Error Logging

`parseJsonlEntry` accepts an optional `onError?: (line: string) => void` callback. When JSONL parsing fails, the callback receives the truncated line for debugging. Both `getRecentContext` and `getLastAssistantContext` wire this to `deps.stderr` to surface parse failures without breaking the fail-open pattern.

## History

> **2026-04-11 — SDK Type Foundation (1J):** All 5 return sites in `RatingCapture.contract.ts` (lines 334, 339, 365, 372, 414) were using `ok({ type: "context", content: reminder })`. This shape is not part of `SyncHookJSONOutput`. After Phase 0 Task 0C deleted the runner's `formatOutput()` adapter at commit `3705810`, the runner passes the contract result verbatim to stdout, where `validateHookOutput` fail-opens on the unknown shape and drops it. The algorithm format reminder (ALGORITHM FORMAT REQUIRED text, version string, `<user-prompt-submit-hook>` wrapping) has not been reaching users since commit `3705810`. Bugs #17-21 (one per site) — same bug class as 1A/1C/1E-1/1B/1X/1M. Fix applied via R7 at all 5 sites: context now routes through `hookSpecificOutput.additionalContext` with `hookEventName: "UserPromptSubmit"`. Behaviour change: every user prompt now receives the algorithm reminder again as originally intended.
