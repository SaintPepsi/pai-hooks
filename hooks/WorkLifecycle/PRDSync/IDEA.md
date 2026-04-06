# Requirements Progress Sync

> Keep a central progress tracker in sync whenever a requirements document is written or edited.

## Problem

Requirements documents live inside individual work directories, but downstream consumers (dashboards, other hooks, session state) need a single place to check current progress across all active work. Reading every requirements file on demand is slow and fragile. Progress state drifts out of sync when updates are only stored in the source document.

## Solution

Intercept every write or edit to a requirements document. Parse its YAML frontmatter (task name, phase, effort, slug) and count its checkbox criteria (checked vs. total). Upsert this data into a central JSON tracking file keyed by slug. Also update the session state file so downstream hooks can map sessions to work directories.

## How It Works

1. After a file write or edit, check if the target path matches a requirements document pattern in the work directory.
2. Read the file and parse its YAML frontmatter for metadata fields (task, slug, phase, effort, progress).
3. Count checkbox-style criteria lines to determine total and completed counts.
4. Upsert an entry in a central tracking JSON file keyed by the document's slug.
5. Extract the work directory name from the file path and update the session state file so other hooks can locate this session's work.

## Signals

- **Input:** File write or edit events targeting requirements documents in work directories
- **Output:** Updated central progress tracking file and session state file, or silent pass-through for non-matching files
