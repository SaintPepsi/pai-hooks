# `paih inspect` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `paih inspect <hookName>` command that shows hook state for a given project directory.

**Architecture:** The CLI command handler (`cli/commands/inspect.ts`) resolves the project path and dispatches to a hook-colocated inspector (`hooks/.../inspector.ts`). Only DuplicationChecker is supported initially. The inspector reuses `getArtifactsDir`, `projectHash`, and `getCurrentBranch` from `hooks/DuplicationDetection/shared.ts`.

**Tech Stack:** TypeScript, Bun, bun:test

---

### Task 1: Add `--project` and `--raw` flags to args parser

**Files:**

- Modify: `cli/core/args.ts:27-42` (flag sets)
- Test: `cli/core/args.test.ts` (if exists, add cases)

**Step 1: Write the failing test**

Add to the args test file (or create inline test):

```typescript
it("parses --project as value flag", () => {
  const result = parseArgs([
    "inspect",
    "DuplicationChecker",
    "--project",
    "/tmp/foo",
  ]);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.flags.project).toBe("/tmp/foo");
  }
});

it("parses --raw as boolean flag", () => {
  const result = parseArgs(["inspect", "DuplicationChecker", "--raw"]);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.flags.raw).toBe(true);
  }
});
```

**Step 2: Run test to verify it fails**

Run: `bun test cli/core/args.test.ts -t "parses --project"`
Expected: FAIL — `Unknown flag: --project`

**Step 3: Add the flags**

In `cli/core/args.ts`:

- Add `"--raw"` to `BOOLEAN_FLAGS`
- Add `"--project"` to `VALUE_FLAGS`

**Step 4: Run test to verify it passes**

Run: `bun test cli/core/args.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add cli/core/args.ts cli/core/args.test.ts
git commit -m "feat(cli): add --project and --raw flags to arg parser"
```

---

### Task 2: Create DuplicationChecker inspector

**Files:**

- Create: `hooks/DuplicationDetection/DuplicationChecker/inspector.ts`
- Create: `hooks/DuplicationDetection/DuplicationChecker/inspector.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "bun:test";
import { inspect } from "./inspector";

const MOCK_INDEX = JSON.stringify({
  version: 2,
  root: "/tmp/test-project",
  branch: "main",
  builtAt: "2026-04-08T04:32:01.000Z",
  fileCount: 28,
  functionCount: 142,
  entries: [
    {
      f: "src/a.ts",
      n: "foo",
      l: 1,
      h: "abc",
      p: "()",
      r: "void",
      fp: "a".repeat(32),
      s: 4,
    },
  ],
  hashGroups: [["abc", [0]]],
  nameGroups: [["foo", [0]]],
  sigGroups: [["()|void", [0]]],
  patterns: [
    {
      id: "p1",
      name: "helper",
      sig: "()",
      tier: 1,
      fileCount: 2,
      files: ["a.ts", "b.ts"],
    },
    {
      id: "p2",
      name: "util",
      sig: "(s: string)",
      tier: 2,
      fileCount: 3,
      files: ["c.ts", "d.ts", "e.ts"],
    },
  ],
});

describe("DuplicationChecker inspector", () => {
  const baseDeps = {
    readFile: (path: string) =>
      path.endsWith("index.json") ? MOCK_INDEX : null,
    exists: (path: string) => path.endsWith("index.json"),
    cwd: () => "/tmp/test-project",
    getBranch: (_dir: string) => "main",
  };

  it("returns summary with state file path", () => {
    const result = inspect("/tmp/test-project", baseDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.statePath).toContain("/tmp/pai/duplication/");
    expect(result.value.statePath).toEndWith("/index.json");
    expect(result.value.summary).toContain("28");
    expect(result.value.summary).toContain("142");
    expect(result.value.summary).toContain("State file:");
  });

  it("includes pattern tier breakdown in summary", () => {
    const result = inspect("/tmp/test-project", baseDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toContain("1 tier-1");
    expect(result.value.summary).toContain("1 tier-2");
  });

  it("returns raw index content", () => {
    const result = inspect("/tmp/test-project", baseDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.raw).toBe(MOCK_INDEX);
  });

  it("returns structured json data", () => {
    const result = inspect("/tmp/test-project", baseDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.json.fileCount).toBe(28);
    expect(result.value.json.functionCount).toBe(142);
    expect(result.value.json.statePath).toContain("index.json");
  });

  it("returns error when no index exists", () => {
    const noDeps = { ...baseDeps, exists: () => false, readFile: () => null };
    const result = inspect("/tmp/test-project", noDeps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("No state found");
    expect(result.error.message).toContain("/tmp/pai/duplication/");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test hooks/DuplicationDetection/DuplicationChecker/inspector.test.ts`
Expected: FAIL — module not found

**Step 3: Write the inspector**

Create `hooks/DuplicationDetection/DuplicationChecker/inspector.ts`:

```typescript
/**
 * Inspector for DuplicationChecker — reads the duplication index
 * and returns summary, raw, and structured JSON views.
 */

import { PaihError, PaihErrorCode } from "@hooks/cli/core/error";
import type { Result } from "@hooks/cli/core/result";
import { err, ok } from "@hooks/cli/core/result";
import type { DuplicationIndex } from "@hooks/hooks/DuplicationDetection/shared";
import {
  getArtifactsDir,
  projectHash,
} from "@hooks/hooks/DuplicationDetection/shared";

export interface InspectResult {
  statePath: string;
  summary: string;
  raw: string;
  json: Record<string, unknown>;
}

export interface InspectorDeps {
  readFile: (path: string) => string | null;
  exists: (path: string) => boolean;
  cwd: () => string;
  getBranch: (dir: string) => string | null;
}

export function inspect(
  projectDir: string,
  deps: InspectorDeps,
): Result<InspectResult, PaihError> {
  const branch = deps.getBranch(projectDir) ?? "default";
  const artifactsDir = getArtifactsDir(projectDir, branch);
  const statePath = `${artifactsDir}/index.json`;

  if (!deps.exists(statePath)) {
    return err(
      new PaihError(
        PaihErrorCode.HookNotFound,
        `No state found for DuplicationChecker at ${statePath}`,
        { statePath },
      ),
    );
  }

  const raw = deps.readFile(statePath);
  if (!raw) {
    return err(
      new PaihError(
        PaihErrorCode.HookNotFound,
        `Could not read state file: ${statePath}`,
        { statePath },
      ),
    );
  }

  let index: DuplicationIndex;
  try {
    index = JSON.parse(raw) as DuplicationIndex;
  } catch {
    return err(
      new PaihError(
        PaihErrorCode.ManifestParseError,
        `Invalid JSON in state file: ${statePath}`,
        { statePath },
      ),
    );
  }

  const tier1 = (index.patterns ?? []).filter((p) => p.tier === 1).length;
  const tier2 = (index.patterns ?? []).filter((p) => p.tier === 2).length;
  const patternTotal = tier1 + tier2;
  const patternDetail =
    patternTotal > 0 ? ` (${tier1} tier-1, ${tier2} tier-2)` : "";

  const summary = [
    `DuplicationChecker — state for ${projectDir}`,
    "",
    `  State file:    ${statePath}`,
    `  Built at:      ${index.builtAt}`,
    `  Branch:        ${index.branch ?? "unknown"}`,
    `  Files:         ${index.fileCount}`,
    `  Functions:     ${index.functionCount}`,
    `  Patterns:      ${patternTotal}${patternDetail}`,
    "",
    `  Hash groups:   ${index.hashGroups.length}`,
    `  Name groups:   ${index.nameGroups.length}`,
    `  Sig groups:    ${index.sigGroups.length}`,
  ].join("\n");

  return ok({
    statePath,
    summary,
    raw,
    json: {
      statePath,
      builtAt: index.builtAt,
      branch: index.branch ?? "unknown",
      fileCount: index.fileCount,
      functionCount: index.functionCount,
      patterns: patternTotal,
      tier1,
      tier2,
      hashGroups: index.hashGroups.length,
      nameGroups: index.nameGroups.length,
      sigGroups: index.sigGroups.length,
    },
  });
}
```

**Step 4: Run test to verify it passes**

Run: `bun test hooks/DuplicationDetection/DuplicationChecker/inspector.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add hooks/DuplicationDetection/DuplicationChecker/inspector.ts hooks/DuplicationDetection/DuplicationChecker/inspector.test.ts
git commit -m "feat(DuplicationChecker): add inspector for state inspection"
```

---

### Task 3: Create `inspect` CLI command

**Files:**

- Create: `cli/commands/inspect.ts`
- Create: `cli/commands/inspect.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "bun:test";
import { inspect } from "@hooks/cli/commands/inspect";
import type { ParsedArgs } from "@hooks/cli/core/args";
import { PaihErrorCode } from "@hooks/cli/core/error";

const MOCK_INDEX = JSON.stringify({
  version: 2,
  root: "/tmp/proj",
  branch: "main",
  builtAt: "2026-04-08T04:32:01.000Z",
  fileCount: 10,
  functionCount: 50,
  entries: [],
  hashGroups: [],
  nameGroups: [],
  sigGroups: [],
  patterns: [],
});

const makeDeps = (
  overrides?: Partial<{
    exists: (p: string) => boolean;
    readFile: (p: string) => string | null;
  }>,
) => ({
  readFile:
    overrides?.readFile ??
    ((p: string) => (p.endsWith("index.json") ? MOCK_INDEX : null)),
  exists: overrides?.exists ?? ((p: string) => p.endsWith("index.json")),
  cwd: () => "/tmp/proj",
  getBranch: () => "main",
});

describe("inspect command", () => {
  it("returns summary for DuplicationChecker", () => {
    const args: ParsedArgs = {
      command: "inspect",
      names: ["DuplicationChecker"],
      flags: {},
    };
    const result = inspect(args, makeDeps());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("DuplicationChecker");
      expect(result.value).toContain("State file:");
    }
  });

  it("respects --project flag", () => {
    const args: ParsedArgs = {
      command: "inspect",
      names: ["DuplicationChecker"],
      flags: { project: "/other/dir" },
    };
    const result = inspect(args, makeDeps());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("/other/dir");
    }
  });

  it("returns raw output with --raw flag", () => {
    const args: ParsedArgs = {
      command: "inspect",
      names: ["DuplicationChecker"],
      flags: { raw: true },
    };
    const result = inspect(args, makeDeps());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(MOCK_INDEX);
    }
  });

  it("returns JSON with --json flag", () => {
    const args: ParsedArgs = {
      command: "inspect",
      names: ["DuplicationChecker"],
      flags: { json: true },
    };
    const result = inspect(args, makeDeps());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.value);
      expect(parsed.fileCount).toBe(10);
    }
  });

  it("errors on missing hook name", () => {
    const args: ParsedArgs = { command: "inspect", names: [], flags: {} };
    const result = inspect(args, makeDeps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(PaihErrorCode.InvalidArgs);
  });

  it("errors on unknown hook name", () => {
    const args: ParsedArgs = {
      command: "inspect",
      names: ["UnknownHook"],
      flags: {},
    };
    const result = inspect(args, makeDeps());
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.message).toContain("Inspectable hooks:");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test cli/commands/inspect.test.ts`
Expected: FAIL — module not found

**Step 3: Write the command**

Create `cli/commands/inspect.ts`:

```typescript
/**
 * inspect command — Show hook state for a project directory.
 *
 * Usage: paih inspect <hookName> [--project <dir>] [--raw] [--json]
 */

import type { ParsedArgs } from "@hooks/cli/core/args";
import type { PaihError } from "@hooks/cli/core/error";
import { invalidArgs, PaihErrorCode } from "@hooks/cli/core/error";
import type { Result } from "@hooks/cli/core/result";
import { err } from "@hooks/cli/core/result";
import {
  inspect as inspectDuplicationChecker,
  type InspectorDeps,
} from "@hooks/hooks/DuplicationDetection/DuplicationChecker/inspector";

const INSPECTABLE_HOOKS = new Set(["DuplicationChecker"]);

export interface InspectDeps extends InspectorDeps {}

export function inspect(
  args: ParsedArgs,
  deps: InspectDeps,
): Result<string, PaihError> {
  const hookName = args.names[0];
  if (!hookName) {
    return err(
      invalidArgs(
        "Usage: paih inspect <hookName> [--project <dir>] [--raw] [--json]",
      ),
    );
  }

  if (!INSPECTABLE_HOOKS.has(hookName)) {
    return err(
      new PaihError(
        PaihErrorCode.HookNotFound,
        `Unknown hook: ${hookName}. Inspectable hooks: ${[...INSPECTABLE_HOOKS].join(", ")}`,
        { hookName },
      ),
    );
  }

  // Need to import PaihError for the unknown hook case
  const projectDir = (args.flags.project as string) || deps.cwd();

  const result = inspectDuplicationChecker(projectDir, deps);
  if (!result.ok) return result;

  if (args.flags.raw) return { ok: true, value: result.value.raw };
  if (args.flags.json)
    return { ok: true, value: JSON.stringify(result.value.json, null, 2) };
  return { ok: true, value: result.value.summary };
}
```

Note: The `PaihError` import and `PaihErrorCode` import need to exist already — they do at `cli/core/error.ts`.

**Step 4: Run test to verify it passes**

Run: `bun test cli/commands/inspect.test.ts`
Expected: PASS (all 6 tests)

**Step 5: Commit**

```bash
git add cli/commands/inspect.ts cli/commands/inspect.test.ts
git commit -m "feat(cli): add inspect command handler"
```

---

### Task 4: Wire into CLI router and clean up status stub

**Files:**

- Modify: `cli/bin/paih.ts:10,28-55,59,131-152`
- Delete: `cli/commands/status.ts`

**Step 1: Write the failing test (integration)**

In existing CLI tests or a new test, verify `paih inspect` routes correctly:

```typescript
import { describe, expect, it } from "bun:test";
import { main } from "@hooks/cli/bin/paih";

describe("paih inspect routing", () => {
  it("recognizes inspect as a known command", () => {
    const result = main(["inspect", "DuplicationChecker"]);
    // Should not say "Unknown command"
    expect(result.output).not.toContain("Unknown command");
  });

  it("shows inspect in usage text", () => {
    const result = main(["--help"]);
    expect(result.output).toContain("inspect");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test cli/bin/paih.test.ts -t "inspect"`
Expected: FAIL — "Unknown command: inspect"

**Step 3: Wire inspect into paih.ts**

In `cli/bin/paih.ts`:

1. Add import: `import { inspect } from "@hooks/cli/commands/inspect";`
2. Remove import of status (if any — currently not imported)
3. Add `"inspect"` to `KNOWN_COMMANDS`
4. Add to `USAGE` string under Commands: `  inspect     Show hook state for a project`
5. Add case in `routeCommand`:

   ```typescript
   case "inspect":
     return inspect(args, {
       readFile: (p) => { try { return require("node:fs").readFileSync(p, "utf8"); } catch { return null; } },
       exists: (p) => require("node:fs").existsSync(p),
       cwd: () => process.cwd(),
       getBranch: (dir) => {
         try { return require("node:child_process").execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir, encoding: "utf8" }).trim() || null; }
         catch { return null; }
       },
     });
   ```

   Note: Check if `makeDefaultDeps()` already provides these — if so, adapt rather than inline. If not, inline is fine for now.

**Step 4: Delete status stub**

```bash
rm cli/commands/status.ts
```

**Step 5: Run tests to verify**

Run: `bun test cli/bin/paih.test.ts && bun test cli/commands/inspect.test.ts`
Expected: PASS

**Step 6: Run full test suite**

Run: `bun test`
Expected: No regressions (status.ts has no tests or imports elsewhere)

**Step 7: Type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 8: Commit**

```bash
git add cli/bin/paih.ts cli/commands/inspect.ts
git rm cli/commands/status.ts
git commit -m "feat(cli): wire inspect command, remove status stub"
```

---

### Task 5: Manual smoke test

**Step 1: Run against a real project**

```bash
cd /Users/ian.hogers/.claude/pai-hooks
bun cli/bin/paih.ts inspect DuplicationChecker
```

Expected: Shows summary with state file path, or "No state found" with the expected path.

**Step 2: Test with --project flag**

```bash
bun cli/bin/paih.ts inspect DuplicationChecker --project /some/other/project
```

**Step 3: Test --raw and --json flags**

```bash
bun cli/bin/paih.ts inspect DuplicationChecker --raw
bun cli/bin/paih.ts inspect DuplicationChecker --json
```

**Step 4: Test error cases**

```bash
bun cli/bin/paih.ts inspect                     # missing hook name
bun cli/bin/paih.ts inspect UnknownHook          # unknown hook
```

**Step 5: Commit any fixes**

If smoke testing reveals issues, fix and commit.
