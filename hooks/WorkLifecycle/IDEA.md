# Work Lifecycle

> Manage the full lifecycle of work sessions — from automatic directory creation through progress tracking to cleanup and learning capture.

## Problem

AI work sessions produce artifacts, track progress, and accumulate state, but without lifecycle management this state is scattered and ephemeral. Sessions start with no structure, progress is not tracked, context is lost when memory compacts, and when a session ends its learnings evaporate. Each session reinvents its own organization from scratch.

## Solution

Automate the entire session lifecycle with hooks at each phase: create structured directories when work begins, sync progress as requirements are completed, preserve state before memory compaction, generate summaries and articles at session end, and extract learnings for future sessions. Each hook handles one phase independently.

## How It Works

1. When the user submits their first prompt, create a timestamped work directory with subdirectories for tasks and scratch space, plus a requirements document.
2. As the user works, sync requirement completion state (checked criteria) to a central tracking file whenever a requirements document is written or edited.
3. Before context compaction, find the active requirements document and inject its current state as context so progress awareness survives the memory reset.
4. At session end, mark the work directory as completed, clear session state, and reset the terminal.
5. At session end, check if the session had substantial work and spawn an article-writing agent if it did.
6. At session end, extract learnings (criteria, tools used, files changed) into a dated learning file for future reference.

## Signals

- **Input:** User prompt submissions, file write/edit events on requirements documents, context compaction events, session end events
- **Output:** Work directories and metadata files, progress tracking updates, injected context summaries, learning files, spawned article agents
