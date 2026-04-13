## Overview

Progressively renames the active Claude Code session based on keywords extracted from user prompts. The title builds up over time as the conversation evolves, and locks in once it stabilises.

## Event

UserPromptSubmit

## When It Fires

On every user prompt submission. Most invocations are no-ops (interval guard, convergence guard). A rename is issued on the first prompt and then at most once per configured interval.

## What It Does

- Reads per-session state from `MEMORY/STATE/session-rename-{sessionId}.json`
- Extracts meaningful keywords from the incoming prompt (strips stop words and short tokens)
- Merges new keywords into the cumulative frequency map stored in state
- Decides whether to rename based on three guards: `enabled` flag, `customName` flag, and elapsed interval since last rename — note: `customName` detection is not yet implemented; the flag defaults to `false` and is never set to `true` by the current integration
- Builds a title from the top-5 most frequent keywords
- Returns `sessionTitle` in `hookSpecificOutput` when a rename is warranted
- Marks the session as `converged` once the same title appears `convergenceCount` times in a row — no further renames after that

## Examples

> First prompt of a session: "Implement the session auto-rename hook in TypeScript"
> Title produced: "Implement Session Rename Typescript Hook"

> After several more prompts on the same topic, the title stabilises and convergence is detected — no further renames are issued for the rest of the session.

> User has manually set a session name — `customName: true` in state — hook exits immediately without overwriting it. Note: automatic detection of manual renames is not yet implemented; `customName` must be set externally for this guard to trigger.

## Dependencies

- `MEMORY/STATE/session-rename-{sessionId}.json` — per-session keyword and title state
- `hookConfig.sessionAutoRename` in `settings.json` — optional config:
  - `enabled` (boolean, default `true`)
  - `intervalMinutes` (number, default `15`)
  - `convergenceCount` (number, default `2`)
