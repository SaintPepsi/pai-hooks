# DocCommitGuard

## Overview

DocCommitGuard is a **PreToolUse** hook that blocks `git commit` commands when any hook directory is missing its required documentation files (`doc.md` or `IDEA.md`). It scans all `hooks/{Group}/{Hook}/hook.json` paths, checks for the companion doc files, and blocks the commit with a detailed list of what is missing.

This enforces the documentation-as-code policy: every hook must have both user-facing documentation (`doc.md`) and a portable concept document (`IDEA.md`) before changes can be committed.

## Event

`PreToolUse` — fires before Bash tool invocations that contain `git commit` and blocks if any hook directory is missing documentation.

## When It Fires

- A Bash tool is about to execute
- The command string contains `git commit` (including chained commands like `git add . && git commit`)

It does **not** fire when:

- The tool is not Bash
- The command does not contain `git commit` (e.g., `git status`, `git push`, `bun test`)

## What It Does

1. Extracts the command string from the tool input
2. Checks if the command contains `git commit` via regex (`/\bgit\s+commit\b/`)
3. Scans all `hooks/{Group}/{Hook}/hook.json` directories using Bun's Glob
4. For each hook directory, checks for the existence of `doc.md` and `IDEA.md`
5. If all docs are present, returns `continue`
6. If any docs are missing, formats a block reason listing each missing file and returns `block`

```typescript
// Scan pattern — uses injected deps for testability
for (const match of deps.scanHookJsons(deps.hooksDir)) {
  const hookDir = dirname(join(deps.hooksDir, match));
  if (!deps.fileExists(join(hookDir, "doc.md"))) missing.push(/*...*/);
  if (!deps.fileExists(join(hookDir, "IDEA.md"))) missing.push(/*...*/);
}
```

## Examples

### Example 1: Commit blocked for missing doc.md

> The model runs `git commit -m "feat: add new hook"`. DocCommitGuard scans all hook directories and finds that `GitSafety/MergeGate` is missing `doc.md`. It blocks with: "Commit blocked: hook documentation incomplete. - GitSafety/MergeGate: missing doc.md"

### Example 2: All docs present — commit proceeds

> The model runs `git commit -m "fix: update guard logic"`. DocCommitGuard scans all hook directories and every hook has both `doc.md` and `IDEA.md`. It returns `continue` and the commit proceeds.

### Example 3: Multiple hooks missing docs

> The model runs `git add . && git commit -m "refactor"`. DocCommitGuard detects `git commit` in the chained command, scans hooks, and finds two hooks missing docs. It blocks with a list showing both: `GroupA/HookOne: missing IDEA.md` and `GroupB/HookTwo: missing doc.md`.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result-based returns |
| `hook-outputs` | core | `continueOk()` factory for continue results |
| `tool-input` | lib | `getCommand()` to extract Bash command string |
| `fs` | adapter | `fileExists` to check for doc files on disk |
| `Glob` | bun | Scans `*/*/hook.json` patterns in hooks directory |
