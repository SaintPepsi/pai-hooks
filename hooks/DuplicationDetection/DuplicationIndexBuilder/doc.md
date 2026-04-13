# DuplicationIndexBuilder

## Overview

DuplicationIndexBuilder builds a duplication detection index (`index.json`) in `/tmp/pai/duplication/{project-hash}/{branch}/`. It fires on **SessionStart** (eager pre-warming) and **PostToolUse** (after TypeScript file writes). The index catalogs all functions across the project so that DuplicationChecker can warn about potential duplicates before new code is written.

On PostToolUse, the builder does a **surgical update**: it loads the existing index, re-indexes only the changed file, recomputes duplicate groups, and writes back. On SessionStart (or when no index exists), it does a full rebuild. This is a silent background operation that never injects additional context into the conversation.

## Event

- `SessionStart` — builds the index eagerly at session start using CWD to find the project root
- `PostToolUse` — rebuilds after Write or Edit operations on `.ts` files using the file path to find the project root

## When It Fires

On **SessionStart**:
- Every session start (no tool filter)
- The project root can be determined from CWD (contains a project marker like `.git`, `package.json`, `composer.json`, etc.)

On **PostToolUse**:
- A Write or Edit tool has just completed on a `.ts` file (not `.d.ts`)
- The project root can be determined (contains a project marker like `.git`, `package.json`, `composer.json`, etc.)

It does **not** fire when:

- PostToolUse: The tool is not Write or Edit
- PostToolUse: The target file is not a `.ts` file (or is a `.d.ts` definition file)
- No project root can be found (walks up to 10 directories)

## What It Does

1. Determines the anchor path: CWD on SessionStart, file path on PostToolUse
2. Walks up the directory tree to find the project root (checks for project markers: `.git`, `package.json`, `composer.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`)
3. Checks if an existing index exists at `/tmp/pai/duplication/{hash}/{branch}/index.json`
4. If index exists and triggered by PostToolUse: **surgical update** — re-indexes only the changed file via `updateIndexForFile()`
5. If no index exists or triggered by SessionStart: **full rebuild** — scans all `.ts` files via `buildIndex()`
6. Recomputes duplicate group lookups (hash, name, signature)
7. Writes the resulting index as JSON to `/tmp/pai/duplication/{hash}/{branch}/index.json`
8. Logs build/update statistics (function count, file count, size, and build time) to stderr

Each `IndexEntry` may carry `source: true` when the file is identified as a canonical source: it lives in a `lib/`, `core/`, `utils/`, or `shared/` directory, contains exactly one function, and that function's name matches the filename stem with kebab-to-camelCase normalization (e.g., `lib/hook-config.ts` containing `hookConfig`). DuplicationChecker uses this flag to emit actionable guidance — "Import it from X" instead of "Reuse the existing function or extract both to a shared module".

```typescript
// Core flow — surgical update on PostToolUse, full rebuild on SessionStart
const anchor = isToolInput(input) ? getFilePath(input)! : deps.cwd();
const projectRoot = deps.findProjectRoot(anchor);
const branch = getCurrentBranch(projectRoot) ?? null;
const indexDir = getArtifactsDir(projectRoot, branch);

if (existingIndex && changedFile) {
  index = updateIndexForFile(existing, changedFile, content, deps.indexBuilderDeps);
} else {
  index = buildIndex(projectRoot, deps.indexBuilderDeps);
}
```

The hook shell routes by event type: SessionStart uses `runHookWith` (bypasses tool_name validation in the runner), PostToolUse uses standard `runHook` with `stdinOverride`.

## Examples

### Example 1: Session start pre-warms the index

> A new session starts in a TypeScript project. No `index.json` exists yet. DuplicationIndexBuilder uses CWD to find the project root, scans all `.ts` files, finds 142 functions across 28 files, and writes a 45KB index. The first Write/Edit in this session benefits from an already-warm index.

### Example 2: First TypeScript write in session (no SessionStart)

> The model edits `src/utils.ts`. No `index.json` exists yet. DuplicationIndexBuilder does a full rebuild, scans the entire project, finds 142 functions across 28 files, and writes a 45KB index file in 320ms.

### Example 3: Surgical update on subsequent writes

> The model writes to `src/api.ts` after the index already exists. DuplicationIndexBuilder loads the existing index, re-indexes only `src/api.ts`, recomputes duplicate groups, and writes the updated index in ~5ms.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result-based returns |
| `fs` | adapter | `readFile`, `writeFile`, `fileExists`, `stat`, `readDir`, `ensureDir` for file operations |
| `lib/tool-input` | lib | `getFilePath` for extracting tool input fields |
| `DuplicationDetection/index-builder-logic` | shared | `buildIndex`, `updateIndexForFile` functions and `IndexBuilderDeps` type |
| `DuplicationDetection/parser` | shared | `defaultParserDeps` for SWC-based function extraction |
