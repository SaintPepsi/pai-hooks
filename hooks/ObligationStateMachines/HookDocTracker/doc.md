# HookDocTracker

## Overview

HookDocTracker is a **PostToolUse** hook that monitors writes to hook source files (`.contract.ts`, `hook.json`, `group.json`) and marks their documentation as stale. It is the tracking half of the hook documentation obligation state machine, feeding data to HookDocEnforcer which blocks session end when hook docs are missing or outdated.

When a hook's `doc.md` file is written, the tracker clears the pending obligation for that hook directory. The watched file patterns and doc file name are configurable via settings.

## Event

`PostToolUse` — fires after Write or Edit tool uses on hook source files or hook doc files, updating the pending documentation obligation list.

## When It Fires

- The tool used is `Write` or `Edit`
- The target file matches a hook source pattern (configurable, default: `.contract.ts`, `hook.json`, `group.json`) or is a hook doc file (default: `doc.md`)
- No project-level `HookDocTracker` hook exists

It does **not** fire when:

- The tool is not `Write` or `Edit`
- The file path cannot be extracted from the tool input
- The file does not match any watched source pattern and is not a hook doc file
- A project-level `HookDocTracker` hook exists (checked via `projectHasHook`)

## What It Does

1. Extracts the file path from the tool input
2. Reads the hook doc settings (watch patterns, doc file name) from configuration
3. If the file is a **hook doc file** (`doc.md`):
   - Determines the hook directory from the file path
   - Clears all pending entries from the same hook directory
   - Logs how many entries remain pending
4. If the file is a **hook source file**:
   - Adds the file path to the pending list using the obligation machine's `addPending`
   - Logs that documentation is now pending for this file

```typescript
// Doc file written — clear matching pending entries
if (isAnyDocFile(filePath, settings)) {
  const docDir = getHookDirFromPath(filePath);
  const { remaining, cleared } = clearMatching(deps, flagFile, (p) => {
    return getHookDirFromPath(parseTag(p).source) === docDir;
  });
  return ok({ continue: true });
}

// Hook source file modified — add tagged pending entries for each doc file
for (const docName of allDocFileNames(settings)) {
  addPending(deps, flagFile, tagPending(filePath, docName));
}
```

## Examples

### Example 1: Hook contract modified without docs

> You edit `hooks/MyGroup/MyHook/MyHook.contract.ts`. HookDocTracker detects the file matches the `.contract.ts` watch pattern, adds it to the pending list, and logs "Hook source modified: MyHook.contract.ts -- docs pending." HookDocEnforcer will block session end until `doc.md` is updated.

### Example 2: Writing doc.md clears the obligation

> You create `hooks/MyGroup/MyHook/doc.md` with the required sections. HookDocTracker detects the doc file write, matches it to the same hook directory as the pending contract file, and clears the obligation. If no other hooks have stale docs, the flag file is removed entirely.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `obligation-machine` | lib | Generic `addPending` and `clearMatching` state machine operations |
| `paths` | lib | Path resolution utilities |
| `HookDocStateMachine.shared` | shared | Provides `defaultDeps`, `pendingPath`, `getFilePath`, `isHookSourceFile`, `isHookDocFile`, `getHookDirFromPath`, `readHookDocSettings` |
| `DocObligationStateMachine.shared` | shared | Provides `projectHasHook` for deduplication with project-level hooks |
