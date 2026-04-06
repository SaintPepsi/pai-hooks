# Stop Orchestrator

> Coordinate all end-of-session tasks through a single entry point.

## Problem

When a session ends, multiple cleanup and bookkeeping tasks need to run: voice notifications, terminal state restoration, skill rebuilding, data enrichment. If each task registers independently on the session-end event, the transcript gets parsed multiple times, ordering is unpredictable, and failures in one task can interfere with others.

## Solution

Funnel all end-of-session work through a single orchestrator that parses the transcript once and distributes the parsed data to each handler. Run handlers concurrently where possible, catch failures individually so one broken handler does not block the others, and centralize logging.

## How It Works

1. On session stop, wait briefly for the transcript file to be fully written.
2. Parse the transcript once into a structured representation.
3. Determine which handlers should run (e.g., voice notifications only for the primary session, not sub-sessions).
4. Launch all eligible handlers concurrently, passing them the pre-parsed transcript data.
5. Collect results and log any handler failures without blocking the others.

## Signals

- **Input:** Session stop event with transcript file path and session identifier
- **Output:** Silent completion after all handlers finish (individual handler outputs vary)

## Context

This pattern avoids the "thundering herd" problem where many independent hooks all try to parse the same transcript on the same event. One parse, many consumers.
