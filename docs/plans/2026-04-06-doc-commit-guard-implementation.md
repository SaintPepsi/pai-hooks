# Doc Commit Guard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Block commits when any hook is missing `doc.md` or `IDEA.md`, via both a Claude Code PreToolUse hook and the git pre-commit gate.

**Architecture:** New `DocCommitGuard` PreToolUse hook in `CodingStandards` group follows the same pattern as `BashWriteGuard` — accepts Bash commands containing `git commit`, scans all hook directories for missing docs, blocks if any found. Separately, update `pre-commit-gate.ts` to also check for `IDEA.md`.

**Tech Stack:** TypeScript, Bun, Bun test runner, Husky pre-commit

---

### Task 1: Add IDEA.md checking to pre-commit-gate.ts

**Files:**

- Modify: `scripts/docs/pre-commit-gate.ts`
- Test: `scripts/docs/pre-commit-gate.test.ts`

**Step 1: Write the failing tests**

Add to `scripts/docs/pre-commit-gate.test.ts` inside the `checkDocGate` describe block:

```typescript
it("detects missing IDEA.md", () => {
  const deps = makeDeps({
    scanHookJsons: () => ["GitSafety/MergeGate/hook.json"],
    fileExists: (path: string) => !path.endsWith("IDEA.md"),
  });

  const issues = checkDocGate(config, deps);
  expect(issues).toEqual([
    {
      hookDir: "/repo/hooks/GitSafety/MergeGate",
      hookName: "MergeGate",
      groupName: "GitSafety",
      type: "missing-idea",
    },
  ]);
});

it("detects all three missing: doc.md, IDEA.md, and HTML", () => {
  const deps = makeDeps({
    scanHookJsons: () => ["GitSafety/MergeGate/hook.json"],
    fileExists: () => false,
  });

  const issues = checkDocGate(config, deps);
  expect(issues).toHaveLength(3);
  expect(issues.map((i) => i.type)).toEqual([
    "missing-doc",
    "missing-idea",
    "missing-html",
  ]);
});
```

Also update the `formatReport` describe block:

```typescript
it("formats missing IDEA.md errors", () => {
  const issues: GateIssue[] = [
    {
      hookDir: "/repo/hooks/Git/Guard",
      hookName: "Guard",
      groupName: "Git",
      type: "missing-idea",
    },
  ];

  const report = formatReport(issues);
  expect(report).toContain("ERROR: Missing IDEA.md in /repo/hooks/Git/Guard/");
  expect(report).toContain("Pre-commit blocked");
});
```

Update the existing "detects both missing" test — rename to "detects missing doc.md and HTML" and keep its assertion at `toHaveLength(2)`. The new 3-way test covers the comprehensive case.

**Step 2: Run tests to verify they fail**

Run: `bun test scripts/docs/pre-commit-gate.test.ts`
Expected: FAIL — `"missing-idea"` type doesn't exist yet, and "detects all three" expects length 3 but gets 2.

**Step 3: Implement IDEA.md checking**

In `scripts/docs/pre-commit-gate.ts`:

1. Update `GateIssue.type` union to include `"missing-idea"`:

```typescript
type: "missing-doc" | "missing-idea" | "missing-html";
```

2. Add IDEA.md check in `checkDocGate` after the doc.md check:

```typescript
if (!deps.fileExists(join(hookDir, "IDEA.md"))) {
  issues.push({ hookDir, hookName, groupName, type: "missing-idea" });
}
```

3. Add IDEA.md section to `formatReport`:

```typescript
const missingIdea = issues.filter((i) => i.type === "missing-idea");

// After missingDocs loop:
for (const i of missingIdea) {
  lines.push(`ERROR: Missing IDEA.md in ${i.hookDir}/`);
}
```

4. Update the footer message to mention IDEA.md:

```typescript
lines.push(
  "\nPre-commit blocked: hook documentation incomplete.\n  - Add doc.md to hook directories that need it\n  - Add IDEA.md to hook directories that need it\n  - Run 'bun run docs:render' to generate HTML",
);
```

**Step 4: Run tests to verify they pass**

Run: `bun test scripts/docs/pre-commit-gate.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add scripts/docs/pre-commit-gate.ts scripts/docs/pre-commit-gate.test.ts
git commit -m "feat(pre-commit): add IDEA.md checking to pre-commit gate"
```

---

### Task 2: Create DocCommitGuard contract (TDD)

**Files:**

- Create: `hooks/CodingStandards/DocCommitGuard/DocCommitGuard.contract.ts`
- Create: `hooks/CodingStandards/DocCommitGuard/DocCommitGuard.test.ts`
- Create: `hooks/CodingStandards/DocCommitGuard/hook.json`

**Step 1: Write the failing tests**

Create `hooks/CodingStandards/DocCommitGuard/DocCommitGuard.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type {
  BlockOutput,
  ContinueOutput,
} from "@hooks/core/types/hook-outputs";
import {
  DocCommitGuard,
  type DocCommitGuardDeps,
} from "./DocCommitGuard.contract";

function makeInput(command: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Bash",
    tool_input: { command },
  };
}

function makeDeps(
  overrides: Partial<DocCommitGuardDeps> = {},
): DocCommitGuardDeps {
  return {
    stderr: () => {},
    fileExists: () => true,
    scanHookJsons: () => [],
    hooksDir: "/repo/hooks",
    ...overrides,
  };
}

function run(
  input: ToolHookInput,
  deps: DocCommitGuardDeps,
): Result<ContinueOutput | BlockOutput, ResultError> {
  return DocCommitGuard.execute(input, deps) as Result<
    ContinueOutput | BlockOutput,
    ResultError
  >;
}

describe("DocCommitGuard", () => {
  it("has correct name and event", () => {
    expect(DocCommitGuard.name).toBe("DocCommitGuard");
    expect(DocCommitGuard.event).toBe("PreToolUse");
  });

  // ─── accepts() ──────────────────────────────────────────────────────────

  it("rejects non-Bash tools", () => {
    const input: ToolHookInput = {
      session_id: "s",
      tool_name: "Edit",
      tool_input: {},
    };
    expect(DocCommitGuard.accepts(input)).toBe(false);
  });

  it("rejects Bash commands without git commit", () => {
    expect(DocCommitGuard.accepts(makeInput("git status"))).toBe(false);
    expect(DocCommitGuard.accepts(makeInput("git push"))).toBe(false);
    expect(DocCommitGuard.accepts(makeInput("ls -la"))).toBe(false);
    expect(DocCommitGuard.accepts(makeInput("bun test"))).toBe(false);
  });

  it("accepts git commit commands", () => {
    expect(DocCommitGuard.accepts(makeInput("git commit -m 'test'"))).toBe(
      true,
    );
    expect(DocCommitGuard.accepts(makeInput("git commit --amend"))).toBe(true);
    expect(
      DocCommitGuard.accepts(
        makeInput("git commit -m \"$(cat <<'EOF'\nmessage\nEOF\n)\""),
      ),
    ).toBe(true);
  });

  it("accepts chained commands containing git commit", () => {
    expect(
      DocCommitGuard.accepts(makeInput("git add . && git commit -m 'test'")),
    ).toBe(true);
  });

  // ─── execute() — all docs present ──────────────────────────────────────

  it("continues when all hooks have doc.md and IDEA.md", () => {
    const deps = makeDeps({
      scanHookJsons: () => ["GitSafety/MergeGate/hook.json"],
      fileExists: () => true,
    });

    const r = run(makeInput("git commit -m 'test'"), deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe("continue");
  });

  it("continues when no hook.json files exist", () => {
    const deps = makeDeps({ scanHookJsons: () => [] });

    const r = run(makeInput("git commit -m 'test'"), deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe("continue");
  });

  // ─── execute() — missing docs ──────────────────────────────────────────

  it("blocks when a hook is missing doc.md", () => {
    const deps = makeDeps({
      scanHookJsons: () => ["GitSafety/MergeGate/hook.json"],
      fileExists: (path: string) => !path.endsWith("doc.md"),
    });

    const r = run(makeInput("git commit -m 'test'"), deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
      expect((r.value as BlockOutput).reason).toContain("doc.md");
    }
  });

  it("blocks when a hook is missing IDEA.md", () => {
    const deps = makeDeps({
      scanHookJsons: () => ["GitSafety/MergeGate/hook.json"],
      fileExists: (path: string) => !path.endsWith("IDEA.md"),
    });

    const r = run(makeInput("git commit -m 'test'"), deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
      expect((r.value as BlockOutput).reason).toContain("IDEA.md");
    }
  });

  it("lists all missing files in the block reason", () => {
    const deps = makeDeps({
      scanHookJsons: () => [
        "GitSafety/MergeGate/hook.json",
        "CodeQuality/Linter/hook.json",
      ],
      fileExists: () => false,
    });

    const r = run(makeInput("git commit -m 'test'"), deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
      const reason = (r.value as BlockOutput).reason;
      expect(reason).toContain("MergeGate");
      expect(reason).toContain("Linter");
    }
  });

  it("handles multiple hooks — only blocks for ones missing docs", () => {
    const deps = makeDeps({
      scanHookJsons: () => [
        "GroupA/HookOk/hook.json",
        "GroupB/HookBad/hook.json",
      ],
      fileExists: (path: string) => {
        // HookOk has all docs, HookBad has none
        return path.includes("HookOk");
      },
    });

    const r = run(makeInput("git commit -m 'test'"), deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
      const reason = (r.value as BlockOutput).reason;
      expect(reason).toContain("HookBad");
      expect(reason).not.toContain("HookOk");
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test hooks/CodingStandards/DocCommitGuard/DocCommitGuard.test.ts`
Expected: FAIL — module not found (contract doesn't exist yet)

**Step 3: Write the contract**

Create `hooks/CodingStandards/DocCommitGuard/DocCommitGuard.contract.ts`:

```typescript
/**
 * DocCommitGuard Contract — Block git commit when hooks are missing doc.md or IDEA.md.
 *
 * PreToolUse hook that fires on Bash commands containing `git commit`.
 * Scans all hooks/{Group}/{Hook}/hook.json directories and verifies
 * each has both doc.md and IDEA.md. Blocks with a list of missing files.
 */

import { join, dirname, basename } from "node:path";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type {
  BlockOutput,
  ContinueOutput,
} from "@hooks/core/types/hook-outputs";
import { continueOk } from "@hooks/core/types/hook-outputs";
import { getCommand } from "@hooks/lib/tool-input";
import { defaultStderr } from "@hooks/lib/paths";
import { fileExists as adapterFileExists } from "@hooks/core/adapters/fs";
import { Glob } from "bun";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DocCommitGuardDeps {
  stderr: (msg: string) => void;
  fileExists: (path: string) => boolean;
  scanHookJsons: (hooksDir: string) => Iterable<string>;
  hooksDir: string;
}

interface MissingDoc {
  hookName: string;
  groupName: string;
  file: "doc.md" | "IDEA.md";
}

// ─── Pure Functions ──────────────────────────────────────────────────────────

const GIT_COMMIT_PATTERN = /\bgit\s+commit\b/;

/** Check if a Bash command contains a git commit invocation. */
export function isGitCommit(command: string): boolean {
  return GIT_COMMIT_PATTERN.test(command);
}

/** Scan hook directories and return list of missing doc files. */
export function findMissingDocs(deps: DocCommitGuardDeps): MissingDoc[] {
  const missing: MissingDoc[] = [];

  for (const match of deps.scanHookJsons(deps.hooksDir)) {
    const hookJsonPath = join(deps.hooksDir, match);
    const hookDir = dirname(hookJsonPath);
    const hookName = basename(hookDir);
    const groupName = basename(dirname(hookDir));

    if (!deps.fileExists(join(hookDir, "doc.md"))) {
      missing.push({ hookName, groupName, file: "doc.md" });
    }

    if (!deps.fileExists(join(hookDir, "IDEA.md"))) {
      missing.push({ hookName, groupName, file: "IDEA.md" });
    }
  }

  return missing;
}

/** Format missing docs into a block reason string. */
export function formatBlockReason(missing: MissingDoc[]): string {
  const lines: string[] = [
    "Commit blocked: hook documentation incomplete.",
    "",
  ];

  for (const m of missing) {
    lines.push(`  - ${m.groupName}/${m.hookName}: missing ${m.file}`);
  }

  lines.push("");
  lines.push("Add the missing files before committing.");

  return lines.join("\n");
}

// ─── Default Deps ────────────────────────────────────────────────────────────

import { resolve } from "node:path";

const defaultDeps: DocCommitGuardDeps = {
  stderr: defaultStderr,
  fileExists: adapterFileExists,
  scanHookJsons: (hooksDir: string) => {
    const glob = new Glob("*/*/hook.json");
    return glob.scanSync({ cwd: hooksDir });
  },
  hooksDir: resolve(import.meta.dir, "../../..", "hooks"),
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const DocCommitGuard: SyncHookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  DocCommitGuardDeps
> = {
  name: "DocCommitGuard",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name !== "Bash") return false;
    return isGitCommit(getCommand(input));
  },

  execute(
    _input: ToolHookInput,
    deps: DocCommitGuardDeps,
  ): Result<ContinueOutput | BlockOutput, ResultError> {
    const missing = findMissingDocs(deps);

    if (missing.length === 0) {
      return ok(continueOk());
    }

    const reason = formatBlockReason(missing);
    deps.stderr(reason);

    return ok({
      type: "block",
      decision: "block",
      reason,
    });
  },

  defaultDeps,
};
```

**Step 4: Create hook.json**

Create `hooks/CodingStandards/DocCommitGuard/hook.json`:

```json
{
  "name": "DocCommitGuard",
  "group": "CodingStandards",
  "event": "PreToolUse",
  "description": "Blocks git commit when hooks are missing doc.md or IDEA.md",
  "schemaVersion": 1,
  "tags": [],
  "presets": []
}
```

**Step 5: Run tests to verify they pass**

Run: `bun test hooks/CodingStandards/DocCommitGuard/DocCommitGuard.test.ts`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add hooks/CodingStandards/DocCommitGuard/
git commit -m "feat(CodingStandards): add DocCommitGuard — blocks commit without docs"
```

---

### Task 3: Create hook entry point and register in settings

**Files:**

- Create: `hooks/CodingStandards/DocCommitGuard/DocCommitGuard.hook.ts`
- Modify: `hooks/CodingStandards/group.json`
- Modify: `settings.hooks.json`

**Step 1: Create the hook entry point**

Create `hooks/CodingStandards/DocCommitGuard/DocCommitGuard.hook.ts`:

```typescript
#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { DocCommitGuard } from "@hooks/hooks/CodingStandards/DocCommitGuard/DocCommitGuard.contract";

if (import.meta.main) {
  runHook(DocCommitGuard).catch((e) => {
    process.stderr.write(
      `[hook] fatal: ${e instanceof Error ? e.message : e}\n`,
    );
    process.exit(0);
  });
}
```

**Step 2: Add to group.json**

In `hooks/CodingStandards/group.json`, add `"DocCommitGuard"` to the `hooks` array (after `CodingStandardsEnforcer`, alphabetical):

```json
{
  "name": "CodingStandards",
  "description": "TypeScript quality enforcement hooks",
  "hooks": [
    "BashWriteGuard",
    "CodingStandardsAdvisor",
    "CodingStandardsEnforcer",
    "DocCommitGuard",
    "TypeCheckVerifier",
    "TypeStrictness",
    "WhileLoopGuard"
  ],
  "sharedFiles": []
}
```

**Step 3: Register in settings.hooks.json**

Add the hook command to the existing `PreToolUse` → `matcher: "Bash"` hooks array, after the BashWriteGuard entry:

```json
{
  "type": "command",
  "command": "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/CodingStandards/DocCommitGuard/DocCommitGuard.hook.ts"
}
```

**Step 4: Run full test suite**

Run: `bun test`
Expected: ALL PASS (no regressions)

**Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add hooks/CodingStandards/DocCommitGuard/DocCommitGuard.hook.ts hooks/CodingStandards/group.json settings.hooks.json
git commit -m "feat(CodingStandards): register DocCommitGuard hook entry point"
```

---

### Task 4: Write doc.md and IDEA.md for DocCommitGuard

**Files:**

- Create: `hooks/CodingStandards/DocCommitGuard/doc.md`
- Create: `hooks/CodingStandards/DocCommitGuard/IDEA.md`

**Step 1: Write doc.md**

Create `hooks/CodingStandards/DocCommitGuard/doc.md`:

```markdown
## Overview

Blocks `git commit` commands when any hook in the repository is missing required documentation files (`doc.md` or `IDEA.md`).

## Event

PreToolUse (Bash)

## When It Fires

Every time Claude Code is about to execute a Bash command containing `git commit`.

## What It Does

1. Intercepts the Bash command before execution
2. Scans all `hooks/{Group}/{Hook}/hook.json` directories
3. Checks each hook directory for both `doc.md` and `IDEA.md`
4. If any are missing, blocks the commit with a list of what's needed
5. If all present, allows the commit to proceed

## Examples

> Committing after adding a new hook without writing docs:
> "Commit blocked: hook documentation incomplete.
>
> - CodingStandards/NewHook: missing doc.md
> - CodingStandards/NewHook: missing IDEA.md"

> Committing when all hooks have docs:
> Commit proceeds normally.

## Dependencies

- `core/adapters/fs.ts` — `fileExists`
- `lib/tool-input.ts` — `getCommand`
- `lib/paths.ts` — `defaultStderr`
- Bun `Glob` — scanning hook.json files
```

**Step 2: Write IDEA.md**

Create `hooks/CodingStandards/DocCommitGuard/IDEA.md`:

```markdown
## Problem

Developers create new automation hooks but forget to write documentation. Missing docs accumulate silently until someone notices, making onboarding and maintenance harder.

## Solution

A commit-time gate that scans every hook directory for required documentation files and blocks the commit if any are missing. Catches documentation gaps before they enter the repository.

## How It Works

1. A pre-commit interceptor watches for version control commit commands
2. It scans the hooks directory tree for hook manifest files (e.g., `hook.json`)
3. For each manifest found, it checks whether sibling documentation files exist
4. If any documentation is missing, the commit is blocked with a clear listing of what's needed
5. If all documentation is present, the commit proceeds

## Signals

**Input:** A shell command about to be executed (specifically, a version control commit)

**Output:** Either allow (continue) or block with a list of hooks missing documentation
```

**Step 3: Render docs and commit**

```bash
bun run docs:render
git add hooks/CodingStandards/DocCommitGuard/doc.md hooks/CodingStandards/DocCommitGuard/IDEA.md docs/groups/CodingStandards/DocCommitGuard.html
git commit -m "docs(DocCommitGuard): add doc.md and IDEA.md"
```
