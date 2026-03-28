# DuplicationIndexBuilder

## Overview

DuplicationIndexBuilder is a **PostToolUse** hook that builds a duplication detection index (`.duplication-index.json`) in the project root after a TypeScript file is written or edited. The index catalogs all functions across the project so that DuplicationChecker can warn about potential duplicates before new code is written.

The index is built lazily: it only triggers on the first `.ts` file write in a session and skips rebuilds if the existing index is less than 30 minutes old. This is a silent background operation that never injects additional context into the conversation.

## Event

`PostToolUse` — fires after Write or Edit operations on `.ts` files and rebuilds the duplication index if it is stale or missing.

## When It Fires

- A Write or Edit tool has just completed on a `.ts` file (not `.d.ts`)
- The project root can be determined (contains `package.json` or `.git`)
- The existing index is missing or older than 30 minutes

It does **not** fire when:

- The tool is not Write or Edit
- The target file is not a `.ts` file (or is a `.d.ts` definition file)
- No project root can be found (walks up to 10 directories)
- A fresh index already exists (modified less than 30 minutes ago)

## What It Does

1. Extracts the file path from the tool input
2. Walks up the directory tree to find the project root (looks for `package.json` or `.git`)
3. Checks if `.duplication-index.json` exists and is fresh (< 30 minutes old)
4. If the index is stale or missing, calls `buildIndex()` to scan all project TypeScript files
5. Extracts function signatures from every `.ts` file using the SWC parser
6. Writes the resulting index as JSON to `.duplication-index.json` in the project root
7. Logs build statistics (function count, file count, size, and build time) to stderr

```typescript
// Core index build flow
const projectRoot = deps.findProjectRoot(filePath);
const indexPath = deps.indexBuilderDeps.join(projectRoot, ".duplication-index.json");

if (isIndexFresh(indexPath, deps)) return ok({ type: "continue", continue: true });

const index = buildIndex(projectRoot, deps.indexBuilderDeps);
deps.writeFile(indexPath, JSON.stringify(index));
```

## Examples

### Example 1: First TypeScript write in session

> The model edits `src/utils.ts`. No `.duplication-index.json` exists yet. DuplicationIndexBuilder scans the entire project, finds 142 functions across 28 files, and writes a 45KB index file in 320ms. Subsequent writes within 30 minutes skip the rebuild.

### Example 2: Index is still fresh

> The model writes to `src/api.ts` five minutes after the last index build. DuplicationIndexBuilder checks the index mtime, finds it is only 5 minutes old (under the 30-minute threshold), and skips the rebuild entirely.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result-based returns |
| `fs` | adapter | `readFile`, `writeFile`, `fileExists`, `stat`, `readDir`, `ensureDir` for file operations |
| `DuplicationDetection/index-builder-logic` | shared | `buildIndex` function and `IndexBuilderDeps` type |
| `DuplicationDetection/parser` | shared | `defaultParserDeps` for SWC-based function extraction |
