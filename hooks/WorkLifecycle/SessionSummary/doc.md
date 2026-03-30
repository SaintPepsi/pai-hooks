# SessionSummary

## Overview

SessionSummary finalizes a session by marking the WORK/ directory as COMPLETED, deleting the current-work state file, and resetting the terminal tab styling. It is the cleanup counterpart to AutoWorkCreation, ensuring that session state does not persist beyond the session's lifetime.

The hook updates META.yaml to set `status: "COMPLETED"` and `completed_at` with the current timestamp, removes the session-scoped state file, and resets the tab title to idle.

## Event

`SessionEnd` — fires when a Claude Code session ends, marking work as complete and clearing all session-scoped state.

## When It Fires

- A SessionEnd event occurs (always accepted)
- A session-scoped state file (`current-work-{session_id}.json`) exists in MEMORY/STATE/
- The state file belongs to the current session

It does **not** fire when:

- No session-scoped state file exists for the current session ID
- The state file belongs to a different session (session_id mismatch)

## What It Does

1. Finds the session-scoped state file in MEMORY/STATE/
2. Reads the state file to get the session directory path
3. Updates META.yaml in the work directory: replaces `status: "ACTIVE"` with `"COMPLETED"` and sets `completed_at` to the current timestamp
4. Deletes the session state file (`current-work-{session_id}.json`)
5. Resets the terminal tab to idle state (title cleared, state set to "idle")

```typescript
// Mark work complete, clear state, reset terminal
metaContent = metaContent.replace(/^status: "ACTIVE"$/m, 'status: "COMPLETED"');
metaContent = metaContent.replace(/^completed_at: null$/m, `completed_at: "${deps.getTimestamp()}"`);
deps.writeFile(metaPath, metaContent);
deps.unlinkSync(stateFile);
deps.setTabState({ title: "", state: "idle", sessionId: input.session_id });
```

## Examples

### Example 1: Normal session cleanup

> You end a session that created work under `MEMORY/WORK/20260328-143025_refactor-auth/`. SessionSummary updates META.yaml to show `status: "COMPLETED"` and `completed_at: "2026-03-28T15:45:00Z"`, deletes `current-work-{session_id}.json`, and resets the terminal tab to idle.

### Example 2: No active work

> You end a session where no work directories were created (e.g., a brief question-only session). SessionSummary finds no state file and logs "No current work to complete", then still resets the terminal tab state.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `core/adapters/fs` | adapter | File read/write/remove for state and META.yaml |
| `lib/time` | lib | ISO timestamp for completion time |
| `lib/tab-setter` | lib | Terminal tab state reset |
| `core/error` | core | Error wrapping for tryCatch operations |
| `core/result` | core | Result type and tryCatch utility |
