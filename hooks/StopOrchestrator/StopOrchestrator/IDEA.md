# Stop Orchestrator

> Parse the session transcript once and fan out to all end-of-session handlers.

## Problem

Multiple end-of-session tasks each need the same transcript data. Without coordination, each task parses the transcript independently (wasted work), runs in undefined order, and a failure in one can crash the entire shutdown sequence.

## Solution

A single orchestrator claims the session-stop event, parses the transcript once, determines which handlers are eligible (e.g., voice only for primary sessions), and runs them all concurrently with individual error isolation. Each handler receives pre-parsed data and cannot affect the others.

## How It Works

1. Accept the session stop event and wait a short interval for the transcript to finish writing.
2. Parse the transcript into a structured object (messages, roles, plain text summary).
3. Check whether the current session is a primary session or a sub-session.
4. Build the handler list: always include state restoration, skill rebuilding, and data enrichment; include voice notification only for the primary session.
5. Run all handlers concurrently using settled-promise semantics so failures are logged but do not propagate.
6. Return silently after all handlers complete or fail.

## Signals

- **Input:** Session stop event with transcript path and session ID
- **Output:** Silent completion (handlers produce their own side effects independently)
