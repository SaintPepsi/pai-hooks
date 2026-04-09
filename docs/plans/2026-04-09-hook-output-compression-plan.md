# Hook Output Compression Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce hook feedback token injection by ~92% via shared compression helpers and first-person behavioral prefixes.

**Architecture:** New `lib/output-compress.ts` provides pure compression helpers. Each hook's format function gets rewritten to use these helpers, replacing verbose output with compact tagged lines. Verbose detail is preserved in `deps.stderr()` for developer logs; only the `reason` field (injected into Claude's context) gets compressed.

**Tech Stack:** TypeScript, Bun test runner

**Design doc:** `docs/plans/2026-04-09-hook-output-compression-design.md`

**Key design decisions (from adversarial review):**
- **No fire count tracker.** Every fire gets the same compressed format with behavioral prefix. ~40 tokens per fire is already 92% reduction; diminishing detail adds complexity for marginal savings.
- **`"I need to..."` prefix on EVERY fire**, all hooks. Costs ~5 tokens, prevents behavioral regression on both block and advisory hooks.
- **Verbose stderr, compressed reason.** `deps.stderr()` keeps the full detail for developer logs. The `reason` field (Claude's context) gets the compressed version.
- **Preserve existing `logSignal()` calls.** CodingStandardsEnforcer, TypeStrictness, and TypeCheckVerifier already log structured JSONL — do not touch those.
- **Keep `buildBlockLimitReview` verbose.** It's written to disk for human review, never injected into context.
- **Use `compressFileList` (not `summarizeByDir`) for obligation enforcers** where Claude needs specific file identity to take action.

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
 * Shared compression helpers for hook output.
 *
 * Pure functions only — no I/O, no adapters.
 * Used by hook contracts to compress the `reason` field
 * while verbose detail stays in deps.stderr().
 */

/** Strip path to last N segments: "/a/b/c/d/e.ts" → "d/e.ts" */
export function compressPath(absPath: string, segments = 2): string {
  const parts = absPath.split("/").filter(Boolean);
  if (parts.length <= segments) return absPath;
  return parts.slice(-segments).join("/");
}

/** Group files by parent dir basename: ["a/foo.ts", "a/bar.ts", "b/x.ts"] → "a/ (2), b/ (1)" */
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

/** Format line numbers compactly: [5, 12, 18] → "L5,L12,L18" */
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

/** Compress file paths and truncate list: ["a/b/foo.ts", "a/c/bar.ts"] → "b/foo.ts, c/bar.ts" */
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

### Task 2: Compress obligation enforcers

Compress HookDocEnforcer, DocObligationEnforcer, and TestObligationEnforcer.

**Pattern:** Each hook splits output into verbose stderr (developer logs) + compressed reason (Claude context). `buildBlockLimitReview` stays verbose (disk file, not context).

**Files:**
- Modify: `hooks/ObligationStateMachines/HookDocEnforcer/HookDocEnforcer.contract.ts:47-50`
- Modify: `hooks/ObligationStateMachines/HookDocStateMachine.shared.ts:189-228`
- Modify: `hooks/ObligationStateMachines/DocObligationEnforcer/DocObligationEnforcer.contract.ts:58-61`
- Modify: `hooks/ObligationStateMachines/TestObligationEnforcer/TestObligationEnforcer.contract.ts:60-84`

**DO NOT modify:**
- `lib/obligation-machine.ts:147-173` (`buildBlockLimitReview`) — keep verbose, it's a disk file
- `DocObligationStateMachine.shared.ts:78-101` (`buildBlockLimitReview`) — keep verbose
- `TestObligationStateMachine.shared.ts:90-117` (`buildBlockLimitReview`) — keep verbose

**Step 1: Update HookDocEnforcer output**

In `HookDocEnforcer.contract.ts`, replace lines 47-50:

```typescript
// Before:
const opener = pickNarrative("HookDocEnforcer", result.pending.length, import.meta.dir);
const fileList = result.pending.map((f) => `  - ${f}`).join("\n");
const suggestions = buildDocSuggestions(result.pending, settings);
const reason = `${opener}\n\nHook source files modified without documentation:\n${fileList}\n\n${suggestions}`;

// After:
// Verbose detail → stderr (developer logs)
const fileList = result.pending.map((f) => `  - ${f}`).join("\n");
deps.stderr(`[HookDocEnforcer] Hook source files modified without documentation:\n${fileList}`);

// Compressed → reason (Claude context)
const dirSummary = buildCompactDocSuggestions(result.pending, settings);
const reason = hookLine("HookDocEnforcer", `I need to update docs before finishing. ${dirSummary}`);
```

Import `hookLine` from `@hooks/lib/output-compress`. Remove `pickNarrative` import. Remove `buildDocSuggestions` import (keep `buildCompactDocSuggestions`).

Add `buildCompactDocSuggestions` to `HookDocStateMachine.shared.ts`:

```typescript
import { basename } from "node:path";

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

**Step 2: Update DocObligationEnforcer output**

In `DocObligationEnforcer.contract.ts`, replace lines 58-61:

```typescript
// Before:
const opener = pickNarrative("DocObligationEnforcer", pending.length, import.meta.dir);
const fileList = pending.map((f) => `  - ${f}`).join("\n");
const suggestions = buildDocSuggestions(pending, deps);
const reason = `${opener}\n\nModified files without documentation updates:\n${fileList}\n\n${suggestions}`;

// After:
// Verbose → stderr
const fileList = pending.map((f) => `  - ${f}`).join("\n");
deps.stderr(`[DocObligationEnforcer] Modified files without doc updates:\n${fileList}`);

// Compressed → reason (use compressFileList for file identity, not summarizeByDir)
const files = compressFileList(pending);
const reason = hookLine("DocObligationEnforcer", `I need to update docs before finishing. ${files}`);
```

Import `hookLine`, `compressFileList` from `@hooks/lib/output-compress`. Remove `pickNarrative` and `buildDocSuggestions` imports.

**Step 3: Update TestObligationEnforcer output**

In `TestObligationEnforcer.contract.ts`, replace lines 60-84:

```typescript
// Before: full paths in bulleted lists

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

// Verbose → stderr
const verboseList = pending.map((f) => `  - ${f}`).join("\n");
deps.stderr(`[TestObligationEnforcer] Modified files without tests:\n${verboseList}`);

// Compressed → reason
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

**Step 4: Run affected tests and fix breaking assertions**

Run: `bun test hooks/ObligationStateMachines/`

Breaking assertions to update:

| File | Line | Current Assertion | New Assertion |
|------|------|------------------|---------------|
| `HookDocStateMachine.test.ts` | 209 | `toContain("Update \`/hooks/G/H/doc.md\`")` | `toContain("H/ (doc.md)")` |
| `HookDocStateMachine.test.ts` | 620 | `toContain("/hooks/G/H/H.contract.ts")` | `toContain("[HookDocEnforcer]")` and `toContain("H/")` |
| `DocObligationStateMachine.test.ts` | 370 | `toContain("/src/handler.ts")` | `toContain("handler.ts")` |
| `DocObligationStateMachine.test.ts` | 409 | `toContain("/src/utils.ts")` | `toContain("utils.ts")` |
| `DocObligationStateMachine.test.ts` | 426 | `toContain("/src/handler.ts")` | `toContain("handler.ts")` |
| `DocObligationStateMachine.test.ts` | 443 | `toContain("/src/utils.ts")` | `toContain("utils.ts")` |
| `DocObligationStateMachine.test.ts` | 465 | `toContain("/src/handler.ts")` | `toContain("handler.ts")` |
| `TestObligationEnforcer.test.ts` | 61 | `toContain("Write and run tests for")` | `toContain("Write:")` |
| `TestObligationEnforcer.test.ts` | 74 | `toContain("Run existing tests for")` | `toContain("Run:")` |

Note: `DocObligationStateMachine.test.ts` lines 563-564 check `reviewContent` from `buildBlockLimitReview` — these should **NOT** change since we're keeping reviews verbose.

**Step 5: Commit**

```bash
git add hooks/ObligationStateMachines/ lib/output-compress.ts
git commit -m "refactor(obligation-enforcers): compress output ~90%, verbose detail to stderr"
```

---

### Task 3: Compress CodingStandards group

Compress CodingStandardsEnforcer, TypeStrictness, and TypeCheckVerifier. All fire on PreToolUse/PostToolUse. Every fire gets the same compressed format with behavioral prefix — no fire count tracking.

**Pattern:** Verbose detail → `deps.stderr()`. Compressed reason → `return`. Existing `logSignal()` calls stay untouched.

**Files:**
- Modify: `hooks/CodingStandards/CodingStandardsEnforcer/CodingStandardsEnforcer.contract.ts:88-141`
- Modify: `hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts:198-245`
- Modify: `hooks/CodingStandards/TypeCheckVerifier/TypeCheckVerifier.contract.ts:223-233`

**Step 1: Compress CodingStandardsEnforcer formatBlockMessage**

Replace `formatBlockMessage` (lines 88-141). The function now returns ONLY the compressed reason. The verbose output moves to the caller.

```typescript
/** Compressed reason for Claude's context. */
function formatCompressedReason(violations: Violation[], filePath: string): string {
  const file = compressPath(filePath);
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

/** Verbose detail for developer stderr logs. */
function formatVerboseStderr(violations: Violation[], filePath: string): string {
  const grouped: Record<string, Violation[]> = {};
  for (const v of violations) {
    (grouped[v.category] ??= []).push(v);
  }
  const sections: string[] = [`[CodingStandardsEnforcer] ${violations.length} violations in ${filePath}:`];
  for (const [category, items] of Object.entries(grouped)) {
    sections.push(`  ${category}:`);
    for (const v of items) {
      sections.push(`    Line ${v.line}: ${v.content}`);
    }
  }
  return sections.join("\n");
}
```

In the `execute` method (around line 253), update the output:

```typescript
// Before:
const message = formatBlockMessage(violations, filePath);
deps.stderr(message);
return ok({ type: "block", decision: "block", reason: message });

// After:
deps.stderr(formatVerboseStderr(violations, filePath));
const reason = formatCompressedReason(violations, filePath);
return ok({ type: "block", decision: "block", reason });
```

Import: `hookLine`, `compactLines`, `compressPath` from `@hooks/lib/output-compress`.
Remove: `pickNarrative` import.
**Do NOT touch** the `logSignal()` call — it stays as-is.

**Step 2: Compress TypeStrictness**

Replace `formatBlockMessage` (lines 218-245):

```typescript
function formatCompressedBlockReason(violations: AnyViolation[], filePath: string): string {
  const file = compressPath(filePath);
  const lines = violations.map((v) => v.line);
  return hookLine("TypeStrictness",
    `I need to fix these any types. ${violations.length} in ${file} (${compactLines(lines)}). Read types before replacing.`);
}

function formatVerboseBlockStderr(violations: AnyViolation[], filePath: string): string {
  const lines = violations.map((v) => `  Line ${v.line}: ${v.content}\n           → ${v.pattern}`);
  return `[TypeStrictness] ${violations.length} \`any\` violations in ${filePath}:\n${lines.join("\n")}`;
}
```

Replace `formatLazyUnknownAdvisory` (lines 198-213):

```typescript
function formatCompressedUnknownAdvisory(warnings: UnknownWarning[], filePath: string): string {
  const file = compressPath(filePath);
  const lines = warnings.map((w) => w.line);
  return hookLine("TypeStrictness",
    `I need to check these unknown types. ${warnings.length} bare \`unknown\` in ${file} (${compactLines(lines)}). Find correct types, don't lazy-replace.`);
}

function formatVerboseUnknownStderr(warnings: UnknownWarning[], filePath: string): string {
  const lines = warnings.map((w) => `  Line ${w.line}: ${w.content}\n           → ${w.pattern}`);
  return `[TypeStrictness] ${warnings.length} bare \`unknown\` in ${filePath}:\n${lines.join("\n")}`;
}
```

Update execute method to use split pattern:

```typescript
// Block path:
deps.stderr(formatVerboseBlockStderr(violations, filePath));
const reason = formatCompressedBlockReason(violations, filePath);
return ok({ type: "block", decision: "block", reason });

// Advisory path:
deps.stderr(formatVerboseUnknownStderr(unknownWarnings, filePath));
const advisory = formatCompressedUnknownAdvisory(unknownWarnings, filePath);
return ok(continueOk(advisory));
```

Import: `hookLine`, `compactLines`, `compressPath` from `@hooks/lib/output-compress`.
Remove: `pickNarrative` import.
**Do NOT touch** the `logSignal()` calls.

**Step 3: Compress TypeCheckVerifier formatAdvisory**

Replace `formatAdvisory` (lines 223-233):

```typescript
function formatCompressedAdvisory(errors: TypeCheckError[], filePath: string): string {
  const file = compressPath(filePath);
  const lines = errors.map((e) => e.line);
  return hookLine("TypeCheckVerifier",
    `I have type errors to fix. ${errors.length} in ${file} (${compactLines(lines)})`);
}

function formatVerboseStderr(errors: TypeCheckError[], filePath: string): string {
  const lines = errors.map((e) => `  Line ${e.line}:${e.col}: ${e.message}`);
  return `[TypeCheckVerifier] ${errors.length} type errors in ${filePath}:\n${lines.join("\n")}`;
}
```

Update execute method:

```typescript
// Before:
const advisory = formatAdvisory(errors, filePath);
return ok(continueOk(advisory));

// After:
deps.stderr(formatVerboseStderr(errors, filePath));
const advisory = formatCompressedAdvisory(errors, filePath);
return ok(continueOk(advisory));
```

Import: `hookLine`, `compactLines`, `compressPath` from `@hooks/lib/output-compress`.
**Do NOT touch** the `logSignal()` call.

**Step 4: Run affected tests and fix breaking assertions**

Run: `bun test hooks/CodingStandards/`

Breaking assertions to update:

| File | Line | Current Assertion | New Assertion |
|------|------|------------------|---------------|
| `CodingStandardsEnforcer.test.ts` | 310 | `toContain("/src/bad.ts")` | `toContain("bad.ts")` |
| `CodingStandardsEnforcer.test.ts` | 317 | `toContain("proper types")` | Remove — guidance block deleted |
| `CodingStandardsEnforcer.test.ts` | 318 | `not.toContain("adapters")` | Remove — redundant, guidance gone |
| `CodingStandardsEnforcer.test.ts` | 319 | `not.toContain("try-catch")` | Remove — redundant, guidance gone |
| `TypeStrictness.test.ts` | 287 | `toContain("Line 1")` | `toContain("L1")` |

Assertions that survive (no change needed):
- `CodingStandardsEnforcer.test.ts:309` — `toContain("2 violations")` ✓
- `BashWriteGuard.test.ts:212` — `toContain("Edit")` and `toContain("Write")` ✓
- `TypeCheckVerifier.test.ts:205-209` — semantic checks ✓

**Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add hooks/CodingStandards/
git commit -m "refactor(coding-standards): compress enforcer output ~92%, verbose to stderr"
```

---

### Task 4: Compress remaining hooks

Compress ArchitectureEscalation, SettingsGuard, and BashWriteGuard.

**Files:**
- Modify: `hooks/ArchitectureEscalation/ArchitectureEscalation/ArchitectureEscalation.contract.ts:81-110`
- Modify: `hooks/SecurityValidator/SettingsGuard/SettingsGuard.contract.ts:74-88`
- Create: `hooks/SecurityValidator/SettingsGuard/CHANGES.md`
- Modify: `hooks/CodingStandards/BashWriteGuard/BashWriteGuard.contract.ts:77-105`

**Step 1: Compress ArchitectureEscalation buildWarningMessage**

Replace `buildWarningMessage` (lines 81-110). Keep skill references — they're the mechanism that breaks retry loops:

```typescript
export function buildWarningMessage(criterionId: string, failedAttempts: number): string {
  if (failedAttempts >= STOP_THRESHOLD) {
    return hookLine("ArchEscalation",
      `I need to rethink my approach. ${criterionId}: ${failedAttempts} failures — stop retrying, use FirstPrinciples or Council skill`);
  }
  return hookLine("ArchEscalation",
    `I need to rethink my approach. ${criterionId}: ${failedAttempts} failures — consider different approach`);
}
```

The verbose version goes to stderr in the execute method:

```typescript
// In execute, before returning:
if (failedAttempts >= STOP_THRESHOLD) {
  deps.stderr(
    `[ArchEscalation] 🚨 STOP: ${criterionId} failed ${failedAttempts} times. ` +
    `Fundamental architectural problem — stop retrying, use FirstPrinciples/Council skill.`
  );
} else if (failedAttempts >= WARN_THRESHOLD) {
  deps.stderr(
    `[ArchEscalation] ⚠️ WARNING: ${criterionId} failed ${failedAttempts} times. ` +
    `Consider pausing and questioning the fundamental approach.`
  );
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

This removes the `[INSTRUCTION TO AI: do NOT suggest workarounds]` block. Document this removal:

Create `hooks/SecurityValidator/SettingsGuard/CHANGES.md`:

```markdown
# SettingsGuard Changes

## 2026-04-09 — Removed inline AI instruction block

The `[INSTRUCTION TO AI: If this operation is denied, do NOT suggest workarounds...]`
block was removed from `buildAskMessage` as part of hook output compression.

**Rationale:** Inline AI instructions in hook output were found to be unreliable
at controlling Claude's behavior. The instruction consumed ~80 tokens per fire
without consistent effect.

**Alternative approaches to explore:**
- CLAUDE.md rule in projects using SettingsGuard
- Steering rule via SteeringRuleInjector hook
- Post-denial hook that detects workaround attempts
```

**Step 3: Compress BashWriteGuard block message**

Replace the output building in execute (lines 87-96). Extract the target file from the command for context:

```typescript
// Before:
const opener = pickNarrative("BashWriteGuard", 1, import.meta.dir);
const reason = [
  opener,
  "",
  `Command: ${command.slice(0, 200)}`,
  "",
  "Use the Edit or Write tool instead...",
].join("\n");

// After:
// Extract target .ts file from command for context
const tsFileMatch = command.match(/\S+\.tsx?\b/);
const target = tsFileMatch ? compressPath(tsFileMatch[0]) : ".ts file";

// Verbose → stderr
deps.stderr(`[BashWriteGuard] Blocked command: ${command.slice(0, 200)}`);

// Compressed → reason
const reason = hookLine("BashWriteGuard", `I need to use Edit/Write instead for ${target}`);
```

Import: `hookLine`, `compressPath` from `@hooks/lib/output-compress`.
Remove: `pickNarrative` import.

**Step 4: Run affected tests and fix breaking assertions**

Run: `bun test hooks/ArchitectureEscalation/ hooks/SecurityValidator/ hooks/CodingStandards/BashWriteGuard/`

Breaking assertions to update:

| File | Line | Current Assertion | New Assertion |
|------|------|------------------|---------------|
| `ArchitectureEscalation.test.ts` | 86 | `toContain("ARCHITECTURE ESCALATION WARNING")` | `toContain("[ArchEscalation]")` and `toContain("failures")` |
| `ArchitectureEscalation.test.ts` | 100 | `toContain("STOP CURRENT APPROACH")` | `toContain("stop retrying")` |
| `ArchitectureEscalation.test.ts` | 244 | `toContain("STOP CURRENT APPROACH")` | `toContain("stop retrying")` |
| `SettingsGuard.test.ts` | 144 | `toContain("Settings Protection")` | `toContain("[SettingsGuard]")` and `toContain("Confirm")` |
| `SettingsGuard.test.ts` | 145 | `toContain("do NOT suggest workarounds")` | Remove entirely — instruction block deleted |

Assertions that survive:
- `ArchitectureEscalation.test.ts:256` — `toContain(String(STOP_THRESHOLD + 3))` ✓

**Step 5: Commit**

```bash
git add hooks/ArchitectureEscalation/ \
  hooks/SecurityValidator/SettingsGuard/ \
  hooks/CodingStandards/BashWriteGuard/
git commit -m "refactor(hooks): compress ArchEscalation, SettingsGuard, BashWriteGuard output"
```

---

### Task 5: Full verification and cleanup

**Step 1: Run full test suite**

Run: `bun test`
Expected: All PASS

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Check for unused pickNarrative imports**

Run: `grep -rn "pickNarrative" hooks/ObligationStateMachines/ hooks/CodingStandards/ hooks/ArchitectureEscalation/ hooks/SecurityValidator/`

Remove any remaining imports in modified files. `pickNarrative` itself stays in `lib/narrative-reader.ts` — other hooks may use it.

Note: the `narratives.jsonl` files in each modified hook's directory become dead weight after removing `pickNarrative` imports. Do NOT delete them in this task — they may be referenced by other hooks or tooling. Flag for future cleanup.

**Step 4: Remove unused exports**

After compression, these exported functions have no remaining callers:

- `HookDocStateMachine.shared.ts` → `buildDocSuggestions()` (replaced by `buildCompactDocSuggestions`)
- `DocObligationStateMachine.shared.ts` → `buildDocSuggestions()` (enforcer no longer calls it)

Check each with grep before removing:
```bash
grep -rn "buildDocSuggestions" hooks/ lib/ --include="*.ts"
```

If no callers remain, delete the functions. If the tracker or other hooks still use them, leave in place.

**Step 5: Update doc.md files for modified hooks**

The HookDocEnforcer will block session end if hook source files were modified without doc updates. For each modified hook, update its `doc.md`:

- Update "Examples" section to show compressed output format
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

**Step 6: Regenerate HTML docs**

Run: `bun run docs:render`

Verify the generated HTML in `docs/` reflects the updated doc.md content.

**Step 7: Final commit**

```bash
git add -A
git commit -m "docs: update hook docs for compressed output format, remove dead exports"
```

---

### Task 6: Dogfood — live session verification

Verify compressed output works correctly in a real Claude Code session. Intentionally trigger each hook and confirm: output format is correct, Claude complies with behavioral prefixes, and verbose logs appear in stderr.

**Step 1: Trigger obligation enforcers**

In a test project (or this repo), modify a hook source file without updating docs. Then attempt to end the session.

Expected context output:
```
[HookDocEnforcer] I need to update docs before finishing. <DirName>/ (doc.md)
```

Expected stderr (check hook logs):
```
[HookDocEnforcer] Hook source files modified without documentation:
  - /full/path/to/file.contract.ts
```

Verify: Claude attempts to update docs rather than trying to work around the block.

**Step 2: Trigger CodingStandardsEnforcer**

Edit a `.ts` file to introduce a raw Node import (e.g., `import { readFile } from "node:fs"`).

Expected context output:
```
[CodingStandardsEnforcer] I need to fix these violations. 1 in <file>: raw-import (L<n>)
```

Expected stderr:
```
[CodingStandardsEnforcer] 1 violations in /full/path/file.ts:
  raw-import:
    Line 3: import { readFile } from "node:fs"
```

Verify: Claude fixes the violation before retrying the edit.

**Step 3: Trigger CodingStandardsEnforcer — second fire**

Edit a different `.ts` file with another violation in the same session.

Expected context output (same format — no diminishing detail):
```
[CodingStandardsEnforcer] I need to fix these violations. 1 in <other-file>: raw-import (L<n>)
```

Verify: Same format on every fire. Behavioral prefix present.

**Step 4: Trigger TypeStrictness**

Edit a `.ts` file to include `const x: any = ...`.

Expected context output:
```
[TypeStrictness] I need to fix these any types. 1 in <file> (L<n>). Read types before replacing.
```

Verify: Claude reads type context before replacing, not just swapping to `unknown`.

**Step 5: Trigger TypeCheckVerifier**

Edit a `.ts` file to introduce a type error.

Expected context output:
```
[TypeCheckVerifier] I have type errors to fix. 1 in <file> (L<n>)
```

Verify: Advisory only (no block), Claude addresses the type error.

**Step 6: Trigger ArchitectureEscalation**

Set a task to `in_progress` 3+ times in a session.

Expected context output at 3 failures:
```
[ArchEscalation] I need to rethink my approach. <criterion>: 3 failures — consider different approach
```

At 5 failures:
```
[ArchEscalation] I need to rethink my approach. <criterion>: 5 failures — stop retrying, use FirstPrinciples or Council skill
```

Verify: Claude invokes a different skill rather than retrying the same fix.

**Step 7: Trigger BashWriteGuard**

Run a bash command that writes to a `.ts` file (e.g., `echo "test" > foo.ts`).

Expected context output:
```
[BashWriteGuard] I need to use Edit/Write instead for foo.ts
```

Expected stderr:
```
[BashWriteGuard] Blocked command: echo "test" > foo.ts
```

Verify: Claude switches to Edit/Write tool.

**Step 8: Verify verbose logging**

For each hook triggered above, confirm that:
1. `deps.stderr()` output contains full verbose detail (file paths, line content, etc.)
2. Signal JSONL files (`coding-standards-violations.jsonl`, `type-strictness.jsonl`, `type-check-verifier.jsonl`) continue to log structured data
3. The compressed `reason` in Claude's context is ~40-50 tokens, not the verbose version

**Step 9: Commit dogfood results**

If any issues were found and fixed during dogfooding, commit the fixes:

```bash
git add -A
git commit -m "fix(output-compress): fixes from dogfood session"
```
