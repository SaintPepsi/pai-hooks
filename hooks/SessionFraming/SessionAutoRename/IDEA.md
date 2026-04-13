## Problem

Conversation sessions start with generic or empty titles. After a few exchanges the topic is clear, but there is no mechanism to retroactively name the session. Users end up with a history full of untitled or misleadingly-named sessions that are hard to navigate.

## Solution

A stateful hook that fires on every user prompt, accumulates keyword frequency across the session, and periodically proposes a title derived from the most-used meaningful words. The title evolves as the conversation evolves, then locks in once it stabilises.

## How It Works

1. On each user prompt submission the hook reads the per-session state file (or creates a fresh one).
2. Keywords are extracted from the prompt: lowercased, punctuation stripped, stop words and tokens under 4 characters removed.
3. New keywords are merged into a cumulative frequency map stored in state.
4. Three early-exit guards are checked in order: hook disabled, session has a custom name set by the user (`customName` flag in state — not yet automatically detected; must be set externally), rename interval has not elapsed since last rename.
5. If none of the guards fire, the top-5 keywords by frequency are joined into a candidate title.
6. The title is returned as `sessionTitle` in the hook output so the host application can apply it immediately.
7. The new title is appended to a `titleHistory` list. If the last N titles are identical the session is marked `converged` and no further renames are issued.
8. Updated state (prompt count, keyword map, title history, convergence flag) is written back to the state file.

## Signals

Input:
- `session_id` — used to locate the per-session state file
- `prompt` / `user_prompt` — the raw text to extract keywords from
- Config: `enabled`, `intervalMinutes` (default 15), `convergenceCount` (default 2)

Output:
- `hookSpecificOutput.sessionTitle` — the proposed title string, present only when a rename is warranted
- `continue: true` — always set; this hook never blocks prompt submission

## Context

The first-prompt rename gives an immediate title from minimal signal. Subsequent renames (rate-limited by `intervalMinutes`) refine the title as more context accumulates. Convergence detection prevents churn in long sessions where the topic has settled. Setting `customName: true` in the state file lets other tooling or the user lock the title permanently. Automatic detection of manual renames via the host API is not yet implemented — `customName` is always `false` until set externally.
