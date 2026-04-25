# Steering Rule `depends-on` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ExecutingPlans to implement this plan task-by-task.

**Goal:** Add an optional `depends-on` field to steering-rule frontmatter that gates Stop-rule injection on whether a listed tool was actually used in the current turn — eliminating false-positive injections during brainstorming, scoping, and code-reading turns.

**Architecture:** One new helper (`transcriptHasToolCall`) walks the JSONL transcript backwards from EOF, returning true if any listed tool appears in assistant `tool_use` blocks before hitting the most recent real user message. Parser extracts `depends-on` items matching `Tool(X)` syntax into `dependsOn: string[]`. The injector adds one gate line: skip the rule if `dependsOn` is set and the helper returns false. Validator accepts `depends-on` in bracket-array form, rejects YAML-list form, does not enforce item shape (parser ignores unknown items).

**Tech Stack:** TypeScript, Bun test runner, Effect schema, existing `core/adapters/fs.ts` for file IO.

**Source design:** `docs/plans/2026-04-26-steering-rule-depends-on-design.md` (commit `1e4b9da`).

---

## Task 1: Parser extracts `depends-on` from frontmatter

**Files:**
- Modify: `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.ts:48-113` (RuleFrontmatter type + parseFrontmatter)
- Test: `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts` (add to existing parseFrontmatter describe block)

**Step 1: Add failing tests for `dependsOn` extraction**

Append to the `describe("parseFrontmatter", ...)` block in the existing test file:

```typescript
it("extracts dependsOn from depends-on Tool() items", () => {
  const content = `---
name: test-rule
events: [Stop]
keywords: []
depends-on: [Tool(Write), Tool(Edit), Tool(Bash)]
---

Body.`;
  const result = parseFrontmatter(content);
  expect(result!.dependsOn).toEqual(["Write", "Edit", "Bash"]);
});

it("returns undefined dependsOn when depends-on is absent", () => {
  const content = `---
name: test-rule
events: [Stop]
keywords: []
---

Body.`;
  const result = parseFrontmatter(content);
  expect(result!.dependsOn).toBeUndefined();
});

it("returns empty dependsOn when depends-on is empty array", () => {
  const content = `---
name: test-rule
events: [Stop]
keywords: []
depends-on: []
---

Body.`;
  const result = parseFrontmatter(content);
  expect(result!.dependsOn).toEqual([]);
});

it("ignores depends-on items that don't match Tool() syntax", () => {
  const content = `---
name: test-rule
events: [Stop]
keywords: []
depends-on: [Tool(Write), Skill(Foo), Mode(ALGORITHM), Tool(Bash)]
---

Body.`;
  const result = parseFrontmatter(content);
  expect(result!.dependsOn).toEqual(["Write", "Bash"]);
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`
Expected: 4 new tests fail with "expected undefined to equal [...]" or "Property 'dependsOn' does not exist".

**Step 3: Add `dependsOn` to RuleFrontmatter type**

In `SteeringRuleInjector.contract.ts:48-53`, change:
```typescript
export interface RuleFrontmatter {
  name: string;
  events: string[];
  keywords: string[];
  body: string;
  dependsOn?: string[];
}
```

**Step 4: Extract `depends-on` in `parseFrontmatter`**

In `SteeringRuleInjector.contract.ts:89-113`, after the `keywords` extraction and before the return statement, add:

```typescript
const dependsOnMatch = yaml.match(/^depends-on:\s*\[([^\]]*)\]$/m);
const dependsOn = dependsOnMatch
  ? dependsOnMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((item) => item.match(/^Tool\(([A-Za-z]+)\)$/)?.[1])
      .filter((name): name is string => Boolean(name))
  : undefined;
```

Then update the return to include `dependsOn`:
```typescript
return { name, events, keywords, body: body.trim(), dependsOn };
```

**Step 5: Run tests to verify pass**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`
Expected: All parseFrontmatter tests pass, no existing tests broken.

**Step 6: Type check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

**Step 7: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.ts hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts
git commit -m "$(cat <<'EOF'
feat(steering): parse depends-on Tool() items into dependsOn field

Adds dependsOn?: string[] to RuleFrontmatter. Parser extracts items
matching Tool(X) syntax and ignores unknown shapes (forward-compat
for Skill(X), Mode(X), etc.). No injection behavior change yet.

Co-Authored-By: Maple <ianhogers@hotmail.com>
EOF
)"
```

---

## Task 2: Validator accepts `depends-on` and rejects YAML list form

**Files:**
- Modify: `hooks/SteeringRuleInjector/SteeringRuleValidator/SteeringRuleValidator.contract.ts:48-87` (validateSteeringRule)
- Test: `hooks/SteeringRuleInjector/SteeringRuleValidator/SteeringRuleValidator.test.ts`

**Step 1: Add failing tests**

Append inside `describe("validateSteeringRule", ...)`:

```typescript
test("accepts valid depends-on bracket array", () => {
  const content = `---
name: test-rule
events: [Stop]
keywords: []
depends-on: [Tool(Write), Tool(Edit)]
---

Body.`;
  const result = validateSteeringRule(content);
  expect(result.valid).toBe(true);
});

test("accepts missing depends-on (optional)", () => {
  const content = `---
name: test-rule
events: [Stop]
keywords: []
---

Body.`;
  const result = validateSteeringRule(content);
  expect(result.valid).toBe(true);
});

test("rejects YAML list format for depends-on", () => {
  const content = `---
name: test-rule
events: [Stop]
keywords: []
depends-on:
  - Tool(Write)
  - Tool(Edit)
---

Body.`;
  const result = validateSteeringRule(content);
  expect(result.valid).toBe(false);
  expect(result.errors.some((e) => e.includes("bracket syntax"))).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleValidator/SteeringRuleValidator.test.ts`
Expected: "rejects YAML list format for depends-on" fails (validator currently accepts it because it doesn't check `depends-on` at all). The other two should pass already (validator ignores unknown fields).

**Step 3: Add `depends-on` validation to `validateSteeringRule`**

In `SteeringRuleValidator.contract.ts:48-87`, after the `keywords` validation block and before the return, add:

```typescript
// depends-on is optional; if present, must use bracket array form
if (yaml.match(/^depends-on:/m)) {
  const dependsOnBracket = yaml.match(/^depends-on:\s*\[([^\]]*)\]$/m);
  if (!dependsOnBracket) {
    if (yaml.match(/^depends-on:\s*$/m) || yaml.match(/^depends-on:\s*\n\s+-/m)) {
      errors.push(
        "Invalid 'depends-on' format: use bracket syntax depends-on: [Tool(Write), Tool(Edit)] not YAML list",
      );
    } else {
      errors.push("Invalid 'depends-on' format: use bracket syntax depends-on: [Tool(Write)]");
    }
  }
}
```

**Step 4: Run tests to verify pass**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleValidator/SteeringRuleValidator.test.ts`
Expected: All tests pass.

**Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

**Step 6: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleValidator/SteeringRuleValidator.contract.ts hooks/SteeringRuleInjector/SteeringRuleValidator/SteeringRuleValidator.test.ts
git commit -m "$(cat <<'EOF'
feat(steering): validate depends-on uses bracket array syntax

Validator now accepts optional depends-on field but blocks Write/Edit
operations using YAML list form. Mirrors the events/keywords pattern.
Does not enforce item shape — parser is responsible for that.

Co-Authored-By: Maple <ianhogers@hotmail.com>
EOF
)"
```

---

## Task 3: Add `transcriptHasToolCall` helper

**Files:**
- Create: `hooks/SteeringRuleInjector/SteeringRuleInjector/transcript-tool-scan.ts`
- Create: `hooks/SteeringRuleInjector/SteeringRuleInjector/transcript-tool-scan.test.ts`

**Step 1: Write failing tests**

Create `transcript-tool-scan.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcriptHasToolCall } from "./transcript-tool-scan";

function writeTranscript(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "transcript-test-"));
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  return path;
}

describe("transcriptHasToolCall", () => {
  it("returns false when transcriptPath is undefined", () => {
    expect(transcriptHasToolCall(undefined, ["Write"])).toBe(false);
  });

  it("returns false when file does not exist", () => {
    expect(transcriptHasToolCall("/nonexistent/path.jsonl", ["Write"])).toBe(false);
  });

  it("returns true when listed tool was used after last user message", () => {
    const path = writeTranscript([
      { type: "user", message: { content: "do the thing" } },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Edit", input: {} }] },
      },
    ]);
    expect(transcriptHasToolCall(path, ["Edit", "Write"])).toBe(true);
  });

  it("returns false when no listed tool was used after last user message", () => {
    const path = writeTranscript([
      { type: "user", message: { content: "look at the code" } },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
      },
    ]);
    expect(transcriptHasToolCall(path, ["Edit", "Write"])).toBe(false);
  });

  it("does not look past the last real user message", () => {
    const path = writeTranscript([
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Edit", input: {} }] },
      },
      { type: "user", message: { content: "now just look at this" } },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
      },
    ]);
    expect(transcriptHasToolCall(path, ["Edit"])).toBe(false);
  });

  it("treats user lines whose content starts with tool_result as synthetic", () => {
    const path = writeTranscript([
      { type: "user", message: { content: "real prompt" } },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Edit", input: {} }] },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }],
        },
      },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: {} }] },
      },
    ]);
    expect(transcriptHasToolCall(path, ["Edit"])).toBe(true);
    expect(transcriptHasToolCall(path, ["Bash"])).toBe(true);
  });

  it("treats user content array starting with text block as real boundary", () => {
    const path = writeTranscript([
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Edit", input: {} }] },
      },
      { type: "user", message: { content: [{ type: "text", text: "real msg" }] } },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
      },
    ]);
    expect(transcriptHasToolCall(path, ["Edit"])).toBe(false);
  });

  it("returns false on empty transcript file", () => {
    const path = writeTranscript([]);
    expect(transcriptHasToolCall(path, ["Edit"])).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleInjector/transcript-tool-scan.test.ts`
Expected: All tests fail with "module not found."

**Step 3: Implement `transcriptHasToolCall`**

Create `transcript-tool-scan.ts`:

```typescript
/**
 * Scan a transcript JSONL backwards to determine whether any of the listed
 * tool names was used by the assistant in the current turn (since the most
 * recent real user message).
 *
 * Used by SteeringRuleInjector to gate `depends-on` rules.
 */

import { fileExists, readFile } from "@hooks/core/adapters/fs";

interface ContentBlock {
  type: string;
  name?: string;
}

interface TranscriptEntry {
  type: "user" | "assistant";
  message?: {
    content?: string | ContentBlock[];
  };
}

function isRealUserMessage(entry: TranscriptEntry): boolean {
  if (entry.type !== "user") return false;
  const content = entry.message?.content;
  if (typeof content === "string") return true;
  return Array.isArray(content) && content[0]?.type === "text";
}

function parseEntry(line: string): TranscriptEntry | null {
  try {
    return JSON.parse(line) as TranscriptEntry;
  } catch {
    return null;
  }
}

export function transcriptHasToolCall(
  transcriptPath: string | undefined,
  toolNames: string[],
): boolean {
  if (!transcriptPath || toolNames.length === 0) return false;
  if (!fileExists(transcriptPath)) return false;

  const result = readFile(transcriptPath);
  if (!result.ok) return false;

  const lines = result.value.split("\n").filter(Boolean);
  const targets = new Set(toolNames);

  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parseEntry(lines[i]);
    if (!entry) continue;

    if (isRealUserMessage(entry)) return false;

    if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        if (block.type === "tool_use" && block.name && targets.has(block.name)) {
          return true;
        }
      }
    }
  }

  return false;
}
```

**Step 4: Run tests to verify pass**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleInjector/transcript-tool-scan.test.ts`
Expected: All 8 tests pass.

**Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

**Step 6: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/transcript-tool-scan.ts hooks/SteeringRuleInjector/SteeringRuleInjector/transcript-tool-scan.test.ts
git commit -m "$(cat <<'EOF'
feat(steering): add transcriptHasToolCall helper

Walks transcript JSONL backwards from EOF, returns true if any listed
tool name appears in an assistant tool_use block before hitting the
most recent real user message. Synthetic user entries (whose content
starts with tool_result) are skipped.

Co-Authored-By: Maple <ianhogers@hotmail.com>
EOF
)"
```

---

## Task 4: Wire helper into `SteeringRuleInjector` and add gate

**Files:**
- Modify: `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.ts:66-74` (Deps interface), `:166-212` (defaultDeps), `:224-282` (execute)
- Test: `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`

**Step 1: Add failing tests for the gate**

Find the existing `describe("SteeringRuleInjector", ...)` (or `describe("execute", ...)`) block. Add:

```typescript
describe("dependsOn gate", () => {
  const baseDeps = (overrides: Partial<SteeringRuleInjectorDeps>): SteeringRuleInjectorDeps => ({
    resolveGlobs: () => ["/fake/rule.md"],
    readFile: () => `---
name: gated-rule
events: [Stop]
keywords: [trigger]
depends-on: [Tool(Edit)]
---

Gated body.`,
    readTracker: (sessionId: string) => ({ sessionId, injected: {} }),
    writeTracker: () => {},
    getConfig: () => ({ enabled: true, includes: ["**/*.md"], trackerDir: ".test" }),
    isSubagent: () => false,
    stderr: () => {},
    transcriptHasToolCall: () => false,
    ...overrides,
  });

  const stopInput: StopInput = {
    hook_event_name: "Stop",
    session_id: "test-session",
    transcript_path: "/fake/transcript.jsonl",
    last_assistant_message: "trigger this",
    stop_hook_active: false,
  };

  it("skips a rule whose dependsOn helper returns false", () => {
    const deps = baseDeps({ transcriptHasToolCall: () => false });
    const result = SteeringRuleInjector.execute(stopInput, deps);
    expect(result.ok).toBe(true);
    expect(getBlockReason(result.ok ? result.value : {})).toBeUndefined();
  });

  it("includes a rule whose dependsOn helper returns true", () => {
    const deps = baseDeps({ transcriptHasToolCall: () => true });
    const result = SteeringRuleInjector.execute(stopInput, deps);
    expect(result.ok).toBe(true);
    expect(getBlockReason(result.ok ? result.value : {})).toContain("Gated body");
  });

  it("ignores dependsOn when not present in frontmatter", () => {
    const deps = baseDeps({
      readFile: () => `---
name: ungated-rule
events: [Stop]
keywords: [trigger]
---

Ungated body.`,
      transcriptHasToolCall: () => false,
    });
    const result = SteeringRuleInjector.execute(stopInput, deps);
    expect(result.ok).toBe(true);
    expect(getBlockReason(result.ok ? result.value : {})).toContain("Ungated body");
  });
});
```

(If the existing test file uses different helper names than `getBlockReason`, match the existing pattern. Inspect the imports at the top of the test file.)

**Step 2: Run tests to verify they fail**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`
Expected: 3 new tests fail — `transcriptHasToolCall` is not a known dep, and the gate is not yet present.

**Step 3: Add `transcriptHasToolCall` to `SteeringRuleInjectorDeps`**

In `SteeringRuleInjector.contract.ts:66-74`, append:

```typescript
transcriptHasToolCall: (transcriptPath: string | undefined, toolNames: string[]) => boolean;
```

**Step 4: Wire it into `defaultDeps`**

In `SteeringRuleInjector.contract.ts:166-212`, add an import at the top of the file:

```typescript
import { transcriptHasToolCall } from "./transcript-tool-scan";
```

And add to `defaultDeps`:

```typescript
transcriptHasToolCall,
```

**Step 5: Add the gate in `execute()`**

In `SteeringRuleInjector.contract.ts:272-275`, immediately after the keyword-match block and before `bodiesToInject.push(rule.body);`, add:

```typescript
if (rule.dependsOn && !deps.transcriptHasToolCall(input.transcript_path, rule.dependsOn)) continue;
```

(`input.transcript_path` is available on `StopInput` and may be `undefined` on other event types — the helper handles both cases.)

**Step 6: Run tests to verify pass**

Run: `bun test hooks/SteeringRuleInjector`
Expected: All tests pass — both the new gate tests and the existing ones.

**Step 7: Type check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

**Step 8: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.ts hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts
git commit -m "$(cat <<'EOF'
feat(steering): gate Stop-rule injection on transcriptHasToolCall

Rules with depends-on are now skipped when none of the listed tools
were used in the current turn. Rules without depends-on retain the
existing always-eligible behavior.

Co-Authored-By: Maple <ianhogers@hotmail.com>
EOF
)"
```

---

## Task 5: Update the two false-positive rules

**Files:**
- Modify: `hooks/SteeringRuleInjector/SteeringRuleInjector/steering-rules/fix-all-discovered-bugs-not-just-some.md`
- Modify: `hooks/SteeringRuleInjector/SteeringRuleInjector/steering-rules/always-proper-fix.md`

**Step 1: Add `depends-on` to `fix-all-discovered-bugs-not-just-some.md`**

In the frontmatter block, after `keywords:`, add:

```yaml
depends-on: [Tool(Write), Tool(Edit), Tool(NotebookEdit), Tool(Bash)]
```

**Step 2: Add `depends-on` to `always-proper-fix.md`**

Read the file first to confirm the existing frontmatter shape, then add the same line in the same position.

**Step 3: Run the validator over the rules**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleValidator`
Expected: All tests pass — confirms the rule files themselves are still valid.

**Step 4: Run all SteeringRuleInjector tests as smoke test**

Run: `bun test hooks/SteeringRuleInjector`
Expected: All tests pass.

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass — no regressions across the rest of the hook system.

**Step 6: Type check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

**Step 7: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/steering-rules/fix-all-discovered-bugs-not-just-some.md hooks/SteeringRuleInjector/SteeringRuleInjector/steering-rules/always-proper-fix.md
git commit -m "$(cat <<'EOF'
fix(steering): gate fix-all-discovered-bugs and always-proper-fix on tool use

Adds depends-on to the two rules that were firing falsely on conversational
turns (brainstorming, scoping, code-reading). They now only fire when the
agent has actually written, edited, or run shell commands this turn.

Co-Authored-By: Maple <ianhogers@hotmail.com>
EOF
)"
```

**Step 8: Push**

```bash
git push origin main
```

**Step 9: Dogfood verification**

Open a new Claude Code session, run `/Brainstorming` against any topic, and verify that on Stop the offending rules do NOT inject. Optionally trigger one of the keywords explicitly in a brainstorming reply (e.g. mention "optional" in the response) to confirm it's the gate doing the work, not some other change.

---

## Out of Scope (separate PR)

Audit-sweep PR: add `depends-on` to the other 8 implementation-context rules listed in the design doc — `fix-at-the-source`, `check-for-regressions-after-fixes`, `coding-standards-are-not-optional-changes`, `commit-and-push-when-finished-never-merge-without-approval`, `dogfood-every-task`, `every-project-must-have-a-type-checking-gate`, `demonstrate-features-end-to-end-before-claiming-done`, `error-recovery-protocol`.
