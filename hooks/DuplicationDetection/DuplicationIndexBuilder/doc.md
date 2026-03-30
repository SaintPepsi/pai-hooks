# DuplicationIndexBuilder

## Overview

DuplicationIndexBuilder builds a duplication detection index (`.duplication-index.json`) in the project's `.claude/` directory. It fires on **SessionStart** (eager pre-warming) and **PostToolUse** (after TypeScript file writes). The index catalogs all functions across the project so that DuplicationChecker can warn about potential duplicates before new code is written.

The index is built lazily: it skips rebuilds if the existing index is less than 30 minutes old. On SessionStart, it uses CWD as the project anchor. On PostToolUse, it uses the written file's path. This is a silent background operation that never injects additional context into the conversation.

## Event

- `SessionStart` — builds the index eagerly at session start using CWD to find the project root
- `PostToolUse` — rebuilds after Write or Edit operations on `.ts` files using the file path to find the project root

## When It Fires

On **SessionStart**:
- Every session start (no tool filter)
- The project root can be determined from CWD (contains `package.json` or `.git`)
- The existing index is missing or older than 30 minutes

On **PostToolUse**:
- A Write or Edit tool has just completed on a `.ts` file (not `.d.ts`)
- The project root can be determined (contains `package.json` or `.git`)
- The existing index is missing or older than 30 minutes

It does **not** fire when:

- PostToolUse: The tool is not Write or Edit
- PostToolUse: The target file is not a `.ts` file (or is a `.d.ts` definition file)
- No project root can be found (walks up to 10 directories)
- A fresh index already exists (modified less than 30 minutes ago)

## What It Does

1. Determines the anchor path: CWD on SessionStart, file path on PostToolUse
2. Walks up the directory tree to find the project root (looks for `package.json` or `.git`)
3. Checks if `.claude/.duplication-index.json` exists and is fresh (< 30 minutes old)
4. If the index is stale or missing, calls `buildIndex()` to scan all project TypeScript files
5. Extracts function signatures from every `.ts` file using the SWC parser
6. Writes the resulting index as JSON to `.claude/.duplication-index.json` in the project root
7. Logs build statistics (function count, file count, size, and build time) to stderr

```typescript
// Core index build flow — anchor differs by event type
const anchor = isToolInput(input) ? getFilePath(input)! : deps.cwd();
const projectRoot = deps.findProjectRoot(anchor);
const indexPath = deps.indexBuilderDeps.join(projectRoot, ".claude", ".duplication-index.json");

if (isIndexFresh(indexPath, deps)) return ok({ type: "continue", continue: true });

const index = buildIndex(projectRoot, deps.indexBuilderDeps);
deps.writeFile(indexPath, JSON.stringify(index));
```

The hook shell routes by event type: SessionStart uses `runHookWith` (bypasses tool_name validation in the runner), PostToolUse uses standard `runHook` with `stdinOverride`.

## Examples

### Example 1: Session start pre-warms the index

> A new session starts in a TypeScript project. No `.duplication-index.json` exists yet. DuplicationIndexBuilder uses CWD to find the project root, scans all `.ts` files, finds 142 functions across 28 files, and writes a 45KB index. The first Write/Edit in this session benefits from an already-warm index.

### Example 2: First TypeScript write in session (no SessionStart)

> The model edits `src/utils.ts`. No `.duplication-index.json` exists yet. DuplicationIndexBuilder scans the entire project, finds 142 functions across 28 files, and writes a 45KB index file in 320ms. Subsequent writes within 30 minutes skip the rebuild.

### Example 3: Index is still fresh

> The model writes to `src/api.ts` five minutes after the last index build. DuplicationIndexBuilder checks the index mtime, finds it is only 5 minutes old (under the 30-minute threshold), and skips the rebuild entirely.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result-based returns |
| `fs` | adapter | `readFile`, `writeFile`, `fileExists`, `stat`, `readDir`, `ensureDir` for file operations |
| `DuplicationDetection/index-builder-logic` | shared | `buildIndex` function and `IndexBuilderDeps` type |
| `DuplicationDetection/parser` | shared | `defaultParserDeps` for SWC-based function extraction |
