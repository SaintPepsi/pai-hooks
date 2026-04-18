# Hook Handlers

This directory contains the individual handler modules invoked by the PAI hooks
orchestrator. Each handler is a pure function with dependency injection for
testability.

## Handlers

### VoiceNotification.ts

Sends voice completion messages to the PAI Voice Server for TTS playback.

**How it works:**

1. Receives a pre-parsed transcript (`ParsedTranscript`) containing the
   extracted voice completion line from the agent's response.
2. Validates the completion text via `isValidVoiceCompletion`. Falls back to a
   generic message via `getVoiceFallback` if invalid.
3. POSTs to `http://localhost:8888/notify` with the message, identity title,
   and voice ID from settings.
4. Logs every voice event (sent, failed, skipped) to two locations:
   - `MEMORY/VOICE/voice-events.jsonl` (global log)
   - `MEMORY/WORK/<session-dir>/voice.jsonl` (per-session log, when active)

**Design:**

- Pure handler with dependency injection (`VoiceNotificationDeps`) -- all I/O
  (filesystem, fetch, stderr) is injectable for testing.
- Uses Kokoro TTS exclusively via the voice server. ElevenLabs has been removed.
- 3-second timeout on the HTTP request to avoid blocking the hook pipeline.
- Reads the active work directory from
  `MEMORY/STATE/current-work-<sessionId>.json` to locate the session voice log.

### AlgorithmEnrichment.ts

Enriches algorithm state after response completion. Extracts task description,
summary, SLA, quality gate, and capabilities from the transcript, then sweeps
stale active sessions.

**Imports:** Uses `@hooks/lib/algorithm-state` for state management and
`@pai/Tools/TranscriptParser` for the `ParsedTranscript` type.

### DocCrossRefIntegrity.ts

Validates cross-references between documentation files.

### RebuildSkill.ts

Rebuilds skill files when source materials change.

### SystemIntegrity.ts

Validates system-level invariants and configuration consistency.

### UpdateCounts.ts

Updates settings.json with fresh system counts (skills, workflows, hooks,
signals, files, work sessions, research, ratings). Runs as a standalone
background process spawned by the `UpdateCounts` contract at session end.

**How it works:**

1. Walks the PAI directory tree counting assets by type.
2. Reads current `settings.json`, updates the `counts` section, writes back.
3. Banner reads these cached counts at next session start (instant, no execution).

**Design:**

- Standalone script (`import.meta.main`), not an awaited handler.
- All filesystem I/O through `@hooks/core/adapters/fs`.
- Config injected via `UpdateCountsConfig` parameter, env access in `@hooks/lib/paths`.
- Usage cache refresh removed. Statusline handles its own OAuth usage fetching.
- Uses `safeJsonParse` from `core/adapters/json.ts` for settings.json parsing instead of bare `JSON.parse`.
