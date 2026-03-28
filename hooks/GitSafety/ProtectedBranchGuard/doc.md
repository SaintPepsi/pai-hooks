# ProtectedBranchGuard

## Overview

ProtectedBranchGuard is a **PreToolUse** hook that prevents git mutation commands (commit, push, merge) from executing while on a protected branch (`main` or `master`). It enforces the discipline of working on feature branches and never committing directly to production branches.

The hook supports configurable exempt directories via `settings.json`, and has built-in exemptions for `~/.claude` (where GitAutoSync legitimately commits). It fails open if the current branch cannot be determined.

## Event

`PreToolUse` — fires before Bash tool operations, detecting git mutation commands and blocking them if the current branch is `main` or `master`.

## When It Fires

- The tool is `Bash`
- The command contains `git commit`, `git push`, or `git merge`
- The current branch is `main` or `master`
- The current working directory is not an exempt directory

It does **not** fire when:

- The tool is not `Bash`
- The Bash command does not contain a git mutation command
- The current branch is a feature branch (anything other than `main`/`master`)
- The current directory is in `~/.claude` (built-in exemption for GitAutoSync)
- The current directory matches a user-configured exempt directory
- The branch cannot be determined (fails open)

## What It Does

1. Extracts the command string from the tool input
2. Checks if the command matches the git mutation pattern (`git commit|push|merge`)
3. Reads exempt directories from `settings.json` at `hookConfig.protectedBranchGuard.exemptDirs`
4. Checks if the current working directory is exempt (built-in patterns + user config)
5. Determines the current git branch via `git branch --show-current`
6. If on `main` or `master`, blocks with a reason message including the offending command and instructions to create a feature branch

```typescript
if (PROTECTED_BRANCHES.includes(branch)) {
  return ok({
    type: "block",
    decision: "block",
    reason: `Protected branch guard: cannot run git mutations on '${branch}'.
      Create a feature branch first: git checkout -b feature/your-feature`,
  });
}
```

## Examples

### Example 1: Commit blocked on main

> Claude runs `git commit -m "fix bug"` while on the `main` branch. ProtectedBranchGuard blocks with: "Protected branch guard: cannot run git mutations on 'main'. Create a feature branch first: `git checkout -b feature/your-feature`."

### Example 2: Exempt directory allowed

> Claude runs `git commit` inside `~/.claude` where GitAutoSync operates. ProtectedBranchGuard detects the built-in exempt pattern for `/.claude/` and allows the commit to proceed regardless of the current branch.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `paths` | lib | Resolves the path to `settings.json` for exempt directory configuration |
| `fs` | adapter | Reads `settings.json` for user-configured exempt directories |
| `process` | adapter | Executes `git branch --show-current` to determine the current branch |
