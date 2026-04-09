# Hook Output Compression Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce hook feedback token injection by ~92% via shared compression helpers, diminishing detail for repeated-fire hooks, and first-person behavioral prefixes.

**Architecture:** New `lib/output-compress.ts` provides pure compression helpers + a fire-count tracker backed by state files. Each hook's format function gets rewritten to use these helpers, replacing verbose output with compact tagged lines.

**Tech Stack:** TypeScript, Bun test runner, existing `core/adapters/fs` for I/O, existing `MEMORY/STATE/` for fire count persistence.

**Design doc:** `docs/plans/2026-04-09-hook-output-compression-design.md`

---

### Task 1: Create compression helpers library

**Files:**
- Create: `lib/output-compress.ts`
- Create: `lib/output-compress.test.ts`

**Step 1: Write failing tests for pure helpers**

```typescript
// lib/output-compress.test.ts
import { describe, expect, it } from "bun:test";
import {
  compressPath,
  summarizeByDir,
  compactLines,
  hookLine,
  compressFileList,
} from "@hooks/lib/output-compress";

describe("compressPath", () => {
  it("returns last 2 segments of absolute path", () => {
    expect(compressPath("/Users/ian/repos/project/src/lib/api/upload.ts"))
      .toBe("api/upload.ts");
  });

  it("returns full path if fewer segments than requested", () => {
    expect(compressPath("upload.ts")).toBe("upload.ts");
  });

  it("supports custom segment count", () => {
    expect(compressPath("/a/b/c/d/e.ts", 3)).toBe("c/d/e.ts");
  });
});

describe("summarizeByDir", () => {
  it("groups files by parent directory basename", () => {
    const files = [
      "/src/lib/api/foo.ts",
      "/src/lib/api/bar.ts",
      "/src/lib/components/X.svelte",
    ];
    expect(summarizeByDir(files)).toBe("api/ (2), components/ (1)");
  });

  it("handles single file", () => {
    expect(summarizeByDir(["/src/api/upload.ts"])).toBe("api/ (1)");
  });

  it("handles empty array", () => {
    expect(summarizeByDir([])).toBe("");
  });
});

describe("compactLines", () => {
  it("formats line numbers with L prefix", () => {
    expect(compactLines([5, 12, 18])).toBe("L5,L12,L18");
  });

  it("truncates with overflow count when exceeding max", () => {
    expect(compactLines([5, 12, 18, 23, 45], 3)).toBe("L5,L12,L18 +2 more");
  });

  it("returns empty string for empty array", () => {
    expect(compactLines([])).toBe("");
  });
});

describe("hookLine", () => {
  it("wraps message with hook tag", () => {
    expect(hookLine("TypeStrictness", "3 violations"))
      .toBe("[TypeStrictness] 3 violations");
  });
});

describe("compressFileList", () => {
  it("compresses paths and truncates", () => {
    const files = ["/a/b/c/foo.ts", "/a/b/d/bar.ts", "/a/b/e/baz.ts"];
    expect(compressFileList(files, 2)).toBe("c/foo.ts, d/bar.ts +1 more");
  });

  it("shows all when under max", () => {
    const files = ["/a/b/c/foo.ts", "/a/b/d/bar.ts"];
    expect(compressFileList(files)).toBe("c/foo.ts, d/bar.ts");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test lib/output-compress.test.ts`
Expected: FAIL — module not found

**Step 3: Implement compression helpers**

```typescript
// lib/output-compress.ts
import { basename, dirname } from "node:path";

/**
 * Strip path to last N segments for compact display.
 * "/Users/ian/repos/project/src/lib/api/upload.ts" → "api/upload.ts"
 */
export function compressPath(absPath: string, segments = 2): string {
  const parts = absPath.split("/").filter(Boolean);
  if (parts.length <= segments) return absPath;
  return parts.slice(-segments).join("/");
}

/**
 * Group files by parent directory basename, return compact summary.
 * ["src/api/foo.ts", "src/api/bar.ts", "src/components/X.svelte"]
 * → "api/ (2), components/ (1)"
 */
export function summarizeByDir(files: string[]): string {
  if (files.length === 0) return "";
  const counts = new Map<string, number>();
  for (const f of files) {
    const dir = basename(dirname(f));
    counts.set(dir, (counts.get(dir) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([dir, count]) => `${dir}/ (${count})`)
    .join(", ");
}

/**
 * Format line numbers compactly.
 * [5, 12, 18] → "L5,L12,L18"
 * [5, 12, 18, 23, 45] with max=3 → "L5,L12,L18 +2 more"
 */
export function compactLines(lines: number[], max = 5): string {
  if (lines.length === 0) return "";
  if (lines.length <= max) return lines.map((l) => `L${l}`).join(",");
  const shown = lines.slice(0, max).map((l) => `L${l}`).join(",");
  return `${shown} +${lines.length - max} more`;
}

/** Wrap message with hook name tag: "[HookName] message" */
export function hookLine(name: string, msg: string): string {
  return `[${name}] ${msg}`;
}

/**
 * Compress file paths and truncate list.
 * ["/a/b/c/foo.ts", "/a/b/d/bar.ts", "/a/b/e/baz.ts"] with max=2
 * → "c/foo.ts, d/bar.ts +1 more"
 */
export function compressFileList(files: string[], max = 5): string {
  const compressed = files.map((f) => compressPath(f));
  if (compressed.length <= max) return compressed.join(", ");
  const shown = compressed.slice(0, max).join(", ");
  return `${shown} +${compressed.length - max} more`;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test lib/output-compress.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add lib/output-compress.ts lib/output-compress.test.ts
git commit -m "feat(output-compress): add shared compression helpers for hook output"
```

---

### Task 2: Add fire count tracker

**Files:**
- Modify: `lib/output-compress.ts`
- Modify: `lib/output-compress.test.ts`

**Step 1: Write failing tests for fire count tracker**

Add to `lib/output-compress.test.ts`:

```typescript
import {
  // ... existing imports ...
  getAndIncrementFireCount,
  type FireCountDeps,
} from "@hooks/lib/output-compress";

function makeFireCountDeps(store: Map<string, string> = new Map()): FireCountDeps {
  return {
    fileExists: (path) => store.has(path),
    readFile: (path) => store.get(path) ?? null,
    writeFile: (path, content) => { store.set(path, content); },
    ensureDir: () => {},
  };
}

describe("getAndIncrementFireCount", () => {
  it("returns 0 on first fire and stores 1", () => {
    const store = new Map<string, string>();
    const deps = makeFireCountDeps(store);
    const count = getAndIncrementFireCount("/state", "TypeStrictness", "sess-1", deps);
    expect(count).toBe(0);
    // Stored value should be "1"
    expect([...store.values()]).toContain("1");
  });

  it("returns 1 on second fire and stores 2", () => {
    const store = new Map<string, string>();
    const deps = makeFireCountDeps(store);
    getAndIncrementFireCount("/state", "Hook", "sess-1", deps);
    const count = getAndIncrementFireCount("/state", "Hook", "sess-1", deps);
    expect(count).toBe(1);
  });

  it("tracks different hooks independently", () => {
    const store = new Map<string, string>();
    const deps = makeFireCountDeps(store);
    getAndIncrementFireCount("/state", "HookA", "sess-1", deps);
    getAndIncrementFireCount("/state", "HookA", "sess-1", deps);
    const countA = getAndIncrementFireCount("/state", "HookA", "sess-1", deps);
    const countB = getAndIncrementFireCount("/state", "HookB", "sess-1", deps);
    expect(countA).toBe(2);
    expect(countB).toBe(0);
  });

  it("tracks different sessions independently", () => {
    const store = new Map<string, string>();
    const deps = makeFireCountDeps(store);
    getAndIncrementFireCount("/state", "Hook", "sess-1", deps);
    const count = getAndIncrementFireCount("/state", "Hook", "sess-2", deps);
    expect(count).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test lib/output-compress.test.ts`
Expected: FAIL — getAndIncrementFireCount not exported

**Step 3: Implement fire count tracker**

Add to `lib/output-compress.ts`:

```typescript
import { join } from "node:path";

export interface FireCountDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => string | null;
  writeFile: (path: string, content: string) => void;
  ensureDir: (path: string) => void;
}

/**
 * Get and increment fire count for a hook in the current session.
 * Returns count BEFORE incrementing (0 on first fire).
 */
export function getAndIncrementFireCount(
  stateDir: string,
  hookName: string,
  sessionId: string,
  deps: FireCountDeps,
): number {
  const dir = join(stateDir, "output-compress");
  const path = join(dir, `fires-${hookName}-${sessionId}.txt`);

  let count = 0;
  if (deps.fileExists(path)) {
    const content = deps.readFile(path);
    if (content !== null) {
      const n = parseInt(content.trim(), 10);
      if (!Number.isNaN(n)) count = n;
    }
  }

  deps.ensureDir(dir);
  deps.writeFile(path, String(count + 1));
  return count;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test lib/output-compress.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add lib/output-compress.ts lib/output-compress.test.ts
git commit -m "feat(output-compress): add fire count tracker for diminishing detail"
```

---

### Task 3: Compress obligation enforcers

Compress HookDocEnforcer, DocObligationEnforcer, and TestObligationEnforcer. All share the same pattern: narrative opener + file list + suggestions → compact summary.

**Files:**
- Modify: `hooks/ObligationStateMachines/HookDocEnforcer/HookDocEnforcer.contract.ts:47-50`
- Modify: `hooks/ObligationStateMachines/HookDocStateMachine.shared.ts:189-228` (simplify `buildDocSuggestions`)
- Modify: `hooks/ObligationStateMachines/DocObligationEnforcer/DocObligationEnforcer.contract.ts:58-61`
- Modify: `hooks/ObligationStateMachines/DocObligationStateMachine.shared.ts:78-101,114-132`
- Modify: `hooks/ObligationStateMachines/TestObligationEnforcer/TestObligationEnforcer.contract.ts:60-84`
- Modify: `hooks/ObligationStateMachines/TestObligationStateMachine.shared.ts:90-117`
- Modify: `lib/obligation-machine.ts:147-173` (compress `buildBlockLimitReview`)

**Step 1: Update HookDocEnforcer output**

In `HookDocEnforcer.contract.ts`, replace lines 47-50:

```typescript
// Before:
const opener = pickNarrative("HookDocEnforcer", result.pending.length, import.meta.dir);
const fileList = result.pending.map((f) => `  - ${f}`).join("\n");
const suggestions = buildDocSuggestions(result.pending, settings);
const reason = `${opener}\n\nHook source files modified without documentation:\n${fileList}\n\n${suggestions}`;

// After:
const dirSummary = buildCompactDocSuggestions(result.pending, settings);
const reason = hookLine("HookDocEnforcer", `I need to update docs before finishing. ${dirSummary}`);
```

Import `hookLine` from `@hooks/lib/output-compress` and create `buildCompactDocSuggestions` in `HookDocStateMachine.shared.ts`:

```typescript
/** Compact doc suggestions: "TypeStrictness/ (doc.md, IDEA.md), ArchEscalation/ (doc.md)" */
export function buildCompactDocSuggestions(
  pendingFiles: string[],
  settings: HookDocEnforcerSettings,
): string {
  const byDir = new Map<string, Set<string>>();
  for (const entry of pendingFiles) {
    const { source, docFile } = parseTag(entry);
    const dir = basename(getHookDirFromPath(source));
    if (!byDir.has(dir)) byDir.set(dir, new Set());
    byDir.get(dir)!.add(docFile);
  }
  return [...byDir.entries()]
    .map(([dir, docs]) => `${dir}/ (${[...docs].join(", ")})`)
    .join(", ");
}
```

Remove the `pickNarrative` import from this file.

**Step 2: Update DocObligationEnforcer output**

In `DocObligationEnforcer.contract.ts`, replace lines 58-61:

```typescript
// Before:
const opener = pickNarrative("DocObligationEnforcer", pending.length, import.meta.dir);
const fileList = pending.map((f) => `  - ${f}`).join("\n");
const suggestions = buildDocSuggestions(pending, deps);
const reason = `${opener}\n\nModified files without documentation updates:\n${fileList}\n\n${suggestions}`;

// After:
const dirSummary = summarizeByDir(pending);
const reason = hookLine("DocObligationEnforcer", `I need to update docs before finishing. ${dirSummary}`);
```

Import `hookLine`, `summarizeByDir` from `@hooks/lib/output-compress`. Remove `pickNarrative` and `buildDocSuggestions` imports.

Also simplify `buildDocSuggestions` in `DocObligationStateMachine.shared.ts` — it can remain for backward compat but the enforcer no longer calls it.

**Step 3: Update TestObligationEnforcer output**

In `TestObligationEnforcer.contract.ts`, replace lines 60-84:

```typescript
// Before: split into needsWriting/needsRunning lists with full paths

// After:
const needsWriting: string[] = [];
const needsRunning: string[] = [];
for (const file of pending) {
  if (hasTestFile(file, deps.fileExists)) {
    needsRunning.push(file);
  } else {
    needsWriting.push(file);
  }
}

const parts: string[] = [];
if (needsWriting.length > 0) {
  parts.push(`Write: ${compressFileList(needsWriting)}`);
}
if (needsRunning.length > 0) {
  parts.push(`Run: ${compressFileList(needsRunning)}`);
}
const reason = hookLine("TestObligationEnforcer", `I need to write and run tests before finishing. ${parts.join(". ")}`);
```

Import `hookLine`, `compressFileList` from `@hooks/lib/output-compress`. Remove `pickNarrative` import.

**Step 4: Compress `buildBlockLimitReview` in obligation-machine.ts**

Replace lines 147-173:

```typescript
// Before: verbose markdown with sections

// After:
export function buildBlockLimitReview(
  name: string,
  pendingFiles: string[],
  blockCount: number,
): string {
  const timestamp = new Date().toISOString();
  const dirs = summarizeByDir(pendingFiles);
  return `# ${name} Obligation Review\n\n` +
    `**Generated:** ${timestamp} | **Blocks:** ${blockCount} | **Released**\n\n` +
    `**Unresolved:** ${dirs}\n`;
}
```

Import `summarizeByDir` from `@hooks/lib/output-compress`.

Note: `obligation-machine.ts` has a pre-existing coding standards violation (direct `process.env` access on line 179). Fix this as part of the edit — the `createDefaultDeps` function already wraps it, but the module-level reference `process.env.PAI_DIR` and `process.env.HOME` need to stay inside `createDefaultDeps` (they already are). Verify with `bun test lib/obligation-machine.test.ts` that no regression occurs.

**Step 5: Also compress `buildBlockLimitReview` in the shared files**

- `DocObligationStateMachine.shared.ts:78-101` — replace verbose review with compact version using `summarizeByDir`
- `TestObligationStateMachine.shared.ts:90-117` — same pattern

**Step 6: Run affected tests**

Run: `bun test lib/obligation-machine.test.ts`
Run: `bun test hooks/ObligationStateMachines/`
Expected: All PASS (or fix any assertion changes in tests that check exact output strings)

**Step 7: Commit**

```bash
git add lib/output-compress.ts lib/obligation-machine.ts \
  hooks/ObligationStateMachines/
git commit -m "refactor(obligation-enforcers): compress output ~90% using shared helpers"
```

---

### Task 4: Compress CodingStandards group

Compress CodingStandardsEnforcer, TypeStrictness, and TypeCheckVerifier. These are PreToolUse/PostToolUse hooks that fire repeatedly — use diminishing detail via fire count tracker.

**Files:**
- Modify: `hooks/CodingStandards/CodingStandardsEnforcer/CodingStandardsEnforcer.contract.ts:88-141`
- Modify: `hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts:198-245`
- Modify: `hooks/CodingStandards/TypeCheckVerifier/TypeCheckVerifier.contract.ts:223-233`

**Step 1: Compress CodingStandardsEnforcer formatBlockMessage**

Replace `formatBlockMessage` (lines 88-141) with:

```typescript
function formatBlockMessage(
  violations: Violation[],
  filePath: string,
  isFirstFire: boolean,
): string {
  const file = compressPath(filePath);

  if (!isFirstFire) {
    // Diminished detail: just count + categories
    const categories = [...new Set(violations.map((v) => v.category))];
    return hookLine("CodingStandardsEnforcer",
      `+${violations.length} violations in ${file}: ${categories.join(", ")}`);
  }

  // First fire: category + line numbers
  const grouped: Record<string, number[]> = {};
  for (const v of violations) {
    (grouped[v.category] ??= []).push(v.line);
  }

  const parts = Object.entries(grouped)
    .map(([cat, lines]) => `${cat} (${compactLines(lines)})`)
    .join(", ");

  return hookLine("CodingStandardsEnforcer",
    `I need to fix these violations. ${violations.length} in ${file}: ${parts}`);
}
```

In the `execute` method, add fire count before calling formatBlockMessage:

```typescript
// Add deps for fire count — extend CodingStandardsEnforcerDeps with:
//   fireCountDeps: FireCountDeps
//   stateDir: string

const fireCount = getAndIncrementFireCount(deps.stateDir, "CodingStandardsEnforcer", input.session_id, deps.fireCountDeps);
const message = formatBlockMessage(violations, filePath, fireCount === 0);
```

Add `fireCountDeps` and `stateDir` to the deps interface and defaultDeps. Use `getPaiDir()` to derive stateDir as `join(getPaiDir(), "MEMORY", "STATE")`.

Import: `hookLine`, `compactLines`, `compressPath`, `getAndIncrementFireCount`, `type FireCountDeps` from `@hooks/lib/output-compress`.
Remove: `pickNarrative` import.

**Step 2: Compress TypeStrictness formatBlockMessage and formatLazyUnknownAdvisory**

Replace `formatBlockMessage` (lines 218-245):

```typescript
function formatBlockMessage(
  violations: AnyViolation[],
  filePath: string,
  isFirstFire: boolean,
): string {
  const file = compressPath(filePath);
  const lines = violations.map((v) => v.line);

  if (!isFirstFire) {
    return hookLine("TypeStrictness", `+${violations.length} \`any\` in ${file} (${compactLines(lines)})`);
  }

  return hookLine("TypeStrictness",
    `I need to fix these any types. ${violations.length} in ${file} (${compactLines(lines)}). Read types before replacing.`);
}
```

Replace `formatLazyUnknownAdvisory` (lines 198-213):

```typescript
function formatLazyUnknownAdvisory(
  warnings: UnknownWarning[],
  filePath: string,
  isFirstFire: boolean,
): string {
  const file = compressPath(filePath);
  const lines = warnings.map((w) => w.line);

  if (!isFirstFire) {
    return hookLine("TypeStrictness", `+${warnings.length} bare \`unknown\` in ${file} (${compactLines(lines)})`);
  }

  return hookLine("TypeStrictness",
    `I need to check these unknown types. ${warnings.length} bare \`unknown\` in ${file} (${compactLines(lines)}). Find correct types, don't lazy-replace.`);
}
```

Same pattern: add `fireCountDeps`/`stateDir` to deps, call `getAndIncrementFireCount` in execute. Note: TypeStrictness fires for both `any` blocks AND `unknown` advisories. Use the SAME fire count — they're both from the same hook on the same file edit.

Import: `hookLine`, `compactLines`, `compressPath`, `getAndIncrementFireCount`, `type FireCountDeps` from `@hooks/lib/output-compress`.
Remove: `pickNarrative` import.

**Step 3: Compress TypeCheckVerifier formatAdvisory**

Replace `formatAdvisory` (lines 223-233):

```typescript
function formatAdvisory(
  errors: TypeCheckError[],
  filePath: string,
  isFirstFire: boolean,
): string {
  const file = compressPath(filePath);
  const lines = errors.map((e) => e.line);

  if (!isFirstFire) {
    return hookLine("TypeCheckVerifier", `+${errors.length} type errors in ${file} (${compactLines(lines)})`);
  }

  return hookLine("TypeCheckVerifier",
    `I have type errors to fix. ${errors.length} in ${file} (${compactLines(lines)})`);
}
```

Same pattern: add fire count deps to interface and defaultDeps. Call in execute before formatAdvisory.

Import: `hookLine`, `compactLines`, `compressPath`, `getAndIncrementFireCount`, `type FireCountDeps` from `@hooks/lib/output-compress`.

**Step 4: Create defaultFireCountDeps helper**

Since all three hooks need the same `FireCountDeps` default, add a factory to `lib/output-compress.ts`:

```typescript
import {
  fileExists as fsFileExists,
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  ensureDir as fsEnsureDir,
} from "@hooks/core/adapters/fs";

export function createDefaultFireCountDeps(): FireCountDeps {
  return {
    fileExists: fsFileExists,
    readFile: (path) => {
      const result = fsReadFile(path);
      return result.ok ? result.value : null;
    },
    writeFile: (path, content) => {
      fsWriteFile(path, content);
    },
    ensureDir: (path) => {
      fsEnsureDir(path);
    },
  };
}
```

**Step 5: Run affected tests**

Run: `bun test hooks/CodingStandards/`
Expected: PASS (or fix test assertions that check exact output strings)

**Step 6: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add lib/output-compress.ts \
  hooks/CodingStandards/CodingStandardsEnforcer/ \
  hooks/CodingStandards/TypeStrictness/ \
  hooks/CodingStandards/TypeCheckVerifier/
git commit -m "refactor(coding-standards): compress enforcer output ~92% with fire count tracking"
```

---

### Task 5: Compress remaining hooks

Compress ArchitectureEscalation, SettingsGuard, and BashWriteGuard.

**Files:**
- Modify: `hooks/ArchitectureEscalation/ArchitectureEscalation/ArchitectureEscalation.contract.ts:81-110`
- Modify: `hooks/SecurityValidator/SettingsGuard/SettingsGuard.contract.ts:74-88`
- Modify: `hooks/CodingStandards/BashWriteGuard/BashWriteGuard.contract.ts:87-96`

**Step 1: Compress ArchitectureEscalation buildWarningMessage**

Replace `buildWarningMessage` (lines 81-110):

```typescript
export function buildWarningMessage(criterionId: string, failedAttempts: number): string {
  if (failedAttempts >= STOP_THRESHOLD) {
    return hookLine("ArchEscalation",
      `I need to rethink my approach. ${criterionId}: ${failedAttempts} failures — stop retrying, rethink approach`);
  }
  return hookLine("ArchEscalation",
    `I need to rethink my approach. ${criterionId}: ${failedAttempts} failures — consider different approach`);
}
```

Import: `hookLine` from `@hooks/lib/output-compress`.

**Step 2: Compress SettingsGuard buildAskMessage**

Replace `buildAskMessage` (lines 74-88):

```typescript
function buildAskMessage(tool: string, target: string): string {
  const file = target.split("/").pop() || target;
  return hookLine("SettingsGuard", `Confirm: ${tool} → ${file}`);
}
```

Import: `hookLine` from `@hooks/lib/output-compress`.

Note: This removes the "[INSTRUCTION TO AI]" block. That instruction ("do NOT suggest workarounds") should be added to a CLAUDE.md rule or the SettingsGuard doc.md instead of being injected into every ask. If you want to preserve it, add a single sentence: `hookLine("SettingsGuard", \`Confirm: ${tool} → ${file}. If denied, do not suggest workarounds.\`)` — still ~90% reduction.

**Step 3: Compress BashWriteGuard block message**

Replace lines 87-96 in execute:

```typescript
// Before: opener + command excerpt + 3-line guidance
// After:
const reason = hookLine("BashWriteGuard", "I need to use Edit/Write instead. For .ts file writes");
```

Remove: `pickNarrative` import.
Import: `hookLine` from `@hooks/lib/output-compress`.

**Step 4: Run affected tests**

Run: `bun test hooks/ArchitectureEscalation/`
Run: `bun test hooks/SecurityValidator/`
Run: `bun test hooks/CodingStandards/BashWriteGuard/`
Expected: PASS (or fix assertions)

**Step 5: Commit**

```bash
git add hooks/ArchitectureEscalation/ \
  hooks/SecurityValidator/SettingsGuard/ \
  hooks/CodingStandards/BashWriteGuard/
git commit -m "refactor(hooks): compress ArchEscalation, SettingsGuard, BashWriteGuard output"
```

---

### Task 6: Full verification and cleanup

**Step 1: Run full test suite**

Run: `bun test`
Expected: All PASS

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Check for unused pickNarrative imports**

Search for any remaining `pickNarrative` imports in modified files:

Run: `grep -r "pickNarrative" hooks/ObligationStateMachines/ hooks/CodingStandards/ hooks/ArchitectureEscalation/ hooks/SecurityValidator/`

If any hooks still import it, remove the import. Note: `pickNarrative` itself stays in `lib/narrative-reader.ts` — other hooks may use it.

**Step 4: Update doc.md files for modified hooks**

The HookDocEnforcer will block session end if hook source files were modified without doc updates. For each modified hook, update its `doc.md` to reflect the compressed output format. Key changes per doc:

- Update the "Examples" section to show compressed output format
- Update "What It Does" if it described the verbose output format

Hooks needing doc updates:
- `hooks/ObligationStateMachines/HookDocEnforcer/doc.md`
- `hooks/ObligationStateMachines/DocObligationEnforcer/doc.md`
- `hooks/ObligationStateMachines/TestObligationEnforcer/doc.md`
- `hooks/CodingStandards/CodingStandardsEnforcer/doc.md`
- `hooks/CodingStandards/TypeStrictness/doc.md`
- `hooks/CodingStandards/TypeCheckVerifier/doc.md`
- `hooks/CodingStandards/BashWriteGuard/doc.md`
- `hooks/ArchitectureEscalation/ArchitectureEscalation/doc.md`
- `hooks/SecurityValidator/SettingsGuard/doc.md`

**Step 5: Final commit**

```bash
git add -A
git commit -m "docs: update hook docs for compressed output format"
```
