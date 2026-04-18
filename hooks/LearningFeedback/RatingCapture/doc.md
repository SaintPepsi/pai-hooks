# RatingCapture

## Overview

RatingCapture captures both explicit user ratings (e.g., "8" or "3 - too verbose") and implicit sentiment from natural language prompts.

Explicit ratings are parsed directly from the prompt text. Implicit sentiment is analyzed via a fast inference call that scores the user's emotional state on a 1-10 scale. Low ratings (below 5) trigger learning capture to MEMORY/LEARNING/, and very low ratings (3 or below) trigger the FailureCapture system for deeper analysis. Rating data is appended to `MEMORY/LEARNING/SIGNALS/ratings.jsonl` and a trending analysis is spawned after each capture.

## Event

`UserPromptSubmit` — fires on every user prompt, capturing any rating or sentiment signal.

## When It Fires

- Every user prompt triggers this hook (accepts always returns true)
- Explicit rating path: prompt matches the pattern of a number 1-10 optionally followed by a comment
- Implicit sentiment path: prompt is at least 3 characters and inference returns a non-null rating with confidence >= 0.5

It does **not** fire when:

- Implicit sentiment analysis returns a null rating (no sentiment detected)
- Implicit sentiment confidence is below 0.5
- The prompt is shorter than 3 characters (implicit path skipped)

## What It Does

1. **Explicit path**: Parses the prompt for a leading number 1-10
   - Records the rating to `ratings.jsonl`
   - Spawns trending analysis
   - For ratings < 5: captures a learning file with response context
   - For ratings <= 3: calls FailureCapture for deep analysis
2. **Implicit path**: Sends the prompt plus recent transcript context to a fast inference model
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
  return ok({ continue: true });
}

// Implicit: inference-based sentiment analysis
const sentiment = await deps.inference({ systemPrompt, prompt: userPrompt, level: "fast" });
if (sentiment.rating !== null && sentiment.confidence >= MIN_CONFIDENCE) {
  writeRating(entry, signalsDir, ratingsFile, deps);
}
```

## Examples

### Example 1: Explicit high rating

> You type "8 - great refactoring approach". RatingCapture parses this as rating 8 with comment "great refactoring approach", appends it to ratings.jsonl, and spawns trending analysis. No learning file is created since the rating is above 5.

### Example 2: Implicit frustration detected

> You type "Why did you ignore what I said about the config file?" with no explicit number. RatingCapture sends this to the inference model with recent transcript context. The model returns `{rating: 3, sentiment: "negative", confidence: 0.85, summary: "Frustrated about ignored instruction"}`. The rating is recorded as implicit, a learning file is created, and FailureCapture is triggered for deep analysis.

### Example 3: Neutral prompt skipped

> You type "Can you check the test output?" The inference model returns `{rating: null, sentiment: "neutral", confidence: 0.9}`. Since the rating is null, no rating entry is recorded.

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

> **2026-04-17 — Remove algorithm reminder (#243):** Analysis of 413 sessions showed only 15% format compliance with the reminder active. The ~120 tokens/prompt added no measurable value. Removed `buildAlgorithmReminder`, `readAlgoVersion` from deps, and simplified all return paths to `{ continue: true }`.

> **2026-04-11 — SDK Type Foundation (1J):** Fixed return type from legacy `{ type: "context", content }` to SDK-compliant `hookSpecificOutput.additionalContext`. (Now moot after reminder removal.)
