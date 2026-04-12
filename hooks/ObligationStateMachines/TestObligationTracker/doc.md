# TestObligationTracker

## Overview

TestObligationTracker is a **PostToolUse** hook that monitors code edits and test executions to maintain a list of code files that need testing. It is the tracking half of the test obligation state machine, feeding data to TestObligationEnforcer which blocks session end when test obligations remain unfulfilled.

The hook handles two directions: code file modifications add to the pending list, while test command executions (via Bash) clear matching entries from the pending list. A full test suite run clears all pending entries at once.

## Event

`PostToolUse` — fires after Write, Edit, or Bash tool uses, updating the pending test obligation list based on whether code was modified or tests were run.

## When It Fires

- The tool used is `Bash` (to detect test command execution)
- The tool used is `Write` or `Edit` on a non-test code file

It does **not** fire when:

- The tool is not `Bash`, `Write`, or `Edit`
- The file being written/edited is a test file (test files are excluded)
- The file path cannot be extracted from the tool input
- The file is not recognized as a code file (e.g., config, docs)

## What It Does

1. **For Bash tool uses** (test detection path):
   - Extracts the command from the tool input
   - Checks if the command is a test command (via `isTestCommand`)
   - If it is a full test suite run, clears all pending entries
   - If it targets specific files, extracts tested source files and clears only matching entries
2. **For Write/Edit tool uses** (code tracking path):
   - Extracts the file path from the tool input
   - Adds the file to the pending list if not already present
   - Persists the updated pending list to the state file

```typescript
// Bash path: test command clears pending
if (input.tool_name === "Bash") {
  const command = getCommand(input);
  if (command && isTestCommand(command) && deps.fileExists(flagFile)) {
    const testedSources = extractTestedSourceFiles(command);
    if (testedSources === null) {
      deps.removeFlag(flagFile); // Full suite — clear all
    } else {
      const remaining = pending.filter(
        (p) => !testedSources.some((s) => pendingMatchesSource(p, s)),
      );
    }
  }
}

// Write/Edit path: code modification adds to pending
const pending = deps.readPending(flagFile);
if (!pending.includes(filePath)) pending.push(filePath);
deps.writePending(flagFile, pending);
```

## Examples

### Example 1: Code edit creates test obligation

> You edit `src/utils/parser.ts`. TestObligationTracker detects the write to a non-test code file, adds it to the pending list, and logs "Code modified: src/utils/parser.ts -- tests pending."

### Example 2: Running tests clears the obligation

> You run `bun test src/utils/parser.test.ts` via the Bash tool. TestObligationTracker detects it as a test command, extracts the tested source file, matches it against the pending entry for `parser.ts`, and removes it from the pending list.

### Example 3: Full test suite clears all obligations

> You run `bun test` with no specific file argument. TestObligationTracker treats this as a full suite run and clears all pending entries at once.

## Dependencies

| Dependency                          | Type   | Purpose                                                                                                                                       |
| ----------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `TestObligationStateMachine.shared` | shared | Provides `isNonTestCodeFile`, `isTestCommand`, `extractTestedSourceFiles`, `pendingMatchesSource`, `getFilePath`, `getCommand`, `pendingPath` |
| `result`                            | core   | `ok` wrapper for Result type returns                                                                                                          |
