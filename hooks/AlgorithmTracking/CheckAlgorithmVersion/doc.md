# CheckAlgorithmVersion

## Overview

CheckAlgorithmVersion is an **async SessionStart** hook that compares the locally installed PAI Algorithm version against the upstream version on GitHub. It reads the local version from `~/.claude/PAI/Algorithm/LATEST`, fetches the upstream version via the GitHub API (`gh api`), and writes a state file for the session banner to read.

The hook runs only for top-level sessions (not subagents) and writes its result to `~/.claude/MEMORY/STATE/algorithm-update.json`, which downstream UI components like `Banner.ts` use to display update notifications.

## Event

`SessionStart` — fires when a Claude Code session begins, checking for PAI Algorithm updates against the upstream GitHub repository.

## When It Fires

- The session is a top-level session (not a subagent)
- The hook always runs its version check at session start

It does **not** fire when:

- The session is a subagent (detected via `CLAUDE_PROJECT_DIR` containing `/.claude/Agents/` or `CLAUDE_AGENT_TYPE` being set)

## What It Does

1. Checks if the current session is a subagent; exits silently if so
2. Reads the local Algorithm version from `~/.claude/PAI/Algorithm/LATEST`
3. Fetches the upstream version from GitHub via `gh api repos/danielmiessler/Personal_AI_Infrastructure/contents/...` with a 3-second timeout
4. Decodes the base64 response to get the upstream version string
5. Compares versions using semantic versioning (major.minor.patch)
6. Writes state to `~/.claude/MEMORY/STATE/algorithm-update.json`:
   - If upstream is newer: `{ available: true, local, upstream, checkedAt }`
   - Otherwise: `{ available: false, checkedAt }`

```typescript
if (isNewer(upstreamVersion, localVersion)) {
  deps.writeStateFile({
    available: true,
    local: localVersion,
    upstream: upstreamVersion,
    checkedAt: new Date().toISOString(),
  });
} else {
  deps.writeStateFile({
    available: false,
    checkedAt: new Date().toISOString(),
  });
}
```

## Examples

### Example 1: Update available

> The local Algorithm version is `v4.0.2` and the upstream GitHub version is `v4.0.3`. CheckAlgorithmVersion detects the newer version and writes `{ available: true, local: "v4.0.2", upstream: "v4.0.3", checkedAt: "..." }` to the state file. The session banner reads this and displays an update notification.

### Example 2: Already up to date

> The local and upstream versions are both `v4.0.3`. CheckAlgorithmVersion writes `{ available: false, checkedAt: "..." }` to the state file, and no update notification is shown.

### Example 3: Subagent session (skipped)

> A background agent is spawned with `CLAUDE_AGENT_TYPE` set. CheckAlgorithmVersion detects the subagent context and returns silent immediately without making any network calls.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()`, `err()` for Result wrapping |
| `error` | core | `PaiError`, `ErrorCode` for typed errors |
| `fs` | adapter | `fileExists`, `readFile`, `writeFile`, `ensureDir` for file operations |
