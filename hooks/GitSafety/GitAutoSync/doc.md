# GitAutoSync

## Overview

GitAutoSync is a **SessionEnd** hook that automatically commits and pushes changes in the `~/.claude` directory when a Claude Code session ends. It runs a full git pipeline: check status, debounce, stage, commit, backup key files, pull with merge, and push in background. This ensures that hook changes, configuration updates, and memory files are synchronized across machines.

The hook includes safety measures: debouncing (skips if last auto-sync was within 15 minutes), git lock detection (skips if another session is using git), stale lock cleanup, key file backup before pull, and post-merge diff verification. It also cleans up stale agent tracking files from dead processes.

## Event

`SessionEnd` — fires when a Claude Code session ends, performing a full git sync of the `~/.claude` directory. Always returns `silent` and never blocks session end.

## When It Fires

- A session is ending
- There are uncommitted changes in `~/.claude` (git status is not clean)
- The last auto-sync was more than 15 minutes ago (debounce)
- No other session holds the git index lock (or the lock is stale)

It does **not** fire when:

- There are no uncommitted changes in `~/.claude`
- The last auto-sync commit was within 15 minutes
- Another session is actively using git (fresh `index.lock` exists)
- Git operations fail at any step (the hook returns `silent` on errors)

## What It Does

1. Cleans up stale agent tracking files (`active-agents-*.json`) for dead PIDs or expired TTL
2. Checks for an active git index lock; removes stale locks older than 2 minutes
3. Runs `git status --porcelain` to check for uncommitted changes
4. Checks debounce: looks for the last `auto-sync` commit timestamp
5. Stages all changes with `git add -A`
6. Commits with message `"auto-sync: session end {timestamp}"`
7. Backs up key files (settings.json, statusline scripts, hook .ts files) before pull
8. Pulls from origin/main with `--no-rebase`
9. Verifies no key files changed unexpectedly during the merge
10. Pushes to origin/main in the background (non-blocking)

```typescript
// Full sync pipeline
const addResult = deps.execSync("git add -A", { cwd: deps.claudeDir });
const commitResult = deps.execSync(
  `git commit -m "auto-sync: session end ${timestamp}"`,
  { cwd: deps.claudeDir },
);
const backup = backupKeyFiles(deps);
deps.execSync("git pull --no-rebase origin main", { cwd: deps.claudeDir });
if (backup) checkPostMergeDiff(deps, backup);
deps.spawnBackground("git", ["push", "origin", "main"], { cwd: deps.claudeDir });
```

## Examples

### Example 1: Normal session end sync

> You end a session after modifying several hooks and updating settings.json. GitAutoSync stages all changes, commits with "auto-sync: session end 2026-03-28 14:30 PST", backs up key files, pulls any remote changes, verifies no conflicts, and pushes in the background. The session ends immediately without waiting for push.

### Example 2: Debounced skip

> You end a short session only 5 minutes after the last auto-sync. GitAutoSync detects the recent commit and logs: "Debounced (5m since last, need 15m)". No sync is performed.

### Example 3: Concurrent session detected

> Another Claude Code session is actively doing git operations, leaving an `index.lock` file that is 30 seconds old. GitAutoSync detects the fresh lock and logs: "Skipped -- index.lock exists (active session using git)". The sync is skipped to avoid race conditions.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `time` | lib | Provides local timestamps for commit messages |
| `fs` | adapter | File operations for backups, lock detection, and stale file cleanup |
| `process` | adapter | Executes git commands and spawns background push |
