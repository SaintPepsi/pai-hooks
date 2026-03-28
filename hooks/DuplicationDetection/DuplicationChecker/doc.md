# DuplicationChecker

## Overview

DuplicationChecker is a **PreToolUse** advisory hook that warns before writing or editing TypeScript files when the new code contains functions that duplicate existing functions in the codebase. It uses a pre-built duplication index (created by DuplicationIndexBuilder) to compare function signatures and names against the known codebase.

This hook never blocks -- it injects advisory context via `additionalContext` so the model can consider reusing existing code instead of creating duplicates. It works in tandem with DuplicationIndexBuilder, which builds and maintains the `.duplication-index.json` file that this hook reads.

## Event

`PreToolUse` — fires before Write or Edit operations on `.ts` files and warns if the new code duplicates existing functions.

## When It Fires

- A Write or Edit tool targets a `.ts` file (not `.d.ts`)
- A duplication index (`.duplication-index.json`) exists in the project
- The new content contains extractable functions
- At least one function matches an existing function in the index

It does **not** fire when:

- The tool is not Write or Edit
- The target file is not a `.ts` file (or is a `.d.ts` definition file)
- No duplication index exists in the project hierarchy
- The index cannot be loaded or parsed
- No functions are found in the new content
- No matches are found against the index

## What It Does

1. Extracts the file path from the tool input
2. Searches up the directory tree for a `.duplication-index.json` file
3. Loads and parses the index; skips silently if unavailable
4. Checks the index age against the staleness threshold
5. For Write operations, uses the content directly; for Edit operations, reads the current file and simulates the edit
6. Extracts function signatures from the content using SWC parser
7. Compares extracted functions against the index, excluding the current file
8. If matches are found, formats an advisory with match details (including a staleness warning if the index is old)
9. Returns `continue` with `additionalContext` containing the advisory

```typescript
// Core duplication check flow
const index = loadIndex(indexPath, deps);
const functions = extractFunctions(content, filePath.endsWith(".tsx"));
const matches = checkFunctions(functions, index, relPath);

if (matches.length > 0) {
  const advisory = formatFindings(matches, isStale);
  return ok({ type: "continue", continue: true, additionalContext: advisory });
}
```

## Examples

### Example 1: Duplicate function detected

> The model writes a new `formatDate(date: Date): string` function. The duplication index already contains a `formatDate` in `lib/utils.ts`. DuplicationChecker injects an advisory: "Possible duplication: formatDate already exists in lib/utils.ts. Consider reusing the existing function."

### Example 2: No index available

> The model writes to a `.ts` file in a project where DuplicationIndexBuilder has not yet run. No `.duplication-index.json` exists, so DuplicationChecker logs "No index found" to stderr and returns `continue` silently.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result-based returns |
| `fs` | adapter | `readFile` and `fileExists` for file access |
| `DuplicationDetection/shared` | shared | `loadIndex`, `findIndexPath`, `checkFunctions`, `formatFindings`, `STALENESS_SECONDS` |
| `DuplicationDetection/parser` | shared | `extractFunctions` for SWC-based function extraction |
