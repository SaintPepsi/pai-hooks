# WorktreeSafetyVerification

## Overview

WorktreeSafetyVerification is a **PostToolUse** hook that runs safety checks after an `EnterWorktree` tool operation. It performs three tasks: ensuring the worktree directory is in the parent repository's `.gitignore` (to prevent cross-worktree contamination), installing dependencies in the background based on detected package managers, and running baseline tests in the background to identify pre-existing issues.

The hook always returns `continue` and never blocks worktree creation. All safety checks are best-effort and log warnings on failure.

## Event

`PostToolUse` — fires after `EnterWorktree` operations, running gitignore verification, dependency installation, and baseline tests for the new worktree.

## When It Fires

- The tool used is `EnterWorktree`
- A worktree path can be extracted from the tool response or input
- The worktree path exists on disk

It does **not** fire when:

- The tool is anything other than `EnterWorktree`
- The worktree path cannot be determined from the response or input
- The worktree path does not exist on disk

## What It Does

1. Extracts the worktree path from the tool response (parses path patterns) or input fields
2. Verifies the worktree directory exists
3. **Gitignore check**: Finds the parent git root, runs `git check-ignore` on the worktree path, and adds it to `.gitignore` with an auto-commit if not already ignored
4. **Dependency installation**: Detects package manager markers (`bun.lockb`, `package-lock.json`, `Cargo.toml`, `poetry.lock`, `go.mod`, etc.) and runs the appropriate install command in the background
5. **Baseline tests**: Detects test suite markers and runs tests in the background, logging guidance for manual re-check if they fail

```typescript
// Safety check pipeline
ensureGitignore(worktreePath, deps);    // Prevent cross-worktree contamination
installDependencies(worktreePath, deps); // Background dep install
runBaselineTests(worktreePath, deps);    // Background test baseline
return ok({ type: "continue", continue: true });
```

## Examples

### Example 1: New worktree with Bun project

> Claude enters a new worktree at `/project/.pait/worktrees/feature-x`. WorktreeSafetyVerification detects the path is not in `.gitignore`, adds `feature-x/` to `.gitignore` and commits. It then detects `bun.lockb`, runs `bun install` in the background, and runs `bun test` in the background for a baseline. All three steps happen without blocking the worktree creation.

### Example 2: Worktree path already in gitignore

> Claude enters a worktree that was previously created. WorktreeSafetyVerification runs `git check-ignore` and finds the path is already ignored. It logs "Worktree directory is in .gitignore" and proceeds to dependency installation and tests.

### Example 3: No recognized project type

> Claude enters a worktree for a project with no recognized dependency manifest or test suite. WorktreeSafetyVerification logs "No recognized dependency manifest found" and "No recognized test suite found", skipping both steps.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `fs` | adapter | Checks file existence, appends to `.gitignore`, creates directories |
| `process` | adapter | Executes git commands, spawns background dependency installs and test runs |
