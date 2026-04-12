# DestructiveDeleteGuard

## Overview

DestructiveDeleteGuard is a **PreToolUse** hook that blocks destructive delete patterns in both Bash commands and code edits. It detects recursive delete commands (`rm -rf`, `find -delete`, `shutil.rmtree`, `rsync --delete`, `git clean -d`, etc.) and blocks them, directing users to safe adapter functions like `removeDir()` instead.

For Edit and Write operations, it scans the code content for embedded destructive delete patterns (string literals, spawn arrays, template literals, API calls) to prevent code that would perform recursive deletion from being written. It exempts markdown files, Dockerfiles, and the fs adapter itself.

## Event

`PreToolUse` — fires before Bash, Edit, and Write tool operations, scanning for destructive delete patterns and blocking them with guidance toward safe alternatives.

## When It Fires

- The tool is `Bash`, `Edit`, or `Write`
- For Bash: the command contains a destructive delete pattern
- For Edit/Write: the code content contains a destructive delete pattern
- The target file is not a markdown file, Dockerfile, or the fs adapter

It does **not** fire when:

- The tool is not Bash, Edit, or Write
- The Bash command is a single-file `rm` (no recursive flag)
- The command is `git rm --cached` (only untracks files, does not delete from disk)
- The target file is a markdown/documentation file (`.md`, `.mdx`)
- The target file is a Dockerfile (container cleanup like `rm -rf /var/cache` is normal)
- The target file is `core/adapters/fs.ts` (the safe wrapper itself)
- The code references adapter functions like `removeDir()` rather than raw delete commands

## What It Does

1. For Bash commands:
   - Parses the command for destructive patterns: `rm -r`, `find -delete`, `python rmtree`, `perl rmtree`, `ruby rm_rf`, `node/bun rmSync`, `rsync --delete`, `git clean -d`
   - Exempts `git rm --cached` (safe untrack operation)
   - Blocks with guidance to use `removeDir()` adapter or run manually
2. For Edit/Write:
   - Skips markdown files, Dockerfiles, and the fs adapter
   - Scans code for spawn arrays (`"rm", "-rf"`), API calls (`shutil.rmtree`, `FileUtils.rm_rf`, `rmSync` with `recursive`), and inline delete patterns
   - Skips comments, markdown headers, and documentation references
   - Blocks with guidance to use safe adapter functions

```typescript
// Bash: artifact dirs prompt the user (ask), all others are denied
if (isArtifactDirCleanup(command)) {
  return ok({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: `Destructive delete on artifact directory: ${command}. Proceed?`,
    },
  });
}
return ok({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "Destructive delete pattern detected. Use removeDir() adapter.",
  },
});
// Code content: always deny
return ok({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "Code contains a destructive delete pattern. Use safe adapter functions.",
  },
});
```

> **L14 tombstone — Bug #11 (fixed 2026-04-11):** The original implementation returned
> `ok({ type: "ask", decision: "ask", message: "..." })` for artifact-directory cleanups. The
> top-level `decision` field only accepts `"approve"` or `"block"` in the SDK schema; `"ask"` is
> only valid inside `hookSpecificOutput.permissionDecision` for PreToolUse events. Passing an
> invalid top-level `decision` caused `validateHookOutput()` to reject the output, the runner
> silently fell back to `{ continue: true }`, and the user was never prompted — the destructive
> command ran unguarded. Fixed by routing through
> `hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", ... }`.

## Examples

### Example 1: rm -rf blocked in Bash

> Claude runs `rm -rf /tmp/build-output`. DestructiveDeleteGuard detects the recursive flag and blocks with: "Destructive delete pattern detected in Bash command. Use removeDir() adapter for directory cleanup, or run the command manually outside Claude Code."

### Example 2: Code with shutil.rmtree blocked

> Claude writes a Python file containing `shutil.rmtree(build_dir)`. DestructiveDeleteGuard detects the `shutil.rmtree` pattern in the Write content and blocks with guidance to use a safe adapter function instead.

### Example 3: Dockerfile exempted

> Claude edits a Dockerfile that contains `RUN rm -rf /var/lib/apt/lists/*`. DestructiveDeleteGuard recognizes the target is a Dockerfile and allows the edit, since container cleanup commands are normal and do not affect the host filesystem.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| (none) | -- | This hook has no external dependencies beyond core types |

