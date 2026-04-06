# Pattern Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add auto-detected pattern recognition to DuplicationChecker so it advises when a function matches a recurring codebase pattern (e.g., `makeDeps` in 65 files).

**Architecture:** Two-tier sig normalization in `hooks/DuplicationDetection/shared.ts`, pattern detection pass in `hooks/DuplicationDetection/index-builder-logic.ts:104-124` (`buildResult`) after building entries, pattern advisory in `hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.contract.ts:98-211` (`execute`) before pair-wise check. Config via `readHookConfig("duplicationChecker")` (`lib/hook-config.ts:28-38`).

**Tech Stack:** TypeScript, Bun test runner, existing pai-hooks contract pattern (SyncHookContract, Result type, DI via deps)

**Design doc:** `docs/plans/2026-04-06-pattern-detection-design.md`

---

### Task 1: Add PatternEntry type and normalization functions to shared.ts

**Files:**
- Modify: `hooks/DuplicationDetection/shared.ts:15-39` (types section)
- Test: `hooks/DuplicationDetection/shared.test.ts`

**Step 1: Write the failing tests for normalization functions**

Add to `shared.test.ts`:

```ts
import {
  PROJECT_MARKERS,
  findIndexPath,
  getArtifactsDir,
  projectHash,
  normalizeParam,
  normalizeReturn,
  isPrimitiveReturn,
} from "@hooks/hooks/DuplicationDetection/shared";

// ... existing tests ...

describe("normalizeParam", () => {
  test("replaces Partial<ConcreteType> with Partial<*>", () => {
    expect(normalizeParam("Partial<SessionSummaryDeps>")).toBe("Partial<*>");
  });

  test("replaces Record<K,V> with Record<*,*>", () => {
    expect(normalizeParam("Record<string,unknown>")).toBe("Record<*,*>");
  });

  test("leaves primitive types unchanged", () => {
    expect(normalizeParam("string")).toBe("string");
    expect(normalizeParam("number")).toBe("number");
  });

  test("handles empty string", () => {
    expect(normalizeParam("")).toBe("");
  });

  test("handles compound params", () => {
    expect(normalizeParam("Partial<FooDeps>,string")).toBe("Partial<*>,string");
  });
});

describe("normalizeReturn", () => {
  test("replaces *Deps suffix with *Deps", () => {
    expect(normalizeReturn("SessionSummaryDeps")).toBe("*Deps");
    expect(normalizeReturn("CanaryHookDeps")).toBe("*Deps");
  });

  test("replaces *Input suffix with *Input", () => {
    expect(normalizeReturn("ToolHookInput")).toBe("*Input");
    expect(normalizeReturn("SessionEndInput")).toBe("*Input");
  });

  test("replaces *Output suffix with *Output", () => {
    expect(normalizeReturn("ContinueOutput")).toBe("*Output");
    expect(normalizeReturn("BlockOutput")).toBe("*Output");
  });

  test("leaves primitive types unchanged", () => {
    expect(normalizeReturn("string")).toBe("string");
    expect(normalizeReturn("void")).toBe("void");
    expect(normalizeReturn("number")).toBe("number");
  });

  test("handles empty string", () => {
    expect(normalizeReturn("")).toBe("");
  });
});

describe("isPrimitiveReturn", () => {
  test("returns true for string, void, number, boolean", () => {
    expect(isPrimitiveReturn("string")).toBe(true);
    expect(isPrimitiveReturn("void")).toBe(true);
    expect(isPrimitiveReturn("number")).toBe(true);
    expect(isPrimitiveReturn("boolean")).toBe(true);
  });

  test("returns true for empty string", () => {
    expect(isPrimitiveReturn("")).toBe(true);
  });

  test("returns true for common non-domain types", () => {
    expect(isPrimitiveReturn("{object}")).toBe(true);
    expect(isPrimitiveReturn("string|null")).toBe(true);
  });

  test("returns false for domain types", () => {
    expect(isPrimitiveReturn("*Deps")).toBe(false);
    expect(isPrimitiveReturn("*Input")).toBe(false);
    expect(isPrimitiveReturn("*Output")).toBe(false);
    expect(isPrimitiveReturn("ToolHookInput")).toBe(false);
    expect(isPrimitiveReturn("Promise<void>")).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test hooks/DuplicationDetection/shared.test.ts`
Expected: FAIL — `normalizeParam`, `normalizeReturn`, `isPrimitiveReturn` not exported

**Step 3: Add PatternEntry type and normalization functions to shared.ts**

Add `PatternEntry` to the types section after `DuplicationMatch` (`shared.ts:41-50`):

```ts
export interface PatternEntry {
  id: string;
  name: string;
  sig: string;
  tier: 1 | 2;
  fileCount: number;
  files: string[];
}
```

Add to the `DuplicationIndex` interface (`shared.ts:28-39`, after `sigGroups`):

```ts
  patterns?: PatternEntry[];
```

Add normalization functions after the `simulateEdit` function (`shared.ts:63-69`):

```ts
// ─── Sig Normalization ─────────────────────────────────────────────────────

export function normalizeParam(param: string): string {
  let p = param;
  p = p.replace(/Partial<\w+>/g, "Partial<*>");
  p = p.replace(/Record<\w+,\w+>/g, "Record<*,*>");
  return p;
}

export function normalizeReturn(ret: string): string {
  let r = ret;
  r = r.replace(/\w+Deps$/, "*Deps");
  r = r.replace(/\w+Input$/, "*Input");
  r = r.replace(/\w+Output$/, "*Output");
  return r;
}

const PRIMITIVE_RETURNS = new Set(["string", "number", "boolean", "void", "{object}", "", "string|null"]);

export function isPrimitiveReturn(normalizedReturn: string): boolean {
  return PRIMITIVE_RETURNS.has(normalizedReturn);
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test hooks/DuplicationDetection/shared.test.ts`
Expected: PASS

**Step 5: Run full test suite to verify no regressions**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test`
Expected: All existing tests pass

**Step 6: Commit**

```bash
cd /Users/hogers/.claude/pai-hooks
git add hooks/DuplicationDetection/shared.ts hooks/DuplicationDetection/shared.test.ts
git commit -m "feat(DuplicationDetection): add PatternEntry type and sig normalization functions"
```

---

### Task 2: Add pattern detection to index builder logic

**Files:**
- Modify: `hooks/DuplicationDetection/index-builder-logic.ts:104-124` (buildResult function)
- Test: `hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.test.ts`

**Step 1: Write the failing test for pattern detection in built index**

Add to `DuplicationIndexBuilder.test.ts`, inside the `describe("execute()")` block, after the existing tests:

```ts
    test("built index contains patterns array", () => {
      let capturedContent = "";

      const deps = makeMockDeps({
        writeFile: (_path: string, content: string): boolean => {
          capturedContent = content;
          return true;
        },
        exists: (): boolean => false,
        stat: (): null => null,
        findProjectRoot: (): string => PAI_HOOKS_ROOT,
      });

      const input = makeWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`, "");
      unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      const index = JSON.parse(capturedContent) as DuplicationIndex;
      expect(Array.isArray(index.patterns)).toBe(true);
    });

    test("detects makeDeps as a pattern (threshold 5, tier 1)", () => {
      let capturedContent = "";

      const deps = makeMockDeps({
        writeFile: (_path: string, content: string): boolean => {
          capturedContent = content;
          return true;
        },
        exists: (): boolean => false,
        stat: (): null => null,
        findProjectRoot: (): string => PAI_HOOKS_ROOT,
      });

      const input = makeWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`, "");
      unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      const index = JSON.parse(capturedContent) as DuplicationIndex;
      const makeDepsPattern = index.patterns?.find((p) => p.name === "makeDeps");
      expect(makeDepsPattern).toBeDefined();
      expect(makeDepsPattern!.tier).toBe(1);
      expect(makeDepsPattern!.fileCount).toBeGreaterThanOrEqual(5);
    });

    test("detects makeInput as a pattern (tier 2, return-only fallback)", () => {
      let capturedContent = "";

      const deps = makeMockDeps({
        writeFile: (_path: string, content: string): boolean => {
          capturedContent = content;
          return true;
        },
        exists: (): boolean => false,
        stat: (): null => null,
        findProjectRoot: (): string => PAI_HOOKS_ROOT,
      });

      const input = makeWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`, "");
      unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      const index = JSON.parse(capturedContent) as DuplicationIndex;
      const makeInputPattern = index.patterns?.find((p) => p.name === "makeInput");
      expect(makeInputPattern).toBeDefined();
      expect(makeInputPattern!.tier).toBe(2);
    });

    test("does not detect 'main' as a pattern (primitive return filtered)", () => {
      let capturedContent = "";

      const deps = makeMockDeps({
        writeFile: (_path: string, content: string): boolean => {
          capturedContent = content;
          return true;
        },
        exists: (): boolean => false,
        stat: (): null => null,
        findProjectRoot: (): string => PAI_HOOKS_ROOT,
      });

      const input = makeWriteInput(`${PAI_HOOKS_ROOT}/hooks/SomeHook/SomeHook.ts`, "");
      unwrap(DuplicationIndexBuilderContract.execute(input, deps));

      const index = JSON.parse(capturedContent) as DuplicationIndex;
      const mainPattern = index.patterns?.find((p) => p.name === "main");
      expect(mainPattern).toBeUndefined();
    });
```

Also add `import type { DuplicationIndex }` to the imports if not already present (it's already imported on line 21).

**Step 2: Run tests to verify they fail**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.test.ts`
Expected: FAIL — `index.patterns` is undefined

**Step 3: Add detectPatterns function and wire it into buildResult**

In `index-builder-logic.ts` (current imports at lines 11-17), update the import:

```ts
import {
  getCurrentBranch,
  normalizeParam,
  normalizeReturn,
  isPrimitiveReturn,
  type DuplicationIndex,
  type IndexEntry,
  type PatternEntry,
} from "@hooks/hooks/DuplicationDetection/shared";
```

Add the `detectPatterns` function before `buildResult` (`index-builder-logic.ts:104`):

```ts
// ─── Pattern Detection ─────────────────────────────────────────────────────

const DEFAULT_PATTERN_THRESHOLD = 5;
const DEFAULT_SIG_MATCH_PERCENT = 60;

function detectPatterns(
  entries: IndexEntry[],
  nameGroups: [string, number[]][],
  threshold: number = DEFAULT_PATTERN_THRESHOLD,
  sigMatchPercent: number = DEFAULT_SIG_MATCH_PERCENT,
): PatternEntry[] {
  const patterns: PatternEntry[] = [];
  const minRatio = sigMatchPercent / 100;

  for (const [name, indices] of nameGroups) {
    if (indices.length < threshold) continue;

    // Tier 1: full normalized sig match (params + return)
    const fullSigCounts = new Map<string, number>();
    const filesByFullSig = new Map<string, string[]>();
    for (const idx of indices) {
      const e = entries[idx];
      const normSig = `(${normalizeParam(e.p)})→${normalizeReturn(e.r)}`;
      fullSigCounts.set(normSig, (fullSigCounts.get(normSig) ?? 0) + 1);
      const files = filesByFullSig.get(normSig) ?? [];
      files.push(e.f);
      filesByFullSig.set(normSig, files);
    }

    let topFullSig = "";
    let topFullCount = 0;
    for (const [sig, count] of fullSigCounts) {
      if (count > topFullCount) {
        topFullSig = sig;
        topFullCount = count;
      }
    }

    if (topFullCount / indices.length >= minRatio) {
      const files = filesByFullSig.get(topFullSig) ?? [];
      const uniqueFiles = [...new Set(files)];
      patterns.push({
        id: `${name}:${topFullSig}`,
        name,
        sig: topFullSig,
        tier: 1,
        fileCount: uniqueFiles.length,
        files: uniqueFiles.slice(0, 5),
      });
      continue;
    }

    // Tier 2: return-only fallback (domain types only)
    const retCounts = new Map<string, number>();
    const filesByRet = new Map<string, string[]>();
    for (const idx of indices) {
      const e = entries[idx];
      const normRet = normalizeReturn(e.r);
      retCounts.set(normRet, (retCounts.get(normRet) ?? 0) + 1);
      const files = filesByRet.get(normRet) ?? [];
      files.push(e.f);
      filesByRet.set(normRet, files);
    }

    let topRet = "";
    let topRetCount = 0;
    for (const [ret, count] of retCounts) {
      if (count > topRetCount) {
        topRet = ret;
        topRetCount = count;
      }
    }

    if (topRetCount / indices.length >= minRatio && !isPrimitiveReturn(topRet)) {
      const files = filesByRet.get(topRet) ?? [];
      const uniqueFiles = [...new Set(files)];
      patterns.push({
        id: `${name}:()→${topRet}`,
        name,
        sig: `()→${topRet}`,
        tier: 2,
        fileCount: uniqueFiles.length,
        files: uniqueFiles.slice(0, 5),
      });
    }
  }

  return patterns;
}
```

Modify `buildResult` (`index-builder-logic.ts:104-124`) to call `detectPatterns` and include the result:

```ts
function buildResult(
  root: string,
  entries: IndexEntry[],
  fileCount: number,
  branch: string | null,
): DuplicationIndex {
  const nameGroups = groupByField(entries, (e) => e.n).filter(([_, idxs]) => idxs.length >= 2);

  return {
    version: 1,
    root,
    branch: branch ?? undefined,
    builtAt: new Date().toISOString(),
    fileCount,
    functionCount: entries.length,
    entries,
    hashGroups: groupByField(entries, (e) => e.h).filter(([_, idxs]) => idxs.length >= 2),
    nameGroups,
    sigGroups: groupByField(entries, (e) => `(${e.p})→${e.r}`).filter(
      ([_, idxs]) => idxs.length >= 3,
    ),
    patterns: detectPatterns(entries, nameGroups),
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
cd /Users/hogers/.claude/pai-hooks
git add hooks/DuplicationDetection/index-builder-logic.ts hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.test.ts
git commit -m "feat(DuplicationDetection): add pattern detection to index builder"
```

---

### Task 3: Add pattern config reading to DuplicationChecker

**Files:**
- Modify: `hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.contract.ts:44-60` (deps and config)

**Step 1: Extend config reading to include pattern settings**

In `DuplicationChecker.contract.ts`, update the config interface and `readBlockingConfig` area (`DuplicationChecker.contract.ts:55-60`). Replace the config section with:

```ts
// ─── Config ─────────────────────────────────────────────────────────────────

interface DuplicationCheckerConfig {
  blocking?: boolean;
  patternThreshold?: number;
  requireSigMatch?: boolean;
  sigMatchPercent?: number;
}

function readConfig(): DuplicationCheckerConfig {
  return readHookConfig<DuplicationCheckerConfig>("duplicationChecker") ?? {};
}

function readBlockingConfig(): boolean {
  return readConfig().blocking !== false;
}
```

Add `patternThreshold`, `requireSigMatch`, and `sigMatchPercent` to `DuplicationCheckerDeps`:

```ts
export interface DuplicationCheckerDeps {
  readFile: (path: string) => string | null;
  exists: (path: string) => boolean;
  appendFile: (path: string, content: string) => void;
  ensureDir: (path: string) => void;
  stderr: (msg: string) => void;
  now: () => number;
  blocking: boolean;
  patternThreshold: number;
  requireSigMatch: boolean;
  sigMatchPercent: number;
}
```

Update `defaultDeps` to include the new fields:

```ts
const defaultDeps: DuplicationCheckerDeps = {
  // ... existing fields ...
  blocking: readBlockingConfig(),
  patternThreshold: readConfig().patternThreshold ?? 5,
  requireSigMatch: readConfig().requireSigMatch ?? true,
  sigMatchPercent: readConfig().sigMatchPercent ?? 60,
};
```

**Step 2: Run tests to verify nothing breaks**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.test.ts`
Expected: PASS (existing tests still work — they spread `mockDeps` which will get defaults)

**Step 3: Update mockDeps in test file**

In `DuplicationChecker.test.ts`, add the new fields to `mockDeps` (around line 44):

```ts
const mockDeps: DuplicationCheckerDeps = {
  readFile: (path) => require("node:fs").readFileSync(path, "utf-8") as string,
  exists: (path) => require("node:fs").existsSync(path) as boolean,
  appendFile: () => {},
  ensureDir: () => {},
  stderr: () => {},
  now: () => Date.now(),
  blocking: true,
  patternThreshold: 5,
  requireSigMatch: true,
  sigMatchPercent: 60,
};
```

**Step 4: Run tests, commit**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.test.ts`
Expected: PASS

```bash
cd /Users/hogers/.claude/pai-hooks
git add hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.contract.ts hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.test.ts
git commit -m "feat(DuplicationChecker): add pattern config to deps and config reader"
```

---

### Task 4: Add pattern advisory to DuplicationChecker execute()

**Files:**
- Modify: `hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.contract.ts:98-165` (execute function)
- Test: `hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.test.ts`

**Step 1: Write failing tests for pattern advisory**

Add to `DuplicationChecker.test.ts`, inside `describe("execute()")`:

```ts
    test("injects additionalContext when function matches a known pattern", () => {
      // Write a new makeDeps function — should match the makeDeps pattern in the index
      const patternContent = `
function makeDeps(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return { stderr: () => {}, now: () => Date.now(), ...overrides };
}
      `.trim();

      const stderrMessages: string[] = [];
      const deps: DuplicationCheckerDeps = {
        ...mockDeps,
        stderr: (msg) => stderrMessages.push(msg),
      };

      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/DuplicationDetection/SomeNewHook.ts`,
        patternContent,
      );
      const output = unwrap(DuplicationCheckerContract.execute(input, deps));
      expect(output.type).toBe("continue");
      if (output.type === "continue") {
        expect(output.additionalContext).toBeDefined();
        expect(output.additionalContext).toContain("Pattern detected");
        expect(output.additionalContext).toContain("makeDeps");
      }
    });

    test("no pattern advisory for unique function names", () => {
      const uniqueContent = `
function superUniqueSpecialFunction123(): string {
  return "unique";
}
      `.trim();

      const deps: DuplicationCheckerDeps = { ...mockDeps };
      const input = makeWriteInput(
        `${PAI_HOOKS_ROOT}/hooks/DuplicationDetection/SomeNewHook.ts`,
        uniqueContent,
      );
      const output = unwrap(DuplicationCheckerContract.execute(input, deps));
      expect(output.type).toBe("continue");
      if (output.type === "continue") {
        expect(output.additionalContext).toBeUndefined();
      }
    });
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.test.ts`
Expected: FAIL — no pattern advisory logic exists yet

**Step 3: Implement pattern advisory in execute()**

In `DuplicationChecker.contract.ts`, add the import for `PatternEntry` and `normalizeParam`/`normalizeReturn`:

```ts
import {
  BLOCK_THRESHOLD,
  checkFunctions,
  findIndexPath,
  getArtifactsDir,
  getCurrentBranch,
  loadIndex,
  normalizeParam,
  normalizeReturn,
  simulateEdit,
  type PatternEntry,
} from "@hooks/hooks/DuplicationDetection/shared";
```

In the `execute` function, after extracting functions (`DuplicationChecker.contract.ts:130-135`) and before the pair-wise `checkFunctions` call (`DuplicationChecker.contract.ts:141`), add pattern lookup:

```ts
    // ─── Pattern advisory ───────────────────────────────────────────────
    const patternAdvisories: string[] = [];
    if (index.patterns && index.patterns.length > 0) {
      const patternMap = new Map<string, PatternEntry>(
        index.patterns.map((p) => [p.name, p]),
      );
      for (const fn of functions) {
        const pattern = patternMap.get(fn.name);
        if (!pattern) continue;
        const examples = pattern.files.slice(0, 3).join(", ");
        patternAdvisories.push(
          `Pattern detected: "${pattern.name}" (${pattern.fileCount} instances across ${pattern.fileCount} files)\n` +
          `  This function matches a recurring pattern. Consider extracting a shared factory.\n` +
          `  Examples: ${examples}`,
        );
      }
    }
```

Then, when returning the result, merge pattern advisories with any existing `additionalContext`. Modify the final return paths:

After the derivation match return (`DuplicationChecker.contract.ts:197-206`), and before the "2-3 signals: log only" return (`DuplicationChecker.contract.ts:208-210`), change the final fallback returns to include pattern context.

The cleanest approach: collect pattern advisories at the top, then at each `continueOk()` return point, attach them if present. Add a helper at the top of `execute`:

```ts
    function continueWithPatterns(extra?: string): ContinueOutput {
      const parts = [...patternAdvisories];
      if (extra) parts.push(extra);
      if (parts.length === 0) return continueOk();
      return { ...continueOk(), additionalContext: parts.join("\n\n") };
    }
```

Then replace each `return ok(continueOk())` in execute with `return ok(continueWithPatterns())`, and the derivation return with `return ok(continueWithPatterns(advisory))`.

**Important:** The pattern advisory computation must happen **after** `functions` is populated (line 135) but **before** the first return. The `continueWithPatterns` helper must be declared after `patternAdvisories` is populated.

Also update the log entry to include patterns:

```ts
    const logEntry = {
      ts: new Date(deps.now()).toISOString(),
      branch,
      file: relPath,
      functions: functions.length,
      matches: matches.map((m) => ({
        fn: m.functionName,
        target: `${m.targetFile}:${m.targetName}`,
        signals: m.signals,
        score: Math.round(m.topScore * 100),
      })),
      patterns: patternAdvisories.length > 0
        ? functions
            .filter((fn) => index.patterns?.some((p) => p.name === fn.name))
            .map((fn) => {
              const p = index.patterns!.find((pat) => pat.name === fn.name)!;
              return { fn: fn.name, patternId: p.id, instances: p.fileCount };
            })
        : undefined,
    };
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
cd /Users/hogers/.claude/pai-hooks
git add hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.contract.ts hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.test.ts
git commit -m "feat(DuplicationChecker): add pattern advisory via additionalContext"
```

---

### Task 5: Type check, full test suite, integration verification

**Files:**
- All modified files from Tasks 1-4

**Step 1: Run type checker**

Run: `cd /Users/hogers/.claude/pai-hooks && npx tsc --noEmit`
Expected: No errors

**Step 2: Run full test suite**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test`
Expected: All tests pass, no regressions

**Step 3: Verify pattern detection end-to-end**

Run the index builder against the real codebase and inspect the output:

```bash
cd /Users/hogers/.claude/pai-hooks && node -e "
const fs = require('fs');
const idx = JSON.parse(fs.readFileSync('/tmp/pai/duplication/685e053b/main/index.json', 'utf-8'));
console.log('Patterns detected:', idx.patterns?.length ?? 0);
for (const p of idx.patterns ?? []) {
  console.log('  ' + p.name + ' (tier ' + p.tier + ', ' + p.fileCount + ' files): ' + p.sig);
}
"
```

Note: The patterns won't appear in the existing cached index until the index builder runs again (next SessionStart or next Write/Edit to a .ts file). To force a rebuild, trigger a SessionStart or manually run the builder.

Expected: `makeDeps` (tier 1), `makeInput` (tier 2), `shortenPath` (tier 1), `blockCountPath` (tier 1) detected. `main` and `run` filtered out.

**Step 4: Commit any fixes from integration testing**

If any adjustments needed:

```bash
cd /Users/hogers/.claude/pai-hooks
git add -A
git commit -m "fix(DuplicationDetection): integration test adjustments for pattern detection"
```

---

### Task 6: Update documentation

**Files:**
- Modify: `hooks/DuplicationDetection/DuplicationChecker/doc.md`
- Modify: `hooks/DuplicationDetection/DuplicationChecker/IDEA.md`
- Modify: `hooks/DuplicationDetection/README.md`

**Step 1: Update doc.md**

Add a section about pattern detection to `DuplicationChecker/doc.md`, after the existing "What It Does" section. Include:
- Pattern detection as a new capability
- Two-tier sig matching explanation
- Config options (`patternThreshold`, `requireSigMatch`, `sigMatchPercent`)
- Example advisory output

**Step 2: Update IDEA.md**

Add pattern detection to the "How It Works" section as a new numbered step.

**Step 3: Update README.md**

Add pattern detection to the group-level README, mentioning the auto-detect approach and config options.

**Step 4: Run the doc enforcer check**

Run: `cd /Users/hogers/.claude/pai-hooks && bun run docs:check`
Expected: All hooks have valid doc.md

**Step 5: Commit**

```bash
cd /Users/hogers/.claude/pai-hooks
git add hooks/DuplicationDetection/DuplicationChecker/doc.md hooks/DuplicationDetection/DuplicationChecker/IDEA.md hooks/DuplicationDetection/README.md
git commit -m "docs(DuplicationDetection): document pattern detection feature"
```
