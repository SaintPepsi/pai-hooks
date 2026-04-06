# Work Completion Learning

> Extract learnings from completed work sessions and persist them for future reference.

## Problem

Work sessions produce valuable signals: which criteria were set, how many were satisfied, what tools were used, what files changed, how long the work took. This information is useful for improving future sessions, but it lives in scattered state files that are cleaned up at session end. Without capture, the operational history of each session is lost.

## Solution

At session end, read the session's work metadata and progress criteria, evaluate whether the work was significant (files changed, multiple tasks, or manual creation), and if so write a structured learning file with duration, criteria, satisfaction scores, and tooling lineage. Organize learning files by category and month for easy retrieval.

## How It Works

1. At session end, find the session-scoped state file and read the associated work directory.
2. Parse the work directory's metadata (title, timestamps, lineage of tools/files/agents).
3. Read progress criteria and satisfaction scores if available.
4. Check if the work was significant (files changed, multiple tasks, or manually created). Skip trivial sessions.
5. Categorize the learning by title content, create a dated file in the appropriate monthly directory, and write a structured summary.

## Signals

- **Input:** Session end event with a session ID and associated work state
- **Output:** A dated learning file with work metadata, criteria, and satisfaction scores, or silent skip for trivial sessions
