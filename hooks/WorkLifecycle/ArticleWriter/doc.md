# ArticleWriter

## Overview

ArticleWriter spawns a background agent to write blog articles for the AI's personal column on the principal's website. It runs at session end, checking three gates before spawning: the website repo must exist on disk, no other article-writing agent can be running (lock file with 30-minute stale timeout), and the session must have substantial work (PRD with 4+ checked criteria).

The spawned agent (via `article-writer-runner.ts`) hunts through PAI memory for compelling stories, writes an article matching a detailed voice guide, creates a PR in the website repo, and tracks the article in MEMORY/ARTICLES/. The runner handles lock cleanup deterministically in a finally block.

## Event

`SessionEnd` — fires when a session ends, evaluating whether the session produced enough substantial work to warrant an article draft.

## When It Fires

- The session has a valid session_id
- A website repo path is configured in `hookConfig.articleWriter.repo` and exists on disk
- No fresh lock file exists at `MEMORY/ARTICLES/.writing` (or the lock is stale > 30 minutes)
- The session's work directory has a PRD.md with 4 or more checked criteria (`- [x]`)

It does **not** fire when:

- No session_id is present in the input
- No website repo is configured or the configured path does not exist on disk
- A fresh lock file indicates another article-writing agent is already running
- The session had no substantial work (PRD missing or fewer than 4 checked criteria)

## What It Does

1. Checks that the website repo path is configured and exists (Gate 1)
2. Checks for an existing lock file; if fresh, skips; if stale, removes it (Gate 2)
3. Reads the session's work state file to find the work directory, then checks the PRD.md for 4+ checked criteria (Gate 3)
4. Ensures the `MEMORY/ARTICLES/` directory exists
5. Writes a lock file with the current timestamp
6. Spawns `article-writer-runner.ts` as a background process with the base directory and session ID

```typescript
// Three gates, then spawn
if (!hasWebsiteRepo(deps)) return ok({ type: "silent" });
if (deps.fileExists(lockPath) && isTimestampFresh(lockPath, LOCK_STALE_MS, deps)) return ok({ type: "silent" });
if (!sessionHadSubstantialWork(input.session_id, deps.baseDir, deps)) return ok({ type: "silent" });

deps.writeFile(lockPath, deps.getISOTimestamp());
deps.spawnBackground("bun", [wrapperPath, deps.baseDir, input.session_id]);
```

## Examples

### Example 1: Substantial session triggers article

> You complete a session with a PRD that has 6 checked criteria. No lock file exists. ArticleWriter writes the `.writing` lock and spawns the article-writer-runner, which reads PAI memory, writes an article matching the voice guide, generates audio, creates a git branch, and opens a PR on the website repo.

### Example 2: Concurrent agent blocked by lock

> Two sessions end within minutes of each other. The first session spawns the article agent and writes the lock file. When the second session's ArticleWriter runs, it finds the lock file is fresh (< 30 minutes old) and skips with "Agent already running (lock fresh), skipping".

### Example 3: Shallow session skipped

> You have a session where you only checked 2 criteria in the PRD. ArticleWriter reads the PRD, counts only 2 checked boxes (below the threshold of 4), and returns silent without spawning any agent.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `core/adapters/fs` | adapter | File operations (read, write, exists, stat, remove, ensureDir) |
| `core/adapters/process` | adapter | Spawns background agent process |
| `lib/time` | lib | ISO timestamp generation |
| `lib/identity` | lib | Reads DA name and principal name |
| `lib/hook-config` | lib | Reads `hookConfig.articleWriter` for repo path |
| `article-writer-runner.ts` | runner | Background wrapper that runs claude with the article prompt |
