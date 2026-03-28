# LastResponseCache

## Overview

LastResponseCache is a **sync Stop** hook that caches the last assistant response from the session transcript for use by other hooks. On session stop, it reads the transcript JSONL file, extracts the final assistant message, and writes it (truncated to 2000 characters) to `MEMORY/STATE/last-response.txt`.

This cached response provides context for downstream hooks like RatingCapture (UserPromptSubmit), which reads the file to understand what the previous assistant response was about.

## Event

`Stop` — fires when the user ends a Claude Code session, caching the last assistant message from the transcript.

## When It Fires

- A `transcript_path` is present in the hook input
- The transcript file is readable and contains at least one assistant message

It does **not** fire when:

- No `transcript_path` is provided in the input (`accepts()` returns false)
- The transcript file cannot be read
- The transcript contains no assistant messages (writes nothing, returns silent)

## What It Does

1. Checks `accepts()`: only proceeds if `input.transcript_path` is truthy
2. Reads the transcript JSONL file from the provided path
3. Parses each line as JSON, looking for entries with `type: "assistant"` and a `message.content` field
4. Extracts plain text from the last assistant message (handles both string and `ContentBlock[]` formats)
5. Writes the text (truncated to 2000 characters) to `{baseDir}/MEMORY/STATE/last-response.txt`
6. Always returns `{ type: "silent" }` — never blocks or delays the Stop event

```typescript
// Extract last assistant message from transcript JSONL
const lastResponse = extractLastAssistantMessage(input.transcript_path!, deps);

// Write truncated cache
const cachePath = join(deps.baseDir, "MEMORY", "STATE", "last-response.txt");
deps.writeFile(cachePath, lastResponse.slice(0, 2000));
```

## Examples

### Example 1: Session ends with assistant response

> A session ends after Claude provided a detailed code review. LastResponseCache reads the transcript, finds the last assistant message, truncates it to 2000 characters, and writes it to `~/.claude/MEMORY/STATE/last-response.txt`. When the user starts a new session, RatingCapture can read this file to understand the prior response context.

### Example 2: Empty or missing transcript

> A session ends but the transcript file is missing or contains only user messages with no assistant responses. LastResponseCache logs a warning and returns `{ type: "silent" }` without writing anything, leaving the previous cache file intact.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()`, `tryCatch()` for Result wrapping and safe JSON parsing |
| `fs` | adapter | `readFile`, `writeFile` for transcript reading and cache writing |
