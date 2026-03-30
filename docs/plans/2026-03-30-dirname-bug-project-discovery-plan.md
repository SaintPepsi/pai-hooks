# Dirname Bug Fix + Project Root Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three compounding path traversal bugs in DuplicationDetection: dirname skipping directories, limited project markers, and branch-unaware artifact paths.

**Architecture:** Add `PROJECT_MARKERS` constant and `getBranch()` helper to `shared.ts`. Update `getArtifactsDir` to include branch. Fix dirname bug in `defaultFindProjectRoot` and `findIndexPath`. Remove now-redundant branch check in `loadIndex`.

**Tech Stack:** TypeScript, Bun test runner, existing adapter patterns in `core/adapters/`.

---

### Task 1: Add PROJECT_MARKERS constant and update getArtifactsDir signature

**Files:**
- Modify: `hooks/DuplicationDetection/shared.ts:94-110`
- Test: `hooks/DuplicationDetection/shared.test.ts`

**Step 1: Write failing tests for branch-aware getArtifactsDir**

Add to `hooks/DuplicationDetection/shared.test.ts`:

```typescript
import { getArtifactsDir, projectHash, PROJECT_MARKERS } from "@hooks/hooks/DuplicationDetection/shared";

describe("PROJECT_MARKERS", () => {
  test("includes .git as first entry", () => {
    expect(PROJECT_MARKERS[0]).toBe(".git");
  });

  test("includes package.json", () => {
    expect(PROJECT_MARKERS).toContain("package.json");
  });

  test("includes composer.json for PHP", () => {
    expect(PROJECT_MARKERS).toContain("composer.json");
  });
});

describe("getArtifactsDir with branch", () => {
  test("includes branch in path when provided", () => {
    const dir = getArtifactsDir("/project", "main");
    const hash = projectHash("/project");
    expect(dir).toBe(`/tmp/pai/duplication/${hash}/main`);
  });

  test("uses 'default' when branch is null", () => {
    const dir = getArtifactsDir("/project", null);
    const hash = projectHash("/project");
    expect(dir).toBe(`/tmp/pai/duplication/${hash}/default`);
  });

  test("uses 'default' when branch is undefined", () => {
    const dir = getArtifactsDir("/project");
    const hash = projectHash("/project");
    expect(dir).toBe(`/tmp/pai/duplication/${hash}/default`);
  });

  test("sanitizes branch names with slashes", () => {
    const dir = getArtifactsDir("/project", "feat/my-feature");
    expect(dir).toContain("feat-my-feature");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test hooks/DuplicationDetection/shared.test.ts`
Expected: FAIL — `PROJECT_MARKERS` not exported, `getArtifactsDir` doesn't accept branch param.

**Step 3: Implement PROJECT_MARKERS and update getArtifactsDir**

In `hooks/DuplicationDetection/shared.ts`, add after the imports section:

```typescript
export const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "composer.json",
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
];
```

Update `getArtifactsDir`:

```typescript
/** Sanitize branch name for use as directory segment. */
function sanitizeBranch(branch: string): string {
  return branch.replace(/[/\\]/g, "-");
}

/** Returns the artifacts directory: /tmp/pai/duplication/{hash}/{branch}/ */
export function getArtifactsDir(projectRoot: string, branch?: string | null): string {
  const branchDir = sanitizeBranch(branch || "default");
  return `${ARTIFACTS_BASE}/${projectHash(projectRoot)}/${branchDir}`;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test hooks/DuplicationDetection/shared.test.ts`
Expected: All PASS.

**Step 5: Commit**

```bash
git add hooks/DuplicationDetection/shared.ts hooks/DuplicationDetection/shared.test.ts
git commit -m "feat: add PROJECT_MARKERS and branch-aware getArtifactsDir"
```

---

### Task 2: Fix dirname bug in defaultFindProjectRoot

**Files:**
- Modify: `hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.contract.ts:49-61`
- Test: `hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.test.ts`

**Step 1: Write failing test for directory input**

Add to `DuplicationIndexBuilder.test.ts`, in the `execute()` describe block:

```typescript
test("finds project root when anchor is a directory (SessionStart case)", () => {
  // Simulate SessionStart: cwd() returns the project root itself
  const writtenFiles = new Map<string, string>();
  const deps = makeMockDeps({
    writeFile: (path: string, content: string): boolean => {
      writtenFiles.set(path, content);
      return true;
    },
    exists: (path: string): boolean => writtenFiles.has(path),
    stat: (): null => null, // no fresh index
    // Key: findProjectRoot receives a DIRECTORY, not a file
    findProjectRoot: (path: string): string | null => {
      // The real implementation should check the path itself, not just dirname
      return path === PAI_HOOKS_ROOT ? PAI_HOOKS_ROOT : null;
    },
    cwd: () => PAI_HOOKS_ROOT,
  });

  const input: SessionStartInput = { session_id: "test-session" };
  const output = unwrap(DuplicationIndexBuilderContract.execute(input, deps));
  expect(output.continue).toBe(true);
  // Verify findProjectRoot was called with the directory itself
  expect(writtenFiles.size).toBeGreaterThan(0);
});
```

**Step 2: Run to confirm current behavior**

Run: `bun test hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.test.ts`
Check if this test already passes (it might since `findProjectRoot` is mocked). If so, write a more targeted test for the actual `defaultFindProjectRoot` logic.

**Step 3: Fix defaultFindProjectRoot to handle directory inputs**

In `DuplicationIndexBuilder.contract.ts`, replace `defaultFindProjectRoot`:

```typescript
function defaultFindProjectRoot(filePath: string): string | null {
  const { dirname, join } = require("node:path");

  // Check if the path itself is a project root (handles directory inputs from SessionStart)
  for (const marker of PROJECT_MARKERS) {
    if (fileExists(join(filePath, marker) as string)) return filePath;
  }

  // Walk up from the parent directory
  let dir = dirname(filePath) as string;
  for (let i = 0; i < 10; i++) {
    for (const marker of PROJECT_MARKERS) {
      if (fileExists(join(dir, marker) as string)) return dir;
    }
    const parent = dirname(dir) as string;
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
```

Add the import at the top of the file:

```typescript
import { getArtifactsDir, getFilePath, PROJECT_MARKERS } from "@hooks/hooks/DuplicationDetection/shared";
```

**Step 4: Run tests**

Run: `bun test hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.test.ts`
Expected: All PASS.

**Step 5: Commit**

```bash
git add hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.contract.ts hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.test.ts
git commit -m "fix: defaultFindProjectRoot handles directory inputs and uses PROJECT_MARKERS"
```

---

### Task 3: Fix dirname bug in findIndexPath

**Files:**
- Modify: `hooks/DuplicationDetection/shared.ts:140-155`

**Step 1: Write failing test**

Add to `shared.test.ts`:

```typescript
import { findIndexPath } from "@hooks/hooks/DuplicationDetection/shared";

describe("findIndexPath", () => {
  test("finds index when input is a directory (not just a file)", () => {
    const projectRoot = "/tmp/test-project";
    const hash = projectHash(projectRoot);
    const indexPath = `/tmp/pai/duplication/${hash}/default/index.json`;

    const mockDeps = {
      readFile: () => null,
      exists: (path: string) => path === indexPath,
    };

    // Input IS the project root directory — should not skip it
    const result = findIndexPath(projectRoot, mockDeps);
    expect(result).toBe(indexPath);
  });

  test("still finds index when input is a file path", () => {
    const projectRoot = "/tmp/test-project";
    const hash = projectHash(projectRoot);
    const indexPath = `/tmp/pai/duplication/${hash}/default/index.json`;

    const mockDeps = {
      readFile: () => null,
      exists: (path: string) => path === indexPath,
    };

    const result = findIndexPath(`${projectRoot}/src/foo.ts`, mockDeps);
    expect(result).toBe(indexPath);
  });
});
```

**Step 2: Run to verify failure**

Run: `bun test hooks/DuplicationDetection/shared.test.ts`
Expected: FAIL — directory input test fails because dirname skips it.

**Step 3: Fix findIndexPath**

In `shared.ts`, update `findIndexPath`:

```typescript
export function findIndexPath(filePath: string, deps: SharedDeps): string | null {
  const { dirname } = require("node:path");
  const branch = getCurrentBranch() ?? "default";

  // Check the path itself first (handles directory inputs)
  const selfCandidate = `${getArtifactsDir(filePath, branch)}/index.json`;
  if (deps.exists(selfCandidate)) return selfCandidate;

  // Walk up from dirname
  let dir = dirname(filePath) as string;
  for (let i = 0; i < 10; i++) {
    const candidate = `${getArtifactsDir(dir, branch)}/index.json`;
    if (deps.exists(candidate)) return candidate;
    // Legacy location fallback
    const legacy = `${dir}/.claude/.duplication-index.json`;
    if (deps.exists(legacy)) return legacy;
    const parent = dirname(dir) as string;
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
```

**Step 4: Run tests**

Run: `bun test hooks/DuplicationDetection/shared.test.ts`
Expected: All PASS.

**Step 5: Commit**

```bash
git add hooks/DuplicationDetection/shared.ts hooks/DuplicationDetection/shared.test.ts
git commit -m "fix: findIndexPath handles directory inputs and uses branch-aware paths"
```

---

### Task 4: Pass branch to artifact paths in Builder and Checker

**Files:**
- Modify: `hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.contract.ts`
- Modify: `hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.contract.ts`

**Step 1: Update DuplicationIndexBuilder to pass branch**

In `DuplicationIndexBuilder.contract.ts`, update the execute method where it calls `getArtifactsDir`:

```typescript
// Replace:
const indexDir = getArtifactsDir(projectRoot);

// With:
const branch = getCurrentBranch() ?? null;
const indexDir = getArtifactsDir(projectRoot, branch);
```

Add `getCurrentBranch` to the import from shared:

```typescript
import { getArtifactsDir, getCurrentBranch, getFilePath, PROJECT_MARKERS } from "@hooks/hooks/DuplicationDetection/shared";
```

**Step 2: Update DuplicationChecker to pass branch**

In `DuplicationChecker.contract.ts`, update where it calls `getArtifactsDir`:

```typescript
// Replace:
const logDir = getArtifactsDir(index.root);

// With:
const branch = getCurrentBranch() ?? "default";
const logDir = getArtifactsDir(index.root, branch);
```

**Step 3: Remove redundant branch check in loadIndex**

In `shared.ts`, remove lines 124-128 from `loadIndex`:

```typescript
// REMOVE this block — branch isolation now handled by directory structure:
  // Discard index if it was built on a different branch
  if (parsed.branch) {
    const currentBranch = getCurrentBranch();
    if (currentBranch && parsed.branch !== currentBranch) return null;
  }
```

**Step 4: Run all DuplicationDetection tests**

Run: `bun test hooks/DuplicationDetection/`
Expected: All existing tests PASS (some may need mock path updates for branch segment).

**Step 5: Fix any test failures from path changes**

Tests that mock `getArtifactsDir` or check index paths may need updating to include the branch segment. Update mocks to account for the new `/{branch}/` in the path.

**Step 6: Commit**

```bash
git add hooks/DuplicationDetection/
git commit -m "feat: branch-aware artifact directories, remove redundant loadIndex branch check"
```

---

### Task 5: Update documentation

**Files:**
- Modify: `hooks/DuplicationDetection/README.md`
- Modify: `hooks/DuplicationDetection/DuplicationIndexBuilder/doc.md`
- Modify: `hooks/DuplicationDetection/DuplicationChecker/doc.md`

**Step 1: Update README.md**

Add monorepo limitation note under "Branch Awareness" section:

```markdown
### Monorepo Behavior

SessionStart pre-warming uses CWD to find the project root. In monorepos, CWD is typically the repo root, which may not be the subproject root. The builder will scan from the nearest project marker (`.git`, `package.json`, etc.).

For monorepos without a root `package.json`, the first PostToolUse event on a subproject file will build the index for that subproject. This is correct behavior — each subproject gets its own index scoped to its root.
```

Update artifact path references to include `/{branch}/`:

```
/tmp/pai/duplication/{hash}/{branch}/index.json
/tmp/pai/duplication/{hash}/{branch}/checker.jsonl
```

**Step 2: Update IndexBuilder and Checker doc.md files**

Update any references to artifact paths to include the branch segment.

**Step 3: Commit**

```bash
git add hooks/DuplicationDetection/README.md hooks/DuplicationDetection/DuplicationIndexBuilder/doc.md hooks/DuplicationDetection/DuplicationChecker/doc.md
git commit -m "docs: branch-aware paths, monorepo limitation, expanded project markers"
```

---

### Task 6: Final verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: No new failures (239 pre-existing in DuplicationDetection research CLIs).

**Step 2: Type check**

Run: `bunx tsc --noEmit 2>&1 | grep "error TS" | grep -i duplication`
Expected: Zero errors in DuplicationDetection files.

**Step 3: Verify branch-aware directory creation works end-to-end**

```bash
# Check current branch
git branch --show-current
# Look for artifacts in the new branch-namespaced location
ls /tmp/pai/duplication/*/
```

**Step 4: Push**

```bash
git push origin main
```
