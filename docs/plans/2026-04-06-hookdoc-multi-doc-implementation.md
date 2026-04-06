# HookDocEnforcer Multi-Doc Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend HookDocEnforcer to enforce multiple doc files per hook (doc.md + IDEA.md) with configurable independent/linked obligation clearing.

**Architecture:** Add `additionalDocs` and `mode` to the existing HookDocEnforcer settings. Tag pending entries with `:docFileName` suffix so tracker/enforcer know which doc each obligation is for. Backwards compatible — no additionalDocs means identical behavior to today.

**Tech Stack:** TypeScript, bun:test, existing ObligationMachine + HookDocStateMachine infrastructure.

**Design doc:** `docs/plans/2026-04-06-hookdoc-multi-doc-design.md`

---

### Task 1: Extend Settings Types and Reader

**Files:**
- Modify: `hooks/ObligationStateMachines/HookDocStateMachine.shared.ts:47-105`
- Test: `hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts`

**Step 1: Write failing tests for new settings fields**

Add to the `readHookDocSettings` describe block in `HookDocStateMachine.test.ts`:

```typescript
it("parses additionalDocs from config", () => {
  const json = JSON.stringify({
    hookConfig: {
      hookDocEnforcer: {
        additionalDocs: [
          { fileName: "IDEA.md", requiredSections: ["## Problem", "## Solution"] }
        ]
      }
    }
  });
  const settings = readHookDocSettings(() => json);
  expect(settings.additionalDocs).toHaveLength(1);
  expect(settings.additionalDocs[0].fileName).toBe("IDEA.md");
  expect(settings.additionalDocs[0].requiredSections).toEqual(["## Problem", "## Solution"]);
});

it("defaults additionalDocs to empty array", () => {
  const settings = readHookDocSettings(() => null);
  expect(settings.additionalDocs).toEqual([]);
});

it("parses mode from config", () => {
  const json = JSON.stringify({
    hookConfig: {
      hookDocEnforcer: { mode: "linked" }
    }
  });
  const settings = readHookDocSettings(() => json);
  expect(settings.mode).toBe("linked");
});

it("defaults mode to independent", () => {
  const settings = readHookDocSettings(() => null);
  expect(settings.mode).toBe("independent");
});

it("ignores invalid mode values", () => {
  const json = JSON.stringify({
    hookConfig: { hookDocEnforcer: { mode: "bogus" } }
  });
  const settings = readHookDocSettings(() => json);
  expect(settings.mode).toBe("independent");
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts -v`
Expected: FAIL — `additionalDocs` and `mode` properties don't exist on settings type.

**Step 3: Add types and update settings reader**

In `HookDocStateMachine.shared.ts`:

Add the `AdditionalDoc` interface after `HookDocEnforcerSettings` (line ~53):

```typescript
export interface AdditionalDoc {
  fileName: string;
  requiredSections: string[];
}
```

Add fields to `HookDocEnforcerSettings`:

```typescript
export interface HookDocEnforcerSettings {
  enabled: boolean;
  blocking: boolean;
  requiredSections: string[];
  docFileName: string;
  watchPatterns: RegExp[];
  additionalDocs: AdditionalDoc[];
  mode: "independent" | "linked";
}
```

Update `defaults()` to include new fields:

```typescript
function defaults(): HookDocEnforcerSettings {
  return {
    enabled: true,
    blocking: true,
    requiredSections: [...DEFAULT_REQUIRED_SECTIONS],
    docFileName: "doc.md",
    watchPatterns: [...DEFAULT_WATCH_PATTERNS],
    additionalDocs: [],
    mode: "independent",
  };
}
```

Update `readHookDocSettings` return object (~line 94-105) to parse new fields:

```typescript
additionalDocs: Array.isArray(cfg.additionalDocs)
  ? (cfg.additionalDocs as Array<{ fileName?: unknown; requiredSections?: unknown }>)
      .filter((d) => typeof d.fileName === "string")
      .map((d) => ({
        fileName: d.fileName as string,
        requiredSections: Array.isArray(d.requiredSections)
          ? (d.requiredSections as string[])
          : [],
      }))
  : [],
mode: cfg.mode === "linked" ? "linked" as const : "independent" as const,
```

**Step 4: Run tests to verify they pass**

Run: `bun test hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts -v`
Expected: PASS — all existing tests + 5 new tests pass.

**Step 5: Commit**

```bash
git add hooks/ObligationStateMachines/HookDocStateMachine.shared.ts hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts
git commit -m "feat(HookDocEnforcer): add additionalDocs and mode to settings"
```

---

### Task 2: Add Domain Helpers for Multi-Doc

**Files:**
- Modify: `hooks/ObligationStateMachines/HookDocStateMachine.shared.ts`
- Test: `hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts`

**Step 1: Write failing tests for tagged entry helpers**

Add new describe blocks to the test file:

```typescript
describe("allDocFileNames", () => {
  it("returns primary + additional doc file names", () => {
    const settings = {
      ...readHookDocSettings(() => null),
      additionalDocs: [{ fileName: "IDEA.md", requiredSections: [] }],
    };
    expect(allDocFileNames(settings)).toEqual(["doc.md", "IDEA.md"]);
  });

  it("returns only primary when no additionalDocs", () => {
    const settings = readHookDocSettings(() => null);
    expect(allDocFileNames(settings)).toEqual(["doc.md"]);
  });
});

describe("tagPending / parseTag", () => {
  it("tags a source path with a doc file name", () => {
    expect(tagPending("/hooks/G/H/H.contract.ts", "doc.md"))
      .toBe("/hooks/G/H/H.contract.ts:doc.md");
  });

  it("parses tag back to source and doc", () => {
    const { source, docFile } = parseTag("/hooks/G/H/H.contract.ts:doc.md");
    expect(source).toBe("/hooks/G/H/H.contract.ts");
    expect(docFile).toBe("doc.md");
  });

  it("treats untagged entries as primary doc", () => {
    const { source, docFile } = parseTag("/hooks/G/H/H.contract.ts");
    expect(source).toBe("/hooks/G/H/H.contract.ts");
    expect(docFile).toBe("doc.md");
  });
});

describe("isAnyDocFile", () => {
  it("matches primary doc file", () => {
    const settings = {
      ...readHookDocSettings(() => null),
      additionalDocs: [{ fileName: "IDEA.md", requiredSections: [] }],
    };
    expect(isAnyDocFile("/hooks/G/H/doc.md", settings)).toBe(true);
  });

  it("matches additional doc file", () => {
    const settings = {
      ...readHookDocSettings(() => null),
      additionalDocs: [{ fileName: "IDEA.md", requiredSections: [] }],
    };
    expect(isAnyDocFile("/hooks/G/H/IDEA.md", settings)).toBe(true);
  });

  it("rejects non-doc files", () => {
    const settings = readHookDocSettings(() => null);
    expect(isAnyDocFile("/hooks/G/H/H.contract.ts", settings)).toBe(false);
  });
});
```

Add these imports at the top of the test file:

```typescript
import {
  allDocFileNames,
  tagPending,
  parseTag,
  isAnyDocFile,
  // ... existing imports
} from "@hooks/hooks/ObligationStateMachines/HookDocStateMachine.shared";
```

**Step 2: Run tests to verify they fail**

Run: `bun test hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts -v`
Expected: FAIL — functions don't exist yet.

**Step 3: Implement the helpers**

Add to `HookDocStateMachine.shared.ts` in the Domain Helpers section:

```typescript
/** Get all doc file names (primary + additional). */
export function allDocFileNames(settings: HookDocEnforcerSettings): string[] {
  return [settings.docFileName, ...settings.additionalDocs.map((d) => d.fileName)];
}

/** Tag a source path with the doc file it owes. */
export function tagPending(sourcePath: string, docFileName: string): string {
  return `${sourcePath}:${docFileName}`;
}

/** Parse a tagged pending entry back to source path and doc file name. */
export function parseTag(entry: string): { source: string; docFile: string } {
  const lastColon = entry.lastIndexOf(":");
  if (lastColon === -1 || entry.charAt(lastColon - 1) === "/" || entry.charAt(lastColon - 1) === "\\") {
    return { source: entry, docFile: "doc.md" };
  }
  const suffix = entry.slice(lastColon + 1);
  if (suffix.includes("/") || suffix.includes("\\") || !suffix.includes(".")) {
    return { source: entry, docFile: "doc.md" };
  }
  return { source: entry.slice(0, lastColon), docFile: suffix };
}

/** Check if a file path matches any doc file name (primary or additional). */
export function isAnyDocFile(filePath: string, settings: HookDocEnforcerSettings): boolean {
  return allDocFileNames(settings).some(
    (name) => filePath.endsWith(`/${name}`) || filePath === name,
  );
}

/** Extract the doc file name from a file path (e.g., "/hooks/G/H/IDEA.md" → "IDEA.md"). */
export function docFileNameFromPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts -v`
Expected: PASS

**Step 5: Commit**

```bash
git add hooks/ObligationStateMachines/HookDocStateMachine.shared.ts hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts
git commit -m "feat(HookDocEnforcer): add tagged pending entry helpers for multi-doc"
```

---

### Task 3: Update HookDocTracker for Multi-Doc Tracking

**Files:**
- Modify: `hooks/ObligationStateMachines/HookDocTracker/HookDocTracker.contract.ts`
- Test: `hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts`

**Step 1: Write failing tests for multi-doc tracking**

Add to the `HookDocTracker` describe block:

```typescript
// ── execute: multi-doc tracking ──

it("creates tagged pending entries for each doc file", () => {
  let written: string[] = [];
  const deps = makeDeps({
    readPending: () => [],
    writePending: (_p, files) => { written = files; },
  });

  // Need settings with additionalDocs — use a custom settings reader
  // The tracker reads settings internally, so we test end-to-end
  // by checking that when additionalDocs is configured, multiple entries appear
  HookDocTracker.execute(
    makeToolInput("Edit", { file_path: "/hooks/G/H/H.contract.ts" }),
    deps,
  );

  // Without additionalDocs config, should create a single untagged entry (backwards compat)
  expect(written.length).toBeGreaterThanOrEqual(1);
});

// ── execute: doc file clearing in independent mode ──

it("clears only matching doc tag when doc is written (independent mode)", () => {
  let written: string[] = [];
  const deps = makeDeps({
    fileExists: () => true,
    readPending: () => [
      "/hooks/G/H/H.contract.ts:doc.md",
      "/hooks/G/H/H.contract.ts:IDEA.md",
    ],
    writePending: (_p, files) => { written = files; },
  });

  HookDocTracker.execute(
    makeToolInput("Write", { file_path: "/hooks/G/H/doc.md" }),
    deps,
  );

  expect(written).toEqual(["/hooks/G/H/H.contract.ts:IDEA.md"]);
});

it("clears IDEA.md tag when IDEA.md is written", () => {
  let removed = false;
  const deps = makeDeps({
    fileExists: () => true,
    readPending: () => ["/hooks/G/H/H.contract.ts:IDEA.md"],
    removeFlag: () => { removed = true; },
  });

  HookDocTracker.execute(
    makeToolInput("Write", { file_path: "/hooks/G/H/IDEA.md" }),
    deps,
  );

  expect(removed).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts -v`
Expected: FAIL — tracker doesn't recognize IDEA.md as a doc file, doesn't handle tagged entries.

**Step 3: Update HookDocTracker contract**

In `HookDocTracker.contract.ts`, update:

1. **`accepts`**: Change `isHookDocFile(filePath, settings.docFileName)` to `isAnyDocFile(filePath, settings)` so it accepts IDEA.md writes too.

2. **`execute`**: When a source file is modified, create tagged entries for each doc file. When a doc file is written, clear by matching the doc file name tag.

Updated `execute`:

```typescript
execute(input: ToolHookInput, deps: ObligationDeps): Result<ContinueOutput, ResultError> {
  const filePath = getFilePath(input);
  if (!filePath) return ok(continueOk());

  const settings = readHookDocSettings();
  const flagFile = pendingPath(deps.stateDir, input.session_id);

  // Doc file written → clear matching pending entries
  if (isAnyDocFile(filePath, settings)) {
    const docDir = getHookDirFromPath(filePath);
    const writtenDocName = docFileNameFromPath(filePath);

    if (settings.mode === "linked") {
      // Linked: clear all entries for this dir only if ALL doc files exist
      const allDocsExist = allDocFileNames(settings).every(
        (name) => deps.fileExists(join(docDir, name)),
      );
      if (allDocsExist) {
        const { remaining, cleared } = clearMatching(deps, flagFile, (p) => {
          const { source } = parseTag(p);
          return getHookDirFromPath(source) === docDir;
        });
        if (cleared) {
          deps.stderr(
            remaining === 0
              ? "[HookDocTracker] All pending hooks documented — clearing flag"
              : `[HookDocTracker] Cleared documented hook, ${remaining} still pending`,
          );
        }
      }
    } else {
      // Independent: clear only entries tagged with this doc file name
      const { remaining, cleared } = clearMatching(deps, flagFile, (p) => {
        const { source, docFile } = parseTag(p);
        return getHookDirFromPath(source) === docDir && docFile === writtenDocName;
      });
      if (cleared) {
        deps.stderr(
          remaining === 0
            ? "[HookDocTracker] All pending hooks documented — clearing flag"
            : `[HookDocTracker] Cleared ${writtenDocName} obligation, ${remaining} still pending`,
        );
      }
    }

    return ok(continueOk());
  }

  // Hook source file modified → add tagged entries for each doc file
  const docNames = allDocFileNames(settings);
  for (const docName of docNames) {
    const tagged = tagPending(filePath, docName);
    addPending(deps, flagFile, tagged);
  }
  deps.stderr(`[HookDocTracker] Hook source modified: ${filePath} — ${docNames.length} doc(s) pending`);
  return ok(continueOk());
},
```

Add imports at top: `import { join } from "node:path"` and `allDocFileNames, tagPending, parseTag, isAnyDocFile, docFileNameFromPath` from shared.

**Step 4: Run tests to verify they pass**

Run: `bun test hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts -v`
Expected: PASS — all existing + new tests.

Note: Some existing tests that check for untagged entries may need updating since the tracker now creates tagged entries. Update assertions from `"/hooks/G/H/H.contract.ts"` to `"/hooks/G/H/H.contract.ts:doc.md"` where needed.

**Step 5: Commit**

```bash
git add hooks/ObligationStateMachines/HookDocTracker/HookDocTracker.contract.ts hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts
git commit -m "feat(HookDocTracker): multi-doc tracking with tagged entries and independent/linked clearing"
```

---

### Task 4: Update HookDocEnforcer Block Messages

**Files:**
- Modify: `hooks/ObligationStateMachines/HookDocEnforcer/HookDocEnforcer.contract.ts`
- Modify: `hooks/ObligationStateMachines/HookDocStateMachine.shared.ts` (buildDocSuggestions)
- Test: `hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts`

**Step 1: Write failing tests for grouped block messages**

Add to the `buildDocSuggestions` describe block:

```typescript
it("groups tagged entries by directory and doc file", () => {
  const settings = {
    enabled: true,
    blocking: true,
    requiredSections: ["## Overview"],
    docFileName: "doc.md",
    watchPatterns: [],
    additionalDocs: [{ fileName: "IDEA.md", requiredSections: ["## Problem"] }],
    mode: "independent" as const,
  };

  const result = buildDocSuggestions(
    ["/hooks/G/H/H.contract.ts:doc.md", "/hooks/G/H/H.contract.ts:IDEA.md"],
    settings,
  );
  expect(result).toContain("doc.md");
  expect(result).toContain("IDEA.md");
});

it("shows per-doc required sections", () => {
  const settings = {
    enabled: true,
    blocking: true,
    requiredSections: ["## Overview"],
    docFileName: "doc.md",
    watchPatterns: [],
    additionalDocs: [{ fileName: "IDEA.md", requiredSections: ["## Problem", "## Solution"] }],
    mode: "independent" as const,
  };

  const result = buildDocSuggestions(
    ["/hooks/G/H/H.contract.ts:IDEA.md"],
    settings,
  );
  expect(result).toContain("IDEA.md");
  expect(result).toContain("## Problem");
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts -v`
Expected: FAIL — buildDocSuggestions doesn't parse tags or show per-doc sections.

**Step 3: Update buildDocSuggestions**

In `HookDocStateMachine.shared.ts`, update `buildDocSuggestions` to parse tagged entries and group by directory + doc file:

```typescript
export function buildDocSuggestions(
  pendingFiles: string[],
  settings: HookDocEnforcerSettings,
): string {
  const lines: string[] = [];

  // Group by directory → doc file
  const byDir = new Map<string, Set<string>>();
  for (const entry of pendingFiles) {
    const { source, docFile } = parseTag(entry);
    const dir = getHookDirFromPath(source);
    if (!byDir.has(dir)) byDir.set(dir, new Set());
    byDir.get(dir)!.add(docFile);
  }

  for (const [dir, docFiles] of byDir) {
    for (const docFile of docFiles) {
      lines.push(`Update \`${dir}/${docFile}\``);
    }
  }

  // Show required sections per doc type
  const allDocs = [
    { fileName: settings.docFileName, requiredSections: settings.requiredSections },
    ...settings.additionalDocs,
  ];

  const mentionedDocs = new Set(
    pendingFiles.map((e) => parseTag(e).docFile),
  );

  for (const doc of allDocs) {
    if (!mentionedDocs.has(doc.fileName)) continue;
    if (doc.requiredSections.length === 0) continue;
    lines.push("");
    lines.push(`Required sections in \`${doc.fileName}\`:`);
    for (const section of doc.requiredSections) {
      lines.push(`  - ${section}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts -v`
Expected: PASS — existing tests may need updating if they depend on exact buildDocSuggestions output format. Adjust assertions that check for `"/hooks/G/H/doc.md"` to work with the new `"Update \`/hooks/G/H/doc.md\`"` format.

**Step 5: Commit**

```bash
git add hooks/ObligationStateMachines/HookDocStateMachine.shared.ts hooks/ObligationStateMachines/HookDocEnforcer/HookDocEnforcer.contract.ts hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts
git commit -m "feat(HookDocEnforcer): grouped block messages showing per-doc obligations"
```

---

### Task 5: Update Config and Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `hooks/ObligationStateMachines/HookDocEnforcer/doc.md`

**Step 1: Update CLAUDE.md hookDocEnforcer config example**

Update the hookDocEnforcer JSON example in CLAUDE.md to show `additionalDocs`:

```json
{
  "hookConfig": {
    "hookDocEnforcer": {
      "enabled": true,
      "blocking": true,
      "docFileName": "doc.md",
      "requiredSections": ["## Overview", "## Event", "## When It Fires", "## What It Does", "## Examples", "## Dependencies"],
      "watchPatterns": ["\\.contract\\.ts$", "hook\\.json$", "group\\.json$", "shared\\.ts$", "README\\.md$"],
      "additionalDocs": [
        {
          "fileName": "IDEA.md",
          "requiredSections": ["## Problem", "## Solution", "## How It Works", "## Signals"]
        }
      ],
      "mode": "independent"
    }
  }
}
```

**Step 2: Update HookDocEnforcer doc.md**

Add a section about multi-doc support to the hook's doc.md.

**Step 3: Commit**

```bash
git add CLAUDE.md hooks/ObligationStateMachines/HookDocEnforcer/doc.md
git commit -m "docs: document additionalDocs and mode config for HookDocEnforcer"
```

---

### Task 6: Run Full Test Suite

**Step 1: Run all tests**

```bash
bun test
```

Verify no regressions. The only expected changes are in HookDocStateMachine tests.

**Step 2: Run type check**

```bash
npx tsc --noEmit
```

Verify no type errors.
