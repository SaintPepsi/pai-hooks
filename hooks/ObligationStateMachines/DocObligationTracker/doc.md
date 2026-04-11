# DocObligationTracker

## Overview

DocObligationTracker is a **PostToolUse** hook that monitors file writes and edits to track which code files have been modified without corresponding documentation updates. It is the tracking half of the documentation obligation state machine, feeding data to DocObligationEnforcer which blocks session end when obligations remain unfulfilled.

The hook distinguishes between code file edits (which add to the pending list) and documentation file edits (which clear related entries from the pending list), enabling automatic resolution when documentation is written.

## Event

`PostToolUse` — fires after Write or Edit tool uses on code files or documentation files, updating the pending obligation list accordingly.

## When It Fires

- The tool used is `Write` or `Edit`
- The target file is either a documentation file or a non-test code file
- No project-level `DocObligationTracker` hook exists

It does **not** fire when:

- The tool is not `Write` or `Edit`
- The file path cannot be extracted from the tool input
- The file is neither a doc file nor a non-test code file (e.g., test files, config files)
- A project-level `DocObligationTracker` hook exists (checked via `projectHasHook`)

## What It Does

1. Extracts the file path from the tool input
2. If the file is a **documentation file**:
   - Reads the current pending list
   - Filters out any code files that are related to this doc file (using `isRelatedDoc`)
   - If all pending files are cleared, removes the flag file entirely
   - Otherwise, writes the reduced pending list back
3. If the file is a **code file**:
   - Reads the current pending list
   - Adds the file path if not already present
   - Writes the updated pending list to the state file

```typescript
// Doc file clears related pending entries
if (isDocFile(filePath)) {
  const pending = deps.readPending(flagFile);
  const remaining = pending.filter((p) => !isRelatedDoc(filePath, p));
  if (remaining.length === 0) deps.removeFlag(flagFile);
  else deps.writePending(flagFile, remaining);
  return ok({ continue: true });
}

// Code file adds to pending
const pending = deps.readPending(flagFile);
if (!pending.includes(filePath)) pending.push(filePath);
deps.writePending(flagFile, pending);
```

## Examples

### Example 1: Code file triggers documentation obligation

> You edit `src/utils/parser.ts`. DocObligationTracker detects the write, adds the file to the pending list, and logs "Code modified: src/utils/parser.ts -- docs pending." The obligation is now active for DocObligationEnforcer to enforce at session end.

### Example 2: Writing docs clears the obligation

> You create `docs/parser.md` which is related to the previously modified `src/utils/parser.ts`. DocObligationTracker detects the doc write, matches it against the pending list using `isRelatedDoc`, and removes the parser entry. If no pending files remain, the flag file is deleted entirely.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `DocObligationStateMachine.shared` | shared | Provides `projectHasHook`, `isDocFile`, `isNonTestCodeFile`, `isRelatedDoc`, `getFilePath`, `pendingPath` |
| `result` | core | `ok` wrapper for Result type returns |
