# Design: Fix dirname bug + improve project root discovery

**Date:** 2026-03-30
**Status:** Approved
**Issue:** Compounds of three related bugs in DuplicationDetection path traversal

## Problem Statement

Three problems, each compounding the next:

### Problem 1: findProjectRoot skips the starting directory

Both `defaultFindProjectRoot` (`DuplicationIndexBuilder.contract.ts:49`) and `findIndexPath` (`shared.ts:140`) start with `let dir = dirname(filePath)`. This works for PostToolUse (input is a file path), but for SessionStart the anchor is `deps.cwd()` which is a directory. `dirname("/project")` returns the parent, skipping the root entirely.

### Problem 2: SessionStart doesn't account for monorepos

`deps.cwd()` returns the repo root (e.g., `international-odr/`), not the subproject root (`international-odr/sveltekit/`). For monorepos with no root `package.json`, the builder finds `.git` at the repo root and scans from there, mixing unrelated subprojects.

**Decision:** Document this as a known limitation. PostToolUse handles monorepos naturally since the file path resolves to the correct subproject root. SessionStart pre-warming is a nice-to-have, not a requirement.

### Problem 3: findIndexPath has the same dirname bug

`shared.ts:143` has the same `let dir = dirname(filePath)` pattern. If the Checker receives a file that lives directly in the project root, it walks up to the parent and may miss the index entirely.

## Design

### 1. Fix dirname bug in both functions

Both `defaultFindProjectRoot` and `findIndexPath` need to handle directory inputs. Use `deps.stat()` (already available in both Deps interfaces) to check if the path is a directory. If so, start there. If it's a file, start at `dirname()` as before.

```typescript
// Determine starting directory
const s = deps.stat(filePath);
let dir = s && s.isDirectory?.() ? filePath : dirname(filePath);
```

For `defaultFindProjectRoot`, which doesn't have `deps.stat` in its current scope, add an `isDirectory` check via the existing `fileExists` adapter (check if `filePath` itself contains a project marker before calling `dirname`).

### 2. Expand project root markers

Replace hardcoded `package.json` + `.git` with a shared constant in `shared.ts`:

```typescript
export const PROJECT_MARKERS = [
  ".git", // universal, strongest signal
  "package.json", // JS/TS
  "composer.json", // PHP
  "go.mod", // Go
  "Cargo.toml", // Rust
  "pyproject.toml", // Python
];
```

Both `defaultFindProjectRoot` and `findIndexPath` use this list. `findIndexPath` checks markers at each level to identify project roots before looking for the index in `/tmp/pai/duplication/{hash}/`.

### 3. Branch-aware artifact directories

Update `getArtifactsDir` to include the branch in the path:

```
/tmp/pai/duplication/{path-hash}/{branch}/index.json
/tmp/pai/duplication/{path-hash}/{branch}/checker.jsonl
```

This gives each branch a persistent index that survives branch-switching without needing a rebuild. The existing branch-check-on-load logic (`loadIndex` discarding mismatched branches) becomes redundant and can be removed.

`getCurrentBranch()` already exists in `shared.ts` and is used by both the builder and checker.

Fallback when git is unavailable or detached HEAD: use `"default"` as the branch name.

### 4. Document monorepo SessionStart limitation

Add a note to `README.md`: SessionStart pre-warming works for single-root projects. Monorepos build indexes on first file edit per subproject via PostToolUse. This is correct behavior.

## Files Changed

| File                                  | Change                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared.ts`                           | Add `PROJECT_MARKERS` constant. Update `getArtifactsDir` to accept branch param. Update `findIndexPath` to handle directory inputs and use `PROJECT_MARKERS`. |
| `DuplicationIndexBuilder.contract.ts` | Fix `defaultFindProjectRoot` dirname bug. Use `PROJECT_MARKERS`. Pass branch to `getArtifactsDir`.                                                            |
| `DuplicationChecker.contract.ts`      | Pass branch to artifact path resolution.                                                                                                                      |
| `shared.test.ts`                      | Add tests for `getArtifactsDir` with branch, `PROJECT_MARKERS`.                                                                                               |
| `DuplicationIndexBuilder.test.ts`     | Add test for directory input to `findProjectRoot`.                                                                                                            |
| `README.md`                           | Document monorepo limitation.                                                                                                                                 |

## Testing Strategy

- Unit test: `defaultFindProjectRoot` with directory input (SessionStart case)
- Unit test: `defaultFindProjectRoot` with file input (PostToolUse case, regression)
- Unit test: `findIndexPath` with directory input
- Unit test: `getArtifactsDir` includes branch in path
- Unit test: `getArtifactsDir` falls back to "default" when no branch
- Integration: existing DuplicationIndexBuilder tests pass
- Integration: existing DuplicationChecker tests pass
