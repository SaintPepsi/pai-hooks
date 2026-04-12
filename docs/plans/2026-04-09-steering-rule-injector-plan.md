# SteeringRuleInjector Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a hook that injects individual steering rule files into context based on event type and keyword matching, with per-session deduplication tracking.

**Architecture:** Single SyncHookContract registered for SessionStart and UserPromptSubmit. Rules are `.md` files with YAML frontmatter. Glob patterns in hookConfig resolve rule files. Injection tracked per-session in gitignored JSON files.

**Tech Stack:** TypeScript, Bun (bun:test, Bun.Glob), pai-hooks contract system

---

### Task 0: Widen `event` field to support arrays

The contract base type (`core/contract.ts:32`) has `event: HookEventType` — a single string. Widen it to `HookEventType | HookEventType[]` so multi-event hooks can declare all their events.

**Files:**

- Modify: `core/contract.ts`
- Modify: `core/runner.ts`

**Step 1: Widen `event` type in HookContractBase**

In `core/contract.ts:32`, change:

```typescript
event: HookEventType;
```

to:

```typescript
event: HookEventType | HookEventType[];
```

**Step 2: Update runner to normalize event for logging/formatting**

In `core/runner.ts`, the runner reads `contract.event` for logging and `formatOutput`. Add a helper to resolve the actual event:

```typescript
function resolveEvent(
  contract: { event: HookEventType | HookEventType[] },
  input: HookInput,
): string {
  if (Array.isArray(contract.event)) {
    // Infer actual event from input shape
    if ("prompt" in input) return "UserPromptSubmit";
    if ("tool_name" in input)
      return "tool_input" in input ? "PreToolUse" : "PostToolUse";
    return contract.event[0];
  }
  return contract.event;
}
```

Use `resolveEvent(contract, input)` in `makeEmitLog` and `formatOutput` calls instead of `contract.event`.

**Step 3: Run full test suite**

Run: `bun test`
Expected: No regressions — existing hooks pass a single string, which still satisfies the widened type.

**Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add core/contract.ts core/runner.ts
git commit -m "feat(core): widen event field to support HookEventType arrays"
```

---

### Task 1: Scaffold hook directory and metadata

**Files:**

- Create: `hooks/SteeringRuleInjector/SteeringRuleInjector/hook.json`
- Create: `hooks/SteeringRuleInjector/group.json`

**Step 1: Create group.json**

```json
{
  "name": "SteeringRuleInjector",
  "description": "Contextual steering rule injection based on event type and keyword matching",
  "hooks": ["SteeringRuleInjector"],
  "sharedFiles": []
}
```

**Step 2: Create hook.json**

```json
{
  "name": "SteeringRuleInjector",
  "group": "SteeringRuleInjector",
  "event": ["SessionStart", "UserPromptSubmit"],
  "description": "Injects steering rules into context based on event type and keyword matching",
  "schemaVersion": 1,
  "tags": [],
  "presets": []
}
```

**Step 3: Create empty steering-rules directory**

```bash
mkdir -p hooks/SteeringRuleInjector/SteeringRuleInjector/steering-rules
```

**Step 4: Commit**

```bash
git add hooks/SteeringRuleInjector/
git commit -m "feat(SteeringRuleInjector): scaffold hook directory and metadata"
```

---

### Task 2: Write frontmatter parser tests

**Files:**

- Create: `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`

**Step 1: Write failing tests for frontmatter parsing**

The contract will export a `parseFrontmatter` function. Write tests for it first:

```typescript
import { describe, expect, it } from "bun:test";
import { parseFrontmatter } from "./SteeringRuleInjector.contract";

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with all fields", () => {
    const content = `---
name: test-rule
events: [SessionStart, UserPromptSubmit]
keywords: [push, remote]
---

Rule content here.`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("test-rule");
    expect(result!.events).toEqual(["SessionStart", "UserPromptSubmit"]);
    expect(result!.keywords).toEqual(["push", "remote"]);
    expect(result!.body).toBe("Rule content here.");
  });

  it("parses frontmatter with empty keywords", () => {
    const content = `---
name: always-rule
events: [SessionStart]
keywords: []
---

Always injected.`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.keywords).toEqual([]);
  });

  it("returns null for missing frontmatter", () => {
    const content = "Just plain markdown.";
    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it("returns null for missing name field", () => {
    const content = `---
events: [SessionStart]
keywords: []
---

No name.`;

    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it("returns null for missing events field", () => {
    const content = `---
name: no-events
keywords: []
---

No events.`;

    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it("trims body content", () => {
    const content = `---
name: trim-test
events: [SessionStart]
keywords: []
---

  Some content with leading spaces.
`;

    const result = parseFrontmatter(content);
    expect(result!.body).toBe("Some content with leading spaces.");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`
Expected: FAIL — `parseFrontmatter` not found

**Step 3: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts
git commit -m "test(SteeringRuleInjector): add frontmatter parser tests"
```

---

### Task 3: Implement frontmatter parser

**Files:**

- Create: `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.ts`

**Step 1: Implement parseFrontmatter**

Add to the contract file (before the contract export):

```typescript
export interface RuleFrontmatter {
  name: string;
  events: string[];
  keywords: string[];
  body: string;
}

export function parseFrontmatter(content: string): RuleFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const [, yaml, body] = match;

  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const eventsMatch = yaml.match(/^events:\s*\[([^\]]*)\]$/m);
  const keywordsMatch = yaml.match(/^keywords:\s*\[([^\]]*)\]$/m);

  if (!nameMatch || !eventsMatch) return null;

  const name = nameMatch[1].trim();
  const events = eventsMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const keywords = keywordsMatch
    ? keywordsMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return { name, events, keywords, body: body.trim() };
}
```

**Step 2: Run tests to verify they pass**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`
Expected: All 6 tests PASS

**Step 3: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.ts
git commit -m "feat(SteeringRuleInjector): implement frontmatter parser"
```

---

### Task 4: Write keyword matching tests

**Files:**

- Modify: `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`

**Step 1: Write failing tests for keyword matching**

Append to the test file:

```typescript
import { matchesKeywords } from "./SteeringRuleInjector.contract";

describe("matchesKeywords", () => {
  it("returns true when a keyword appears in prompt", () => {
    expect(matchesKeywords("let's push to remote", ["push", "remote"])).toBe(
      true,
    );
  });

  it("is case-insensitive", () => {
    expect(matchesKeywords("Minimize Output TOKENS", ["tokens"])).toBe(true);
  });

  it("returns false when no keywords match", () => {
    expect(matchesKeywords("refactor the parser", ["push", "deploy"])).toBe(
      false,
    );
  });

  it("returns false for empty keywords", () => {
    expect(matchesKeywords("anything here", [])).toBe(false);
  });

  it("matches whole words within text", () => {
    expect(matchesKeywords("the cost is high", ["cost"])).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`
Expected: FAIL — `matchesKeywords` not found

**Step 3: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts
git commit -m "test(SteeringRuleInjector): add keyword matching tests"
```

---

### Task 5: Implement keyword matching

**Files:**

- Modify: `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.ts`

**Step 1: Implement matchesKeywords**

```typescript
export function matchesKeywords(prompt: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const lower = prompt.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}
```

**Step 2: Run tests to verify they pass**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`
Expected: All 11 tests PASS

**Step 3: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.ts
git commit -m "feat(SteeringRuleInjector): implement keyword matching"
```

---

### Task 6: Write contract execute tests

**Files:**

- Modify: `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`

**Step 1: Write failing tests for the contract**

Append to the test file. The contract needs a deps interface for file I/O, config reading, and tracker persistence:

```typescript
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type {
  SessionStartInput,
  UserPromptSubmitInput,
} from "@hooks/core/types/hook-inputs";
import type {
  ContextOutput,
  SilentOutput,
} from "@hooks/core/types/hook-outputs";
import {
  SteeringRuleInjector,
  type SteeringRuleInjectorDeps,
  type InjectionTracker,
} from "./SteeringRuleInjector.contract";

const RULE_ALWAYS = `---
name: identity
events: [SessionStart]
keywords: []
---

Use first person. Address user by name.`;

const RULE_CONDITIONAL = `---
name: git-safety
events: [UserPromptSubmit]
keywords: [push, remote, origin]
---

Check git remote before push.`;

const RULE_BOTH = `---
name: verify-completion
events: [SessionStart, UserPromptSubmit]
keywords: [done, finished, complete]
---

Verify before claiming completion.`;

function makeDeps(
  overrides: Partial<SteeringRuleInjectorDeps> = {},
): SteeringRuleInjectorDeps {
  return {
    resolveGlobs: () => ["/rules/identity.md", "/rules/git-safety.md"],
    readFile: (path: string) => {
      if (path === "/rules/identity.md") return RULE_ALWAYS;
      if (path === "/rules/git-safety.md") return RULE_CONDITIONAL;
      return null;
    },
    readTracker: () => ({ sessionId: "test-123", injected: {} }),
    writeTracker: () => {},
    getConfig: () => ({
      enabled: true,
      includes: ["*.md"],
      trackerDir: "/tmp/injections",
    }),
    isSubagent: () => false,
    stderr: () => {},
    ...overrides,
  };
}

function makeSessionStartInput(): SessionStartInput {
  return { session_id: "test-123" };
}

function makePromptInput(prompt: string): UserPromptSubmitInput {
  return { session_id: "test-123", prompt };
}

describe("SteeringRuleInjector contract", () => {
  it("has correct name", () => {
    expect(SteeringRuleInjector.name).toBe("SteeringRuleInjector");
  });

  it("accepts all inputs", () => {
    expect(SteeringRuleInjector.accepts(makeSessionStartInput())).toBe(true);
  });

  it("returns silent for subagents", () => {
    const deps = makeDeps({ isSubagent: () => true });
    const result = SteeringRuleInjector.execute(
      makeSessionStartInput(),
      deps,
    ) as Result<ContextOutput | SilentOutput, ResultError>;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("returns silent when disabled", () => {
    const deps = makeDeps({
      getConfig: () => ({ enabled: false, includes: [], trackerDir: "/tmp" }),
    });
    const result = SteeringRuleInjector.execute(
      makeSessionStartInput(),
      deps,
    ) as Result<ContextOutput | SilentOutput, ResultError>;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("injects always-rules on SessionStart", () => {
    const deps = makeDeps();
    const result = SteeringRuleInjector.execute(
      makeSessionStartInput(),
      deps,
    ) as Result<ContextOutput | SilentOutput, ResultError>;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("context");
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("Use first person");
    expect(result.value.content).not.toContain("Check git remote");
  });

  it("injects keyword-matched rules on UserPromptSubmit", () => {
    const deps = makeDeps();
    const result = SteeringRuleInjector.execute(
      makePromptInput("let's push to origin"),
      deps,
    ) as Result<ContextOutput | SilentOutput, ResultError>;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("context");
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("Check git remote");
  });

  it("returns silent when no rules match prompt", () => {
    const deps = makeDeps();
    const result = SteeringRuleInjector.execute(
      makePromptInput("refactor the parser"),
      deps,
    ) as Result<ContextOutput | SilentOutput, ResultError>;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("skips already-injected rules", () => {
    const deps = makeDeps({
      readTracker: () => ({
        sessionId: "test-123",
        injected: {
          identity: {
            event: "SessionStart",
            timestamp: "2026-04-09T00:00:00Z",
          },
        },
      }),
    });
    const result = SteeringRuleInjector.execute(
      makeSessionStartInput(),
      deps,
    ) as Result<ContextOutput | SilentOutput, ResultError>;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });

  it("writes to tracker after injection", () => {
    let writtenTracker: InjectionTracker | null = null;
    const deps = makeDeps({
      writeTracker: (tracker: InjectionTracker) => {
        writtenTracker = tracker;
      },
    });
    SteeringRuleInjector.execute(makeSessionStartInput(), deps);
    expect(writtenTracker).not.toBeNull();
    expect(writtenTracker!.injected).toHaveProperty("identity");
  });

  it("returns silent when no rule files found", () => {
    const deps = makeDeps({ resolveGlobs: () => [] });
    const result = SteeringRuleInjector.execute(
      makeSessionStartInput(),
      deps,
    ) as Result<ContextOutput | SilentOutput, ResultError>;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`
Expected: FAIL — `SteeringRuleInjector` contract not exported yet

**Step 3: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts
git commit -m "test(SteeringRuleInjector): add contract execute tests"
```

---

### Task 7: Implement the contract

**Files:**

- Modify: `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.ts`

**Step 1: Implement the full contract**

Add types, deps interface, and contract to the existing file (which already has `parseFrontmatter` and `matchesKeywords`):

```typescript
import { join } from "node:path";
import { fileExists, readFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type {
  SessionStartInput,
  UserPromptSubmitInput,
} from "@hooks/core/types/hook-inputs";
import type {
  ContextOutput,
  SilentOutput,
} from "@hooks/core/types/hook-outputs";
import { isSubagent } from "@hooks/lib/environment";
import { readHookConfig } from "@hooks/lib/hook-config";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

type SteeringRuleInput = SessionStartInput | UserPromptSubmitInput;

interface SteeringRuleConfig {
  enabled: boolean;
  includes: string[];
  trackerDir: string;
}

export interface InjectionTracker {
  sessionId: string;
  injected: Record<string, { event: string; timestamp: string }>;
}

export interface SteeringRuleInjectorDeps {
  resolveGlobs: (patterns: string[]) => string[];
  readFile: (path: string) => string | null;
  readTracker: (sessionId: string) => InjectionTracker;
  writeTracker: (tracker: InjectionTracker) => void;
  getConfig: () => SteeringRuleConfig;
  isSubagent: () => boolean;
  stderr: (msg: string) => void;
}
```

The `execute` function:

```typescript
export const SteeringRuleInjector: SyncHookContract<
  SteeringRuleInput,
  ContextOutput | SilentOutput,
  SteeringRuleInjectorDeps
> = {
  name: "SteeringRuleInjector",
  event: ["SessionStart", "UserPromptSubmit"],

  accepts(_input: SteeringRuleInput): boolean {
    return true;
  },

  execute(
    input: SteeringRuleInput,
    deps: SteeringRuleInjectorDeps,
  ): Result<ContextOutput | SilentOutput, ResultError> {
    if (deps.isSubagent()) return ok({ type: "silent" });

    const config = deps.getConfig();
    if (!config.enabled) return ok({ type: "silent" });

    const event =
      "prompt" in input && input.prompt != null
        ? "UserPromptSubmit"
        : "SessionStart";
    const prompt =
      event === "UserPromptSubmit"
        ? ((input as UserPromptSubmitInput).prompt ?? "")
        : "";

    const filePaths = deps.resolveGlobs(config.includes);
    if (filePaths.length === 0) return ok({ type: "silent" });

    const tracker = deps.readTracker(input.session_id);
    const toInject: { name: string; body: string }[] = [];

    for (const path of filePaths) {
      const content = deps.readFile(path);
      if (!content) continue;

      const parsed = parseFrontmatter(content);
      if (!parsed) {
        deps.stderr(
          `[SteeringRuleInjector] Skipping ${path}: invalid frontmatter`,
        );
        continue;
      }

      if (!parsed.events.includes(event)) continue;
      if (tracker.injected[parsed.name]) continue;

      if (event === "UserPromptSubmit") {
        if (!matchesKeywords(prompt, parsed.keywords)) continue;
      }

      toInject.push({ name: parsed.name, body: parsed.body });
    }

    if (toInject.length === 0) return ok({ type: "silent" });

    for (const rule of toInject) {
      tracker.injected[rule.name] = {
        event,
        timestamp: new Date().toISOString(),
      };
    }
    deps.writeTracker(tracker);

    const combined = toInject.map((r) => r.body).join("\n\n---\n\n");
    deps.stderr(
      `[SteeringRuleInjector] Injected ${toInject.length} rule(s): ${toInject.map((r) => r.name).join(", ")}`,
    );

    return ok({ type: "context", content: combined });
  },

  defaultDeps: buildDefaultDeps(),
};
```

The `defaultDeps` builder (uses real I/O):

```typescript
const DEFAULT_CONFIG: SteeringRuleConfig = {
  enabled: true,
  includes: [
    "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SteeringRuleInjector/SteeringRuleInjector/steering-rules/*.md",
    "${HOME}/.claude/PAI/USER/rules/*.md",
  ],
  trackerDir: "MEMORY/STATE/.injections",
};

function resolveEnvVars(pattern: string): string {
  return pattern.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

function buildDefaultDeps(): SteeringRuleInjectorDeps {
  const paiDir = getPaiDir();

  return {
    resolveGlobs: (patterns: string[]) => {
      const paths: string[] = [];
      for (const pattern of patterns) {
        const resolved = resolveEnvVars(pattern);
        const glob = new Bun.Glob(resolved);
        for (const match of glob.scanSync({ absolute: true })) {
          paths.push(match);
        }
      }
      return paths;
    },

    readFile: (path: string) => {
      const result = readFile(path);
      return result.ok ? result.value : null;
    },

    readTracker: (sessionId: string) => {
      const trackerPath = join(
        paiDir,
        DEFAULT_CONFIG.trackerDir,
        `injections-${sessionId}.json`,
      );
      if (!fileExists(trackerPath)) {
        return { sessionId, injected: {} };
      }
      const content = readFile(trackerPath);
      if (!content.ok) return { sessionId, injected: {} };
      try {
        return JSON.parse(content.value) as InjectionTracker;
      } catch {
        return { sessionId, injected: {} };
      }
    },

    writeTracker: (tracker: InjectionTracker) => {
      const dir = join(paiDir, DEFAULT_CONFIG.trackerDir);
      const trackerPath = join(dir, `injections-${tracker.sessionId}.json`);
      try {
        Bun.spawnSync({ cmd: ["mkdir", "-p", dir] });
        Bun.write(trackerPath, JSON.stringify(tracker, null, 2));
      } catch {
        // Best-effort — tracker write failure should not block injection
      }
    },

    getConfig: () => {
      const cfg = readHookConfig<Partial<SteeringRuleConfig>>(
        "steeringRuleInjector",
      );
      return { ...DEFAULT_CONFIG, ...cfg };
    },

    isSubagent: () => isSubagent((k) => process.env[k]),
    stderr: defaultStderr,
  };
}
```

**Step 2: Run tests to verify they pass**

Run: `bun test hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`
Expected: All tests PASS

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.ts
git commit -m "feat(SteeringRuleInjector): implement contract with deps and config"
```

---

### Task 8: Create the hook runner

**Files:**

- Create: `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.hook.ts`

**Step 1: Create the runner**

```typescript
#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SteeringRuleInjector } from "@hooks/hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract";

if (import.meta.main) {
  runHook(SteeringRuleInjector).catch((e) => {
    process.stderr.write(
      `[hook] fatal: ${e instanceof Error ? e.message : e}\n`,
    );
    process.exit(0);
  });
}
```

**Step 2: Make it executable**

Run: `chmod +x hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.hook.ts`

**Step 3: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.hook.ts
git commit -m "feat(SteeringRuleInjector): add hook runner"
```

---

### Task 9: Create a sample steering rule

**Files:**

- Create: `hooks/SteeringRuleInjector/SteeringRuleInjector/steering-rules/minimize-output-tokens.md`

**Step 1: Create the sample rule**

```markdown
---
name: minimize-output-tokens
events: [UserPromptSubmit]
keywords: [tokens, output, cost, verbose, concise, brief]
---

Minimize Output Tokens. Output tokens cost 5x input tokens. Lead with action, not reasoning. Skip preamble. If it can be said in one sentence, use one sentence.
```

**Step 2: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/steering-rules/
git commit -m "feat(SteeringRuleInjector): add sample steering rule"
```

---

### Task 10: Register hook in settings.hooks.json

**Files:**

- Modify: `settings.hooks.json`

**Step 1: Add entries under both SessionStart and UserPromptSubmit**

Add to the `SessionStart` array (alongside existing hooks):

```json
{
  "type": "command",
  "command": "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.hook.ts"
}
```

Add to the `UserPromptSubmit` array (alongside existing hooks):

```json
{
  "type": "command",
  "command": "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.hook.ts"
}
```

**Step 2: Commit**

```bash
git add settings.hooks.json
git commit -m "feat(SteeringRuleInjector): register hook for SessionStart and UserPromptSubmit"
```

---

### Task 11: Add tracker directory to .gitignore

**Files:**

- Modify: `.gitignore`

**Step 1: Add the tracker directory pattern**

The tracker files are written to `MEMORY/STATE/.injections/` which is already covered by the existing `MEMORY/` entry in `.gitignore`. Verify this by checking:

Run: `grep "MEMORY" .gitignore`

If `MEMORY/` is listed, no change needed. If not, add:

```
MEMORY/STATE/.injections/
```

**Step 2: Commit if changed**

```bash
git add .gitignore
git commit -m "chore: gitignore injection tracker directory"
```

---

### Task 12: Run full test suite and type check

**Step 1: Run all SteeringRuleInjector tests**

Run: `bun test hooks/SteeringRuleInjector/`
Expected: All tests PASS

**Step 2: Run full project tests**

Run: `bun test`
Expected: No regressions

**Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: No type errors

---

### Task 13: Write doc.md

**Files:**

- Create: `hooks/SteeringRuleInjector/SteeringRuleInjector/doc.md`

**Step 1: Write the documentation**

````markdown
## Overview

Injects individual steering rule files into context based on event type and keyword matching. Rules are `.md` files with YAML frontmatter declaring when they should fire. Each rule injects at most once per session.

## Event

- `SessionStart` — injects always-on rules (rules with empty keywords)
- `UserPromptSubmit` — injects rules whose keywords match the user's prompt

## When It Fires

- On every `SessionStart` (primary agent only, skips subagents)
- On every `UserPromptSubmit` when keywords in the prompt match a rule

## What It Does

1. Reads config from `hookConfig.steeringRuleInjector`
2. Resolves rule files from `includes` glob patterns
3. Parses YAML frontmatter from each rule file
4. Filters rules by current event type
5. For `UserPromptSubmit`: filters by keyword match against prompt text (case-insensitive substring)
6. Checks per-session injection tracker — skips already-injected rules
7. Concatenates matched rule bodies into a single `ContextOutput`
8. Records injected rules to tracker file

## Examples

> A rule that always injects at session start:
>
> ```yaml
> name: identity
> events: [SessionStart]
> keywords: []
> ```

> A rule that injects when the user mentions pushing code:
>
> ```yaml
> name: git-safety
> events: [UserPromptSubmit]
> keywords: [push, remote, origin]
> ```

## Dependencies

- `lib/hook-config` — reads `hookConfig.steeringRuleInjector` from settings.json
- `lib/environment` — `isSubagent()` to skip subagent sessions
- `lib/paths` — `getPaiDir()` for tracker file location
- `Bun.Glob` — resolves include patterns to file paths
````

**Step 2: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/doc.md
git commit -m "docs(SteeringRuleInjector): add hook documentation"
```

---

### Task 14: Write IDEA.md

**Files:**

- Create: `hooks/SteeringRuleInjector/SteeringRuleInjector/IDEA.md`
- Create: `hooks/SteeringRuleInjector/IDEA.md`

**Step 1: Write hook IDEA.md**

```markdown
## Problem

AI assistants receive all behavioral rules at session start, consuming tokens even when most rules are irrelevant to the current task. This wastes context window space and increases cost.

## Solution

Split behavioral rules into individual files with metadata declaring when each should activate. Inject rules on-demand based on event type and keyword matching, with per-session deduplication so each rule only enters context once.

## How It Works

1. Rules are standalone files with frontmatter declaring trigger events and keywords
2. At session start, rules marked as "always" are injected
3. On each user prompt, rules whose keywords match the prompt text are injected
4. A per-session tracker file prevents re-injection of rules already in context
5. Configuration provides glob patterns to discover rule files from multiple directories

## Signals

- **Input:** Hook event type (session start or user prompt), prompt text, session ID
- **Output:** Concatenated rule content injected into assistant context, or silent if no rules match
```

**Step 2: Write group IDEA.md**

Same content — group has one hook.

**Step 3: Commit**

```bash
git add hooks/SteeringRuleInjector/SteeringRuleInjector/IDEA.md hooks/SteeringRuleInjector/IDEA.md
git commit -m "docs(SteeringRuleInjector): add IDEA.md files"
```
