# StopOrchestrator

## Overview

StopOrchestrator is the single entry point for all Stop event processing. Rather than having multiple independent hooks parse the transcript separately, it reads and parses the transcript once, then distributes the parsed data to handlers in parallel: VoiceNotification, RebuildSkill, and AlgorithmEnrichment.

Voice notifications are only enabled for main terminal sessions, preventing subagent sessions from triggering speech output.

## Event

`Stop` — fires when Claude Code generates a response, parsing the transcript once and distributing to all Stop-event handlers in parallel.

## When It Fires

- A Stop event occurs with a valid `transcript_path`
- The transcript file exists and can be parsed

It does **not** fire when:

- No `transcript_path` is provided in the input (accepts returns false)
- The transcript file does not exist or cannot be read

## What It Does

1. Waits 150ms for the transcript file to be fully written
2. Parses the transcript using `TranscriptParser` to extract completion text
3. Determines if this is a main session (always true; subagent filtering is handled upstream)
4. Runs handlers in parallel via `Promise.allSettled`:
   - **VoiceNotification** (main sessions only): Speaks the completion summary via TTS
   - **RebuildSkill**: Checks if skills need rebuilding
   - **AlgorithmEnrichment**: Enriches algorithm state from the response
5. Logs any handler failures without blocking other handlers

```typescript
// Parse once, distribute to all handlers in parallel
const parsed = deps.parseTranscript(input.transcript_path!);
const handlers = [
  deps.handleRebuildSkill(),
  deps.handleAlgorithmEnrichment(parsed, input.session_id),
];
if (voiceEnabled) handlers.unshift(deps.handleVoice(parsed, input.session_id));
await Promise.allSettled(handlers);
```

## Examples

### Example 1: Main session with voice

> Claude completes a response in the main terminal tab. StopOrchestrator parses the transcript and runs all four handlers. VoiceNotification speaks "Refactoring complete, 3 of 5 criteria satisfied", TabState updates the tab title, RebuildSkill checks for stale skills, and AlgorithmEnrichment processes the response.

### Example 2: Subagent session (no voice)

> A spawned subagent (e.g., from ArticleWriter) completes a response. StopOrchestrator parses the transcript. Since `isMainSession` always returns true now, voice is enabled for all sessions — but subagents are filtered upstream before this hook runs.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `TranscriptParser` | tool | Parses JSONL transcript into structured completion data |
| `handlers/VoiceNotification` | handler | TTS announcement of completion summaries |
| `handlers/RebuildSkill` | handler | Checks and rebuilds stale skills |
| `handlers/AlgorithmEnrichment` | handler | Enriches algorithm state from responses |
| `@anthropic-ai/claude-agent-sdk` | SDK | `SyncHookJSONOutput` return type; Stop silent no-op via `ok({})` (R8 shape, post-SDK-refactor 1V, replaces legacy `SilentOutput`) |
