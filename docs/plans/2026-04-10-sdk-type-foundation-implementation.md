# SDK Type Foundation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all custom hook output types (`hook-outputs.ts`) with `SyncHookJSONOutput` from `@anthropic-ai/claude-agent-sdk`, eliminating the abstraction layer that caused the PreCompact/PostToolUse validation bugs.

**Architecture:** Bottom-up: foundation types + runner + barrel exports first (sequential), then 25 parallel contract group migrations, then cleanup.

**Tech Stack:** TypeScript, `@anthropic-ai/claude-agent-sdk@^0.2.98`, Effect Schema, Bun test

**Design doc:** `docs/plans/2026-04-10-sdk-type-foundation-design.md`

---

## Migration Recipe Reference

Every contract migration follows a combination of these recipes. Read this section before starting any Phase 1 task.

### Structural Changes (apply to EVERY contract)

**S1 — Type signature:** Remove the `O` generic parameter.

```typescript
// Before:
export const MyHook: SyncHookContract<ToolHookInput, ContinueOutput, MyDeps> = { ... };
// After:
export const MyHook: SyncHookContract<ToolHookInput, MyDeps> = { ... };

// Before (async):
export const MyHook: AsyncHookContract<StopInput, SilentOutput, MyDeps> = { ... };
// After:
export const MyHook: AsyncHookContract<StopInput, MyDeps> = { ... };
```

**S2 — Imports:** Remove ALL imports from `@hooks/core/types/hook-outputs`. No replacement import needed — `contract.ts` constrains the return type to `SyncHookJSONOutput` automatically.

```typescript
// DELETE these lines:
import { continueOk } from "@hooks/core/types/hook-outputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import { block, continueOk, silent } from "@hooks/core/types/hook-outputs";
import type {
  BlockOutput,
  ContinueOutput,
  SilentOutput,
} from "@hooks/core/types/hook-outputs";
// etc.
```

### Output Recipes

**R1 — Simple continue** (no context injection):

```typescript
// Before:
return ok(continueOk());
// or:
return ok({ type: "continue", continue: true });
// or:
return ok({ type: "continue" as const, continue: true as const });

// After:
return ok({ continue: true });
```

**R2 — Continue with context** (events WITH `hookSpecificOutput` support):

Events: PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, SessionStart, Setup, SubagentStart, Notification, PermissionRequest, PermissionDenied, Elicitation, ElicitationResult, CwdChanged, FileChanged, WorktreeCreate.

```typescript
// Before:
return ok(continueOk(summary));

// After — replace EVENT with the contract's actual event name:
return ok({
  hookSpecificOutput: {
    hookEventName: "PostToolUse", // ← must match the contract's event
    additionalContext: summary,
  },
});
```

**R3 — Continue with context** (events WITHOUT `hookSpecificOutput` support):

Events: PreCompact, PostCompact, SessionEnd, Stop, StopFailure, SubagentStop, TeammateIdle, TaskCreated, TaskCompleted, ConfigChange, WorktreeRemove, InstructionsLoaded.

```typescript
// Before:
return ok(continueOk(summary));

// After:
return ok({ continue: true, systemMessage: summary });
```

**R4 — Block on PreToolUse:**

```typescript
// Before:
return ok(block(reason));
// or:
return ok({ type: "block", decision: "block", reason });

// After:
return ok({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason,
  },
});
```

**R5 — Block on non-PreToolUse events** (Stop, UserPromptSubmit, etc.):

```typescript
// Before:
return ok(block(reason));

// After:
return ok({ decision: "block", reason });
```

**R6 — Ask** (PreToolUse only):

```typescript
// Before:
return ok(ask(message));
// or:
return ok({ type: "ask", decision: "ask", message });

// After:
return ok({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: message,
  },
});
```

**R7 — Context injection** (raw string output → hookSpecificOutput):

```typescript
// Before:
return ok(context(text));
// or:
return ok({ type: "context", content: text });

// After (events WITH hookSpecificOutput support):
return ok({
  hookSpecificOutput: {
    hookEventName: "SessionStart", // ← match the event
    additionalContext: text,
  },
});
```

**R8 — Silent** (side-effect-only hooks):

```typescript
// Before:
return ok(silent());
// or:
return ok({ type: "silent" });

// After:
return ok({});
```

**R9 — Updated input** (PreToolUse tool input modification):

```typescript
// Before:
return ok(updatedInput({ command: newCmd }));
// or:
return ok({ type: "updatedInput", updatedInput: { command: newCmd } });

// After:
return ok({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    updatedInput: { command: newCmd },
  },
});
```

### Test Migration

**T1 — Remove output type imports** from test files (same as S2).

**T2 — Update type assertions** — `SyncHookJSONOutput` has no `type` field:

```typescript
// Before:
expect(result.value.type).toBe("continue");
expect((result.value as ContinueOutput).additionalContext).toBe("...");

// After:
expect(result.value.continue).toBe(true);
// or for hookSpecificOutput:
expect(result.value.hookSpecificOutput?.additionalContext).toBe("...");
```

**T3 — Update inline contract definitions in tests:**

```typescript
// Before:
const contract: HookContract<ToolHookInput, ContinueOutput, {}> = { ... };

// After:
const contract: HookContract<ToolHookInput, {}> = { ... };
```

**T4 — Update return values in test contracts:**

```typescript
// Before:
execute: () => ok({ type: "continue", continue: true as const }),

// After:
execute: () => ok({ continue: true }),
```

---

## Phase 0: Foundation (Sequential — must complete before Phase 1)

### Task 0A: Create `core/types/hook-output-helpers.ts`

**Files:**

- Create: `core/types/hook-output-helpers.ts`

**Step 1: Create the type alias file**

```typescript
/**
 * Type aliases derived from @anthropic-ai/claude-agent-sdk.
 *
 * These provide compile-time safety without runtime overhead.
 * No functions — just types extracted from the SDK union.
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

/** Event names that support hookSpecificOutput — derived from the SDK discriminated union. */
export type HookSpecificEventName = NonNullable<
  SyncHookJSONOutput["hookSpecificOutput"]
>["hookEventName"];

/**
 * Events that CANNOT use hookSpecificOutput.
 * These events can only use top-level fields: continue, systemMessage, decision, reason, etc.
 */
export type NonHookSpecificEvent =
  | "PreCompact"
  | "PostCompact"
  | "SessionEnd"
  | "Stop"
  | "StopFailure"
  | "SubagentStop"
  | "TeammateIdle"
  | "TaskCreated"
  | "TaskCompleted"
  | "ConfigChange"
  | "WorktreeRemove"
  | "InstructionsLoaded";
```

**Step 2: Verify types compile**

Run: `cd /Users/hogers/.claude/pai-hooks && npx tsc --noEmit core/types/hook-output-helpers.ts`
Expected: No errors.

**Step 3: Commit**

```bash
git add core/types/hook-output-helpers.ts
git commit -m "feat: add SDK-derived type aliases for hook output helpers"
```

---

### Task 0B: Update `core/contract.ts`

**Files:**

- Modify: `core/contract.ts`

**Step 1: Read the current file**

Read `core/contract.ts` to confirm it matches expectations.

**Step 2: Replace with SDK-typed version**

```typescript
/**
 * HookContract — The interface every hook must implement.
 *
 * Contracts are pure logic. No I/O, no try/catch. The runner handles
 * stdin, parsing, error recovery, and output formatting.
 *
 * Three variants:
 *   SyncHookContract  — execute returns Result (most hooks)
 *   AsyncHookContract — execute returns Promise<Result> (I/O-heavy hooks)
 *   HookContract      — union of both (used by the runner)
 *
 * Type parameters:
 *   I = input type (what the hook receives after parsing)
 *   D = deps type (injectable dependencies for testing)
 *
 * Output type is always SyncHookJSONOutput from the SDK — no custom output types.
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { HookEventType, HookInput } from "@hooks/core/types/hook-inputs";

interface HookContractBase<I extends HookInput = HookInput, D = unknown> {
  /** Human-readable hook name for logging and error context. */
  name: string;

  /** Which hook event type(s) this contract handles. */
  event: HookEventType | HookEventType[];

  /** ISP gate: return true if this hook should process the given input. */
  accepts(input: I): boolean;

  /** DIP injection point: default production dependencies. */
  defaultDeps: D;
}

export interface SyncHookContract<
  I extends HookInput = HookInput,
  D = unknown,
> extends HookContractBase<I, D> {
  /** SRP core: synchronous pure business logic. Returns Result, never throws. */
  execute(input: I, deps: D): Result<SyncHookJSONOutput, ResultError>;
}

export interface AsyncHookContract<
  I extends HookInput = HookInput,
  D = unknown,
> extends HookContractBase<I, D> {
  /** SRP core: async business logic. Returns Promise<Result>, never throws. */
  execute(input: I, deps: D): Promise<Result<SyncHookJSONOutput, ResultError>>;
}

/** Union type accepted by the runner. Contracts should use SyncHookContract or AsyncHookContract. */
export type HookContract<I extends HookInput = HookInput, D = unknown> =
  | SyncHookContract<I, D>
  | AsyncHookContract<I, D>;
```

**Step 3: Verify it compiles**

Run: `cd /Users/hogers/.claude/pai-hooks && npx tsc --noEmit core/contract.ts`
Expected: Errors in downstream files (contracts still use old generics). That's expected — Phase 1 fixes them.

**Step 4: Commit**

```bash
git add core/contract.ts
git commit -m "feat: contract.ts uses SyncHookJSONOutput, drops O generic"
```

---

### Task 0C: Update `core/runner.ts`

**Files:**

- Modify: `core/runner.ts`

**Step 1: Read the current file**

Read `core/runner.ts` to confirm it matches expectations.

**Step 2: Replace with SDK-direct version**

Key changes:

1. Delete `formatOutput` function entirely
2. Remove `HookOutput` import
3. Add `validateHookOutput` import from output schema
4. Change `executePipeline` to JSON.stringify result directly with schema validation
5. Remove `output_type` from log entries (no more `type` field)
6. Update type signatures to drop `O` generic

```typescript
/**
 * HookRunner — The shared pipeline that replaces 30+ lines of boilerplate per hook.
 *
 * Pipeline: stdin → parse → accepts → execute → validate → serialize → exit
 *
 * This file and the adapters are the ONLY boundary layers where
 * uncaught errors are handled. Everything above (contracts) uses pure Result pipelines.
 */

import { appendHookLog, type HookLogEntry } from "@hooks/core/adapters/log";
import { readStdin } from "@hooks/core/adapters/stdin";
import type { HookContract } from "@hooks/core/contract";
import {
  ErrorCode,
  jsonParseFailed,
  type ResultError,
} from "@hooks/core/error";
import { ok, type Result, tryCatch } from "@hooks/core/result";
import { isDuplicate } from "@hooks/core/dedup";
import type {
  HookEventType,
  HookInput,
  HookInputBase,
} from "@hooks/core/types/hook-inputs";
import {
  getEventType as schemaGetEventType,
  parseHookInput,
} from "@hooks/core/types/hook-input-schema";
import { validateHookOutput } from "@hooks/core/types/hook-output-schema";

// ─── Event Resolution ──────────────────────────────────────────────────────

/**
 * Normalize contract.event for logging/formatting.
 * When a contract declares multiple events, infer the actual event from input shape.
 */
function resolveEvent(
  contractEvent: HookEventType | HookEventType[],
  input: HookInput,
): string {
  if (!Array.isArray(contractEvent)) return contractEvent;
  const parsed = parseHookInput(input);
  if (parsed._tag === "Right") return schemaGetEventType(parsed.right);
  return contractEvent[0];
}

// ─── JSON Parsing ────────────────────────────────────────────────────────────

function parseJson(raw: string): Result<HookInput, ResultError> {
  return tryCatch(
    () => JSON.parse(raw) as HookInput,
    (e) => jsonParseFailed(raw, e),
  );
}

// ─── Pipeline Context ───────────────────────────────────────────────────────

interface PipelineIO {
  write: (msg: string) => void;
  writeErr: (msg: string) => void;
  exit: (code: number) => void;
  checkDuplicate: (
    hookName: string,
    sessionId: string,
    input: HookInput,
  ) => boolean;
  log: (entry: HookLogEntry) => void;
  startTime: number;
}

function createPipelineIO(options: RunHookOptions): PipelineIO {
  const writeErr =
    options.stderr ?? ((msg: string) => process.stderr.write(`${msg}\n`));
  return {
    write: options.stdout ?? ((msg: string) => process.stdout.write(msg)),
    writeErr,
    exit: options.exit ?? ((code: number) => process.exit(code)),
    checkDuplicate: options.isDuplicate ?? isDuplicate,
    log:
      options.appendLog ??
      ((entry: HookLogEntry) => {
        appendHookLog(entry, undefined, undefined, writeErr);
      }),
    startTime: performance.now(),
  };
}

function makeEmitLog(
  io: PipelineIO,
  contract: { name: string; event: HookEventType | HookEventType[] },
  sessionId: string | undefined,
  input?: HookInput,
): (status: HookLogEntry["status"], error?: string) => void {
  return (status, error?) => {
    io.log({
      ts: new Date().toISOString(),
      hook: contract.name,
      event: input
        ? resolveEvent(contract.event, input)
        : Array.isArray(contract.event)
          ? contract.event[0]
          : contract.event,
      status,
      duration_ms: Math.round(performance.now() - io.startTime),
      session_id: sessionId,
      ...(error ? { error } : {}),
    });
  };
}

// ─── Shared Execute Pipeline ────────────────────────────────────────────────

/**
 * The shared post-parse pipeline: accepts → dedup → execute → validate → serialize → output.
 *
 * Both runHook and runHookWith call this after obtaining a parsed input.
 */
async function executePipeline<I extends HookInput, D>(
  contract: HookContract<I, D>,
  input: I,
  io: PipelineIO,
  safeExit: () => void,
  opts?: { handleSecurityBlock?: boolean },
): Promise<void> {
  const sessionId = (input as HookInputBase).session_id;
  const emitLog = makeEmitLog(io, contract, sessionId, input);

  if (!contract.accepts(input)) {
    emitLog("skipped");
    safeExit();
    return;
  }

  if (sessionId && io.checkDuplicate(contract.name, sessionId, input)) {
    emitLog("skipped");
    safeExit();
    return;
  }

  const result = await Promise.resolve(
    contract.execute(input, contract.defaultDeps),
  );

  if (!result.ok) {
    io.writeErr(`[${contract.name}] error: ${result.error.message}`);
    emitLog("error", result.error.message);

    if (
      opts?.handleSecurityBlock &&
      result.error.code === ErrorCode.SecurityBlock
    ) {
      io.exit(2);
      return;
    }

    safeExit();
    return;
  }

  // Validate against SDK schema (fail-open safety net)
  const validated = validateHookOutput(result.value);
  if (validated._tag === "Left") {
    io.writeErr(
      `[${contract.name}] output validation failed: ${validated.left.message}`,
    );
    emitLog("error", `output validation: ${validated.left.message}`);
    io.write(JSON.stringify({ continue: true }));
    io.exit(0);
    return;
  }

  // Direct serialization — contracts return SyncHookJSONOutput, no mapping needed
  const json = JSON.stringify(result.value);
  if (json !== "{}") {
    io.write(json);
  }
  emitLog("ok");
  io.exit(0);
}

// ─── The Runner ──────────────────────────────────────────────────────────────

export interface RunHookOptions {
  /** Stdin timeout in milliseconds. Default: 200. */
  stdinTimeout?: number;
  /** Override stdout for testing. */
  stdout?: (msg: string) => void;
  /** Override stderr for testing. */
  stderr?: (msg: string) => void;
  /** Override exit for testing. */
  exit?: (code: number) => void;
  /** Override stdin reader for testing. Bypasses readStdin. */
  stdinOverride?: string;
  /** Override log writer for testing. */
  appendLog?: (entry: HookLogEntry) => void;
  /** Override dedup guard for testing. Return true to skip as duplicate. */
  isDuplicate?: (
    hookName: string,
    sessionId: string,
    input: HookInput,
  ) => boolean;
}

/**
 * Run a hook contract with a pre-built input, skipping stdin.
 */
export async function runHookWith<I extends HookInput, D>(
  contract: HookContract<I, D>,
  input: I,
  options: Omit<RunHookOptions, "stdinOverride" | "stdinTimeout"> = {},
): Promise<void> {
  const io = createPipelineIO(options);
  const safeExit = () => io.exit(0);

  await executePipeline(contract, input, io, safeExit).catch((e) => {
    io.writeErr(
      `[${contract.name}] uncaught: ${e instanceof Error ? e.message : e}`,
    );
    makeEmitLog(
      io,
      contract,
      undefined,
    )("error", e instanceof Error ? e.message : String(e));
    safeExit();
  });
}

/**
 * Run a hook contract through the standard pipeline.
 *
 * This is the ONLY entry point hooks need. The .hook.ts file becomes:
 *   runHook(MyContract);
 */
export async function runHook<I extends HookInput, D>(
  contract: HookContract<I, D>,
  options: RunHookOptions = {},
): Promise<void> {
  const io = createPipelineIO(options);
  const timeoutMs = options.stdinTimeout ?? 200;
  const events = Array.isArray(contract.event)
    ? contract.event
    : [contract.event];
  const contractHandlesToolEvents =
    events.includes("PreToolUse") || events.includes("PostToolUse");

  let inputIsToolEvent = false;
  let inputParsed = false;

  const safeExit = () => {
    if (inputIsToolEvent || (contractHandlesToolEvents && !inputParsed)) {
      io.write(JSON.stringify({ continue: true }));
    }
    io.exit(0);
  };

  const runStdinPipeline = async (): Promise<void> => {
    let rawResult: Result<string, ResultError>;
    if (options.stdinOverride !== undefined) {
      rawResult = ok(options.stdinOverride);
    } else {
      rawResult = await readStdin(timeoutMs);
    }

    if (!rawResult.ok) {
      io.writeErr(`[${contract.name}] stdin: ${rawResult.error.message}`);
      makeEmitLog(io, contract, undefined)("error", rawResult.error.message);
      safeExit();
      return;
    }

    const inputResult = parseJson(rawResult.value);
    if (!inputResult.ok) {
      io.writeErr(`[${contract.name}] parse: ${inputResult.error.message}`);
      makeEmitLog(io, contract, undefined)("error", inputResult.error.message);
      safeExit();
      return;
    }

    const input = inputResult.value as I;
    inputParsed = true;
    inputIsToolEvent = "tool_name" in inputResult.value;

    if (contractHandlesToolEvents && !inputIsToolEvent && events.length === 1) {
      const resolvedEvent = resolveEvent(contract.event, input);
      io.writeErr(
        `[${contract.name}] input missing tool_name for ${resolvedEvent} contract — check settings.json event routing`,
      );
      makeEmitLog(
        io,
        contract,
        (input as HookInputBase).session_id,
        input,
      )("error", "input missing tool_name");
      safeExit();
      return;
    }

    await executePipeline(contract, input, io, safeExit, {
      handleSecurityBlock: true,
    });
  };

  await runStdinPipeline().catch((e) => {
    io.writeErr(
      `[${contract.name}] uncaught: ${e instanceof Error ? e.message : e}`,
    );
    makeEmitLog(
      io,
      contract,
      undefined,
    )("error", e instanceof Error ? e.message : String(e));
    safeExit();
  });
}
```

**Step 3: Verify it compiles** (expect downstream errors, that's fine)

Run: `cd /Users/hogers/.claude/pai-hooks && npx tsc --noEmit core/runner.ts 2>&1 | head -5`

**Step 4: Commit**

```bash
git add core/runner.ts
git commit -m "feat: runner uses direct SyncHookJSONOutput serialization, delete formatOutput"
```

---

### Task 0D: Update runner tests

**Files:**

- Modify: `core/runner.test.ts`
- Modify: `core/runner.coverage.test.ts`

**Step 1: Read both test files**

**Step 2: Update `core/runner.test.ts`**

Key changes:

- Remove `import type { BlockOutput, ContextOutput, ContinueOutput, SilentOutput } from "./types/hook-outputs"`
- Update all inline contract definitions: drop `O` generic from `HookContract<I, O, D>`
- Update return values: remove `type` field, use SDK-shaped objects
- Update assertions: check SDK fields, not internal `type` field

Replace the full test file. Example of updated test contracts:

```typescript
import { describe, expect, it } from "bun:test";
import type { HookContract } from "./contract";
import { invalidInput } from "./error";
import { err, ok } from "./result";
import { type RunHookOptions, runHook } from "./runner";
import type { ToolHookInput } from "./types/hook-inputs";

// ─── Test Helpers ────────────────────────────────────────────────────────────

interface MockIO {
  stdoutLines: string[];
  stderrLines: string[];
  exitCode: number | null;
}

function createMockIO(): MockIO & RunHookOptions {
  const io: MockIO = { stdoutLines: [], stderrLines: [], exitCode: null };
  return {
    ...io,
    stdout: (msg: string) => {
      io.stdoutLines.push(msg);
    },
    stderr: (msg: string) => {
      io.stderrLines.push(msg);
    },
    exit: (code: number) => {
      io.exitCode = code;
    },
    isDuplicate: () => false,
    get stdoutLines() {
      return io.stdoutLines;
    },
    get stderrLines() {
      return io.stderrLines;
    },
    get exitCode() {
      return io.exitCode;
    },
  };
}

// Simple contract that always continues
const alwaysContinue: HookContract<ToolHookInput, {}> = {
  name: "TestContinue",
  event: "PostToolUse",
  accepts: () => true,
  execute: () => ok({ continue: true }),
  defaultDeps: {},
};

// Contract that adds context via hookSpecificOutput
const withContext: HookContract<ToolHookInput, {}> = {
  name: "TestContext",
  event: "PostToolUse",
  accepts: (input) => input.tool_name === "TaskUpdate",
  execute: () =>
    ok({
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        additionalContext: "extra info",
      },
    }),
  defaultDeps: {},
};

// Contract that returns empty-string context (regression test)
const withEmptyContext: HookContract<ToolHookInput, {}> = {
  name: "TestEmptyContext",
  event: "PostToolUse",
  accepts: () => true,
  execute: () =>
    ok({
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        additionalContext: "",
      },
    }),
  defaultDeps: {},
};

// Contract that blocks via hookSpecificOutput permissionDecision
const blocker: HookContract<ToolHookInput, {}> = {
  name: "TestBlocker",
  event: "PreToolUse",
  accepts: () => true,
  execute: () =>
    ok({
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: "not allowed",
      },
    }),
  defaultDeps: {},
};

// Contract that returns error
const failing: HookContract<ToolHookInput, {}> = {
  name: "TestFailing",
  event: "PostToolUse",
  accepts: () => true,
  execute: () => err(invalidInput("bad data")),
  defaultDeps: {},
};

// Contract that rejects via accepts()
const selective: HookContract<ToolHookInput, {}> = {
  name: "TestSelective",
  event: "PostToolUse",
  accepts: (input) => input.tool_name === "SpecificTool",
  execute: () =>
    ok({
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        additionalContext: "accepted",
      },
    }),
  defaultDeps: {},
};

// Async contract
const asyncContract: HookContract<ToolHookInput, {}> = {
  name: "TestAsync",
  event: "PostToolUse",
  accepts: () => true,
  execute: async () =>
    ok({
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        additionalContext: "async done",
      },
    }),
  defaultDeps: {},
};

// Empty output contract (previously "silent")
const emptyOutput: HookContract<ToolHookInput, {}> = {
  name: "TestEmpty",
  event: "Stop",
  accepts: () => true,
  execute: () => ok({}),
  defaultDeps: {},
};

const validToolInput = JSON.stringify({
  session_id: "test-sess",
  tool_name: "TaskUpdate",
  tool_input: { taskId: "C1", status: "in_progress" },
});

// ─── Pipeline Tests ──────────────────────────────────────────────────────────

describe("runHook — pipeline basics", () => {
  it("produces continue JSON for simple contract", async () => {
    const io = createMockIO();
    await runHook(alwaysContinue, { ...io, stdinOverride: validToolInput });
    expect(io.stdoutLines.length).toBe(1);
    expect(JSON.parse(io.stdoutLines[0])).toEqual({ continue: true });
    expect(io.exitCode).toBe(0);
  });

  it("includes additionalContext inside hookSpecificOutput", async () => {
    const io = createMockIO();
    await runHook(withContext, { ...io, stdinOverride: validToolInput });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(output.hookSpecificOutput.additionalContext).toBe("extra info");
  });

  it("preserves empty string additionalContext (not dropped as falsy)", async () => {
    const io = createMockIO();
    await runHook(withEmptyContext, { ...io, stdinOverride: validToolInput });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(output.hookSpecificOutput.additionalContext).toBe("");
  });

  it("produces PreToolUse block via hookSpecificOutput permissionDecision", async () => {
    const io = createMockIO();
    await runHook(blocker, { ...io, stdinOverride: validToolInput });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe(
      "not allowed",
    );
  });

  it("falls back to safe continue on execute error", async () => {
    const io = createMockIO();
    await runHook(failing, { ...io, stdinOverride: validToolInput });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.continue).toBe(true);
    expect(io.stderrLines.some((l) => l.includes("bad data"))).toBe(true);
  });
});

describe("runHook — accepts() gate", () => {
  it("skips execution when accepts returns false", async () => {
    const io = createMockIO();
    const input = JSON.stringify({
      session_id: "s",
      tool_name: "OtherTool",
      tool_input: {},
    });
    await runHook(selective, { ...io, stdinOverride: input });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.continue).toBe(true);
    expect(output.hookSpecificOutput).toBeUndefined();
  });

  it("runs execution when accepts returns true", async () => {
    const io = createMockIO();
    const input = JSON.stringify({
      session_id: "s",
      tool_name: "SpecificTool",
      tool_input: {},
    });
    await runHook(selective, { ...io, stdinOverride: input });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.additionalContext).toBe("accepted");
  });
});

describe("runHook — input handling", () => {
  it("handles empty stdin gracefully", async () => {
    const io = createMockIO();
    await runHook(alwaysContinue, { ...io, stdinOverride: "" });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.continue).toBe(true);
  });

  it("handles invalid JSON gracefully", async () => {
    const io = createMockIO();
    await runHook(alwaysContinue, { ...io, stdinOverride: "not json {{{" });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.continue).toBe(true);
    expect(io.stderrLines.some((l) => l.includes("parse"))).toBe(true);
  });
});

describe("runHook — output types", () => {
  it("async contracts work correctly", async () => {
    const io = createMockIO();
    await runHook(asyncContract, { ...io, stdinOverride: validToolInput });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.additionalContext).toBe("async done");
  });

  it("empty output produces no stdout", async () => {
    const io = createMockIO();
    await runHook(emptyOutput, { ...io, stdinOverride: validToolInput });
    expect(io.stdoutLines.length).toBe(0);
    expect(io.exitCode).toBe(0);
  });
});

describe("runHook — error safety", () => {
  it("catches thrown exceptions in execute", async () => {
    const throwing: HookContract<ToolHookInput, {}> = {
      name: "TestThrowing",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => {
        throw new Error("boom");
      },
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(throwing, { ...io, stdinOverride: validToolInput });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.continue).toBe(true);
    expect(io.stderrLines.some((l) => l.includes("boom"))).toBe(true);
  });

  it("always exits 0", async () => {
    const io = createMockIO();
    await runHook(failing, { ...io, stdinOverride: validToolInput });
    expect(io.exitCode).toBe(0);
  });
});
```

**Step 3: Update `core/runner.coverage.test.ts` similarly** — same pattern: drop `O` generic, remove hook-output imports, use SDK-shaped objects.

**Step 4: Run tests**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test core/runner.test.ts core/runner.coverage.test.ts`
Expected: All pass.

**Step 5: Commit**

```bash
git add core/runner.test.ts core/runner.coverage.test.ts
git commit -m "test: update runner tests for SyncHookJSONOutput"
```

---

### Task 0E: Update `core/index.ts` barrel exports

**Files:**

- Modify: `core/index.ts`

**Step 1: Read the current barrel file**

**Step 2: Replace hook-outputs exports with SDK re-exports**

Remove the entire `// Output types` export block:

```typescript
// DELETE:
export {
  type AskOutput,
  ask,
  type BlockOutput,
  block,
  type ContextOutput,
  type ContinueOutput,
  context,
  continueOk,
  type HookOutput,
  type SilentOutput,
  silent,
} from "@hooks/core/types/hook-outputs";
```

Add SDK type re-export and helpers:

```typescript
// SDK output type (source of truth)
export type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
// Type helpers derived from SDK
export type {
  HookSpecificEventName,
  NonHookSpecificEvent,
} from "@hooks/core/types/hook-output-helpers";
// Output schema validation
export { validateHookOutput } from "@hooks/core/types/hook-output-schema";
```

**Step 3: Verify no compile errors in index.ts itself**

Run: `cd /Users/hogers/.claude/pai-hooks && npx tsc --noEmit core/index.ts 2>&1 | head -5`

**Step 4: Commit**

```bash
git add core/index.ts
git commit -m "feat: barrel exports SDK types instead of custom hook-outputs"
```

---

### Task 0F: Update `core/types/hook-output-schema.ts`

**Files:**

- Modify: `core/types/hook-output-schema.ts`

**Step 1: Read the current file**

**Step 2: Remove the `HookOutput` import and the `encodeHookOutput`/`buildOutputObject` functions**

These functions convert internal `HookOutput` to wire format — no longer needed since contracts return wire format directly.

Keep: `SyncHookJSONOutput` schema, `HookSpecificOutput` union, `validateHookOutput`, `HOOK_SPECIFIC_EVENTS`.
Delete: `import type { HookOutput }`, `encodeHookOutput`, `buildOutputObject`.

```typescript
/**
 * Effect Schema for hook outputs — validated against Claude Code's actual acceptance rules.
 *
 * Source of truth: @anthropic-ai/claude-agent-sdk hookSpecificOutput discriminated union.
 * Reference: https://code.claude.com/docs/en/agent-sdk/hooks
 *
 * Usage:
 *   import { validateHookOutput } from "@hooks/core/types/hook-output-schema";
 *   const result = validateHookOutput(contractOutput);
 *   if (result._tag === "Left") { // validation failed
 *   }
 */

import { Schema } from "effect";

// ─── hookSpecificOutput variants (discriminated on hookEventName) ────────────

const PreToolUseSpecific = Schema.Struct({
  hookEventName: Schema.Literal("PreToolUse"),
  permissionDecision: Schema.optional(Schema.Literal("allow", "deny", "ask", "defer")),
  permissionDecisionReason: Schema.optional(Schema.String),
  updatedInput: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  additionalContext: Schema.optional(Schema.String),
});

const PostToolUseSpecific = Schema.Struct({
  hookEventName: Schema.Literal("PostToolUse"),
  additionalContext: Schema.optional(Schema.String),
  updatedMCPToolOutput: Schema.optional(Schema.Unknown),
});

const PostToolUseFailureSpecific = Schema.Struct({
  hookEventName: Schema.Literal("PostToolUseFailure"),
  additionalContext: Schema.optional(Schema.String),
});

const UserPromptSubmitSpecific = Schema.Struct({
  hookEventName: Schema.Literal("UserPromptSubmit"),
  additionalContext: Schema.optional(Schema.String),
  sessionTitle: Schema.optional(Schema.String),
});

const SessionStartSpecific = Schema.Struct({
  hookEventName: Schema.Literal("SessionStart"),
  additionalContext: Schema.optional(Schema.String),
  initialUserMessage: Schema.optional(Schema.String),
  watchPaths: Schema.optional(Schema.Array(Schema.String)),
});

const SetupSpecific = Schema.Struct({
  hookEventName: Schema.Literal("Setup"),
  additionalContext: Schema.optional(Schema.String),
});

const SubagentStartSpecific = Schema.Struct({
  hookEventName: Schema.Literal("SubagentStart"),
  additionalContext: Schema.optional(Schema.String),
});

const NotificationSpecific = Schema.Struct({
  hookEventName: Schema.Literal("Notification"),
  additionalContext: Schema.optional(Schema.String),
});

const PermissionRequestSpecific = Schema.Struct({
  hookEventName: Schema.Literal("PermissionRequest"),
  decision: Schema.Union(
    Schema.Struct({
      behavior: Schema.Literal("allow"),
      updatedInput: Schema.optional(
        Schema.Record({ key: Schema.String, value: Schema.Unknown }),
      ),
    }),
    Schema.Struct({
      behavior: Schema.Literal("deny"),
      message: Schema.optional(Schema.String),
      interrupt: Schema.optional(Schema.Boolean),
    }),
  ),
});

const PermissionDeniedSpecific = Schema.Struct({
  hookEventName: Schema.Literal("PermissionDenied"),
  retry: Schema.optional(Schema.Boolean),
});

const ElicitationSpecific = Schema.Struct({
  hookEventName: Schema.Literal("Elicitation"),
  action: Schema.optional(Schema.Literal("accept", "decline", "cancel")),
  content: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

const ElicitationResultSpecific = Schema.Struct({
  hookEventName: Schema.Literal("ElicitationResult"),
  action: Schema.optional(Schema.Literal("accept", "decline", "cancel")),
  content: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

const CwdChangedSpecific = Schema.Struct({
  hookEventName: Schema.Literal("CwdChanged"),
  watchPaths: Schema.optional(Schema.Array(Schema.String)),
});

const FileChangedSpecific = Schema.Struct({
  hookEventName: Schema.Literal("FileChanged"),
  watchPaths: Schema.optional(Schema.Array(Schema.String)),
});

const WorktreeCreateSpecific = Schema.Struct({
  hookEventName: Schema.Literal("WorktreeCreate"),
  worktreePath: Schema.String,
});

// ─── hookSpecificOutput union ───────────────────────────────────────────────

export const HookSpecificOutput = Schema.Union(
  PreToolUseSpecific,
  PostToolUseSpecific,
  PostToolUseFailureSpecific,
  UserPromptSubmitSpecific,
  SessionStartSpecific,
  SetupSpecific,
  SubagentStartSpecific,
  NotificationSpecific,
  PermissionRequestSpecific,
  PermissionDeniedSpecific,
  ElicitationSpecific,
  ElicitationResultSpecific,
  CwdChangedSpecific,
  FileChangedSpecific,
  WorktreeCreateSpecific,
);

export type HookSpecificOutputType = typeof HookSpecificOutput.Type;

// ─── Top-level sync output ──────────────────────────────────────────────────

export const SyncHookJSONOutput = Schema.Struct({
  continue: Schema.optional(Schema.Boolean),
  suppressOutput: Schema.optional(Schema.Boolean),
  stopReason: Schema.optional(Schema.String),
  decision: Schema.optional(Schema.Literal("approve", "block")),
  systemMessage: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  hookSpecificOutput: Schema.optional(HookSpecificOutput),
});

export type SyncHookJSONOutputType = typeof SyncHookJSONOutput.Type;

// ─── Events that support hookSpecificOutput ─────────────────────────────────

export const HOOK_SPECIFIC_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit",
  "SessionStart",
  "Setup",
  "SubagentStart",
  "Notification",
  "PermissionRequest",
  "PermissionDenied",
  "Elicitation",
  "ElicitationResult",
  "CwdChanged",
  "FileChanged",
  "WorktreeCreate",
] as const);

// ─── Validation ─────────────────────────────────────────────────────────────

const validateSync = Schema.decodeUnknownEither(SyncHookJSONOutput);

/**
 * Validate a raw object against the Claude Code sync hook output schema.
 * Returns Either — Right(output) on success, Left(error) on failure.
 */
export function validateHookOutput(
  raw: unknown,
): ReturnType<typeof validateSync> {
  return validateSync(raw);
}
```

**Step 3: Run output schema tests if they exist**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test core/types/hook-output-schema 2>&1 | tail -5`

**Step 4: Commit**

```bash
git add core/types/hook-output-schema.ts
git commit -m "feat: output schema covers all SDK hookSpecificOutput variants, remove HookOutput encoder"
```

---

### Task 0G: Update `core/adapters/log.ts` (if needed)

**Files:**

- Modify: `core/adapters/log.ts` (only if `HookLogEntry` has `output_type` field)

**Step 1: Read `core/adapters/log.ts` and check if `output_type` is in the type**

If `HookLogEntry` has an `output_type` field, make it truly optional (it will no longer be populated). If it's already optional, no change needed.

**Step 2: Commit if changed**

```bash
git add core/adapters/log.ts
git commit -m "chore: make output_type optional in HookLogEntry"
```

---

## Phase 1: Contract Migrations (PARALLEL — one task per hook group)

**Prerequisites:** All Phase 0 tasks complete. Run `npx tsc --noEmit` to confirm foundation compiles.

**For each task below:**

1. Read every contract file listed
2. Apply recipes S1, S2 (structural) to every file
3. Apply the output recipes listed per contract
4. Update all test files in the group
5. Run `bun test hooks/{Group}/` to verify
6. Commit: `git commit -m "migrate: {GroupName} contracts to SyncHookJSONOutput"`

---

### Task 1A: WorkLifecycle (6 contracts) — PRIORITY: fixes PreCompactStatePersist bug

| Contract               | Event       | Recipes | Notes                                                                          |
| ---------------------- | ----------- | ------- | ------------------------------------------------------------------------------ |
| ArticleWriter          | Stop        | R8      | Async, silent side-effect                                                      |
| AutoWorkCreation       | PostToolUse | R8      | Async, silent side-effect                                                      |
| PRDSync                | PostToolUse | R1, R2  | `continueOk(text)` → hookSpecificOutput with PostToolUse                       |
| PreCompactStatePersist | PreCompact  | R1, R3  | **THE BUG**: PreCompact has NO hookSpecificOutput. Use `systemMessage` instead |
| SessionSummary         | Stop        | R8      | Async, silent side-effect                                                      |
| WorkCompletionLearning | Stop        | R8      | Async, silent side-effect                                                      |

**Files:**

- `hooks/WorkLifecycle/ArticleWriter/ArticleWriter.contract.ts`
- `hooks/WorkLifecycle/AutoWorkCreation/AutoWorkCreation.contract.ts`
- `hooks/WorkLifecycle/PRDSync/PRDSync.contract.ts`
- `hooks/WorkLifecycle/PreCompactStatePersist/PreCompactStatePersist.contract.ts`
- `hooks/WorkLifecycle/PreCompactStatePersist/PreCompactStatePersist.test.ts`
- `hooks/WorkLifecycle/SessionSummary/SessionSummary.contract.ts`
- `hooks/WorkLifecycle/WorkCompletionLearning/WorkCompletionLearning.contract.ts`

**Critical — PreCompactStatePersist:** This is the bug that started this whole effort. The fix:

```typescript
// Before (broken — PreCompact doesn't support hookSpecificOutput):
return ok(continueOk(summary)); // Runner stamps hookEventName: "PreCompact" → REJECTED

// After (correct):
return ok({ continue: true, systemMessage: summary });
```

---

### Task 1B: SecurityValidator (4 contracts)

| Contract               | Event             | Recipes    | Notes                                                                                                             |
| ---------------------- | ----------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| PermissionPromptLogger | PermissionRequest | R8         | Async, silent side-effect                                                                                         |
| SecurityValidator      | PreToolUse        | R1, R4, R6 | Complex: continue/block/ask. Uses `err(securityBlock())` for hard blocks (no output change needed for error path) |
| SettingsGuard          | PreToolUse        | R1, R6     | Continue or ask                                                                                                   |
| SettingsRevert         | PostToolUse       | R1, R8     | Continue or silent                                                                                                |

**Files:**

- `hooks/SecurityValidator/PermissionPromptLogger/PermissionPromptLogger.contract.ts`
- `hooks/SecurityValidator/SecurityValidator/SecurityValidator.contract.ts`
- `hooks/SecurityValidator/SettingsGuard/SettingsGuard.contract.ts`
- `hooks/SecurityValidator/SettingsRevert/SettingsRevert.contract.ts`

---

### Task 1C: CodingStandards (7 contracts)

| Contract                | Event       | Recipes | Notes                 |
| ----------------------- | ----------- | ------- | --------------------- |
| BashWriteGuard          | PreToolUse  | R1, R4  | Continue or block     |
| CodingStandardsAdvisor  | PostToolUse | R1, R2  | Continue with context |
| CodingStandardsEnforcer | PreToolUse  | R1, R4  | Continue or block     |
| DocCommitGuard          | PreToolUse  | R1, R4  | Continue or block     |
| TypeCheckVerifier       | PostToolUse | R1, R2  | Continue with context |
| TypeStrictness          | PreToolUse  | R1, R4  | Continue or block     |
| WhileLoopGuard          | PreToolUse  | R1, R4  | Continue or block     |

**Files:**

- `hooks/CodingStandards/BashWriteGuard/BashWriteGuard.contract.ts`
- `hooks/CodingStandards/BashWriteGuard/BashWriteGuard.test.ts`
- `hooks/CodingStandards/CodingStandardsAdvisor/CodingStandardsAdvisor.contract.ts`
- `hooks/CodingStandards/CodingStandardsAdvisor/CodingStandardsAdvisor.test.ts`
- `hooks/CodingStandards/CodingStandardsEnforcer/CodingStandardsEnforcer.contract.ts`
- `hooks/CodingStandards/CodingStandardsEnforcer/CodingStandardsEnforcer.test.ts`
- `hooks/CodingStandards/DocCommitGuard/DocCommitGuard.contract.ts`
- `hooks/CodingStandards/DocCommitGuard/DocCommitGuard.test.ts`
- `hooks/CodingStandards/TypeCheckVerifier/TypeCheckVerifier.contract.ts`
- `hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts`
- `hooks/CodingStandards/WhileLoopGuard/WhileLoopGuard.contract.ts`

---

### Task 1D: GitSafety (9 contracts)

| Contract                   | Event      | Recipes    | Notes                   |
| -------------------------- | ---------- | ---------- | ----------------------- |
| ApprovalGate               | PreToolUse | R1, R4     | Continue or block       |
| DestructiveDeleteGuard     | PreToolUse | R1, R4, R6 | Continue, block, or ask |
| GitAutoSync                | Stop       | R8         | Async, silent           |
| HookExecutePermission      | PreToolUse | R1         | Simple continue         |
| IssueCreateGate            | PreToolUse | R1, R4     | Continue or block       |
| MergeGate                  | PreToolUse | R1, R4     | Continue or block       |
| ProtectedBranchGuard       | PreToolUse | R1, R4     | Continue or block       |
| RebaseGuard                | PreToolUse | R1, R4     | Continue or block       |
| WorktreeSafetyVerification | PreToolUse | R1         | Simple continue         |

**Files:**

- `hooks/GitSafety/ApprovalGate/ApprovalGate.contract.ts`
- `hooks/GitSafety/ApprovalGate/ApprovalGate.test.ts`
- `hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.contract.ts`
- `hooks/GitSafety/GitAutoSync/GitAutoSync.contract.ts`
- `hooks/GitSafety/HookExecutePermission/HookExecutePermission.contract.ts`
- `hooks/GitSafety/IssueCreateGate/IssueCreateGate.contract.ts`
- `hooks/GitSafety/IssueCreateGate/IssueCreateGate.test.ts`
- `hooks/GitSafety/MergeGate/MergeGate.contract.ts`
- `hooks/GitSafety/MergeGate/MergeGate.test.ts`
- `hooks/GitSafety/ProtectedBranchGuard/ProtectedBranchGuard.contract.ts`
- `hooks/GitSafety/ProtectedBranchGuard/ProtectedBranchGuard.test.ts`
- `hooks/GitSafety/RebaseGuard/RebaseGuard.contract.ts`
- `hooks/GitSafety/WorktreeSafetyVerification/WorktreeSafetyVerification.contract.ts`
- `hooks/GitSafety/WorktreeSafetyVerification/WorktreeSafetyVerification.test.ts`

---

### Task 1E: ObligationStateMachines (9 contracts + 4 shared files)

**COMPLEX:** This group has shared state machine files that multiple contracts reference. Migrate shared files first, then contracts.

| Contract               | Event       | Recipes | Notes                                                        |
| ---------------------- | ----------- | ------- | ------------------------------------------------------------ |
| CitationEnforcement    | PostToolUse | R1, R2  | Uses shared `CitationEnforcement.ts`                         |
| CitationTracker        | PostToolUse | R1      | Simple continue                                              |
| DocObligationEnforcer  | Stop        | R5, R8  | Block or silent. Uses shared `DocObligationStateMachine.ts`  |
| DocObligationTracker   | PostToolUse | R1, R2  | Uses shared `DocObligationStateMachine.ts`                   |
| HookDocEnforcer        | Stop        | R5, R8  | Block or silent                                              |
| HookDocTracker         | PostToolUse | R1, R2  | Continue with context                                        |
| SpotCheckReview        | Stop        | R5, R8  | Block or silent. Uses shared `SpotCheckReview.ts`            |
| TestObligationEnforcer | Stop        | R5, R8  | Block or silent. Uses shared `TestObligationStateMachine.ts` |
| TestObligationTracker  | PostToolUse | R1, R2  | Uses shared `TestObligationStateMachine.ts`                  |

**Shared files (migrate these FIRST):**

- `hooks/ObligationStateMachines/DocObligationTracker/DocObligationStateMachine.ts`
- `hooks/ObligationStateMachines/TestObligationTracker/TestObligationStateMachine.ts`
- `hooks/ObligationStateMachines/CitationTracker/CitationEnforcement.ts`
- `hooks/ObligationStateMachines/SpotCheckReview/SpotCheckReview.ts`

**Test files:**

- `hooks/ObligationStateMachines/DocObligationTracker/DocObligationStateMachine.test.ts`
- `hooks/ObligationStateMachines/TestObligationTracker/TestObligationStateMachine.test.ts`
- `hooks/ObligationStateMachines/CitationTracker/CitationEnforcement.test.ts`
- `hooks/ObligationStateMachines/SpotCheckReview/SpotCheckReview.test.ts`
- `hooks/ObligationStateMachines/HookDocTracker/HookDocStateMachine.test.ts`

**Contract files:**

- `hooks/ObligationStateMachines/CitationEnforcement/CitationEnforcement.contract.ts`
- `hooks/ObligationStateMachines/CitationTracker/CitationTracker.contract.ts`
- `hooks/ObligationStateMachines/DocObligationEnforcer/DocObligationEnforcer.contract.ts`
- `hooks/ObligationStateMachines/DocObligationTracker/DocObligationTracker.contract.ts`
- `hooks/ObligationStateMachines/HookDocEnforcer/HookDocEnforcer.contract.ts`
- `hooks/ObligationStateMachines/HookDocTracker/HookDocTracker.contract.ts`
- `hooks/ObligationStateMachines/SpotCheckReview/SpotCheckReview.contract.ts`
- `hooks/ObligationStateMachines/TestObligationEnforcer/TestObligationEnforcer.contract.ts`
- `hooks/ObligationStateMachines/TestObligationTracker/TestObligationTracker.contract.ts`

---

### Task 1F: KoordDaemon (6 contracts)

| Contract               | Event        | Recipes | Notes                    |
| ---------------------- | ------------ | ------- | ------------------------ |
| AgentCompleteTracker   | PostToolUse  | R1, R2  | Continue with context    |
| AgentPrepromptInjector | PreToolUse   | R1, R9  | Continue or updatedInput |
| AgentSpawnTracker      | PostToolUse  | R1, R2  | Continue with context    |
| MessageQueueRelay      | PostToolUse  | R1, R2  | Continue with context    |
| MessageQueueServer     | SessionStart | R7, R8  | Async, context or silent |
| SessionIdRegister      | SessionStart | R8      | Async, silent            |

**Files:**

- `hooks/KoordDaemon/AgentCompleteTracker/AgentCompleteTracker.contract.ts`
- `hooks/KoordDaemon/AgentPrepromptInjector/AgentPrepromptInjector.contract.ts`
- `hooks/KoordDaemon/AgentSpawnTracker/AgentSpawnTracker.contract.ts`
- `hooks/KoordDaemon/MessageQueueRelay/MessageQueueRelay.contract.ts`
- `hooks/KoordDaemon/MessageQueueServer/MessageQueueServer.contract.ts`
- `hooks/KoordDaemon/SessionIdRegister/SessionIdRegister.contract.ts`

---

### Task 1G: SessionFraming (4 contracts)

| Contract             | Event        | Recipes | Notes                                                                                   |
| -------------------- | ------------ | ------- | --------------------------------------------------------------------------------------- |
| BranchAwareness      | SessionStart | R7, R8  | Async, context or silent                                                                |
| CheckVersion         | SessionStart | R8      | Async, silent                                                                           |
| GitignoreRecommender | SessionStart | R1, R2  | Continue with context                                                                   |
| LoadContext          | SessionStart | R7, R8  | Async, context or silent. **Large contract — context injection via hookSpecificOutput** |

**Files:**

- `hooks/SessionFraming/BranchAwareness/BranchAwareness.contract.ts`
- `hooks/SessionFraming/BranchAwareness/BranchAwareness.test.ts`
- `hooks/SessionFraming/CheckVersion/CheckVersion.contract.ts`
- `hooks/SessionFraming/GitignoreRecommender/GitignoreRecommender.contract.ts`
- `hooks/SessionFraming/GitignoreRecommender/GitignoreRecommender.test.ts`
- `hooks/SessionFraming/LoadContext/LoadContext.contract.ts`

**Note on LoadContext:** This is a large async contract (~519 lines) that returns `ContextOutput` (raw string). The migration changes it to `hookSpecificOutput.additionalContext`. This is a behavior change — Claude Code will receive the context via the hookSpecificOutput channel instead of raw stdout. The SDK docs confirm this is the intended approach for context injection.

---

### Task 1H: SteeringRuleInjector (1 contract, COMPLEX multi-event)

| Contract             | Events                                                                       | Recipes            | Notes                                               |
| -------------------- | ---------------------------------------------------------------------------- | ------------------ | --------------------------------------------------- |
| SteeringRuleInjector | SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart | R1, R2, R3, R5, R8 | Multi-event: output shape depends on resolved event |

**Files:**

- `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.ts`
- `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.test.ts`

**Migration detail:** This contract resolves the current event at runtime and branches. After migration:

```typescript
// For events WITH hookSpecificOutput (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, SubagentStart):
return ok({
  hookSpecificOutput: {
    hookEventName: resolvedEvent as HookSpecificEventName,
    additionalContext: joined,
  },
});

// For Stop event (NO hookSpecificOutput):
// Block: return ok({ decision: "block", reason: message });
// Continue: return ok({ continue: true, systemMessage: joined });
// Silent: return ok({});
```

Import `HookSpecificEventName` from `@hooks/core/types/hook-output-helpers` to type the dynamic event name.

---

### Task 1I: IdentityBranding (3 contracts)

| Contract      | Event            | Recipes    | Notes                               |
| ------------- | ---------------- | ---------- | ----------------------------------- |
| MapleBranding | UserPromptSubmit | R1, R2, R5 | Continue, block on UserPromptSubmit |
| ModeAnalytics | PostToolUse      | R8         | Async, silent                       |
| UpdateCounts  | PostToolUse      | R8         | Async, silent                       |

**Files:**

- `hooks/IdentityBranding/MapleBranding/MapleBranding.contract.ts`
- `hooks/IdentityBranding/MapleBranding/MapleBranding.test.ts`
- `hooks/IdentityBranding/ModeAnalytics/ModeAnalytics.contract.ts`
- `hooks/IdentityBranding/UpdateCounts/UpdateCounts.contract.ts`

**Note on MapleBranding block:** Uses `block()` on UserPromptSubmit (not PreToolUse). Maps to: `{ decision: "block", reason }`.

---

### Task 1J: LearningFeedback (3 contracts)

| Contract           | Event            | Recipes | Notes             |
| ------------------ | ---------------- | ------- | ----------------- |
| LearningActioner   | Stop             | R8      | Async, silent     |
| RatingCapture      | UserPromptSubmit | R7      | Context injection |
| RelationshipMemory | Stop             | R8      | Async, silent     |

**Files:**

- `hooks/LearningFeedback/LearningActioner/LearningActioner.contract.ts`
- `hooks/LearningFeedback/RatingCapture/RatingCapture.contract.ts`
- `hooks/LearningFeedback/RelationshipMemory/RelationshipMemory.contract.ts`

---

### Task 1K: AgentLifecycle (3 contracts)

| Contract            | Event         | Recipes | Notes                         |
| ------------------- | ------------- | ------- | ----------------------------- |
| AgentExecutionGuard | PreToolUse    | R1, R7  | Continue or context injection |
| AgentLifecycleStart | SubagentStart | R8      | Async, silent                 |
| AgentLifecycleStop  | SubagentStop  | R8      | Async, silent                 |

**Files:**

- `hooks/AgentLifecycle/AgentExecutionGuard/AgentExecutionGuard.contract.ts`
- `hooks/AgentLifecycle/AgentExecutionGuard/AgentExecutionGuard.test.ts`
- `hooks/AgentLifecycle/AgentLifecycleStart/AgentLifecycleStart.contract.ts`
- `hooks/AgentLifecycle/AgentLifecycleStop/AgentLifecycleStop.contract.ts`

---

### Task 1L: AlgorithmTracking (2 contracts)

| Contract              | Event        | Recipes | Notes                 |
| --------------------- | ------------ | ------- | --------------------- |
| AlgorithmTracker      | PostToolUse  | R1, R2  | Continue with context |
| CheckAlgorithmVersion | SessionStart | R8      | Async, silent         |

**Files:**

- `hooks/AlgorithmTracking/AlgorithmTracker/AlgorithmTracker.contract.ts`
- `hooks/AlgorithmTracking/CheckAlgorithmVersion/CheckAlgorithmVersion.contract.ts`

---

### Task 1M: ArchitectureEscalation (2 contracts)

| Contract               | Event       | Recipes | Notes                 |
| ---------------------- | ----------- | ------- | --------------------- |
| ArchitectureEscalation | PostToolUse | R1, R2  | Continue with context |
| SonnetDelegation       | PostToolUse | R1, R2  | Continue with context |

**Files:**

- `hooks/ArchitectureEscalation/ArchitectureEscalation/ArchitectureEscalation.contract.ts`
- `hooks/ArchitectureEscalation/SonnetDelegation/SonnetDelegation.contract.ts`
- `hooks/ArchitectureEscalation/SonnetDelegation/SonnetDelegation.test.ts`

---

### Task 1N: CanaryHook (1 contract)

| Contract   | Event        | Recipes | Notes                           |
| ---------- | ------------ | ------- | ------------------------------- |
| CanaryHook | SessionStart | R1      | Simplest hook — good smoke test |

**Files:**

- `hooks/CanaryHook/CanaryHook/CanaryHook.contract.ts`

---

### Task 1O: CodeQualityPipeline (3 contracts)

| Contract             | Event        | Recipes | Notes                 |
| -------------------- | ------------ | ------- | --------------------- |
| CodeQualityBaseline  | SessionStart | R1, R2  | Continue with context |
| CodeQualityGuard     | PostToolUse  | R1, R2  | Continue with context |
| SessionQualityReport | Stop         | R8      | Async, silent         |

**Files:**

- `hooks/CodeQualityPipeline/CodeQualityBaseline/CodeQualityBaseline.contract.ts`
- `hooks/CodeQualityPipeline/CodeQualityGuard/CodeQualityGuard.contract.ts`
- `hooks/CodeQualityPipeline/SessionQualityReport/SessionQualityReport.contract.ts`

---

### Task 1P: CronStatusLine (5 contracts)

| Contract       | Event        | Recipes | Notes         |
| -------------- | ------------ | ------- | ------------- |
| CronCreate     | PostToolUse  | R8      | Async, silent |
| CronDelete     | PostToolUse  | R8      | Async, silent |
| CronFire       | PostToolUse  | R8      | Async, silent |
| CronPrune      | SessionStart | R8      | Async, silent |
| CronSessionEnd | SessionEnd   | R8      | Async, silent |

**Files:**

- `hooks/CronStatusLine/CronCreate/CronCreate.contract.ts`
- `hooks/CronStatusLine/CronDelete/CronDelete.contract.ts`
- `hooks/CronStatusLine/CronFire/CronFire.contract.ts`
- `hooks/CronStatusLine/CronPrune/CronPrune.contract.ts`
- `hooks/CronStatusLine/CronSessionEnd/CronSessionEnd.contract.ts`

---

### Task 1Q: DuplicationDetection (2 contracts)

| Contract                | Event       | Recipes | Notes                 |
| ----------------------- | ----------- | ------- | --------------------- |
| DuplicationChecker      | PreToolUse  | R1, R4  | Continue or block     |
| DuplicationIndexBuilder | PostToolUse | R1, R2  | Continue with context |

**Files:**

- `hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.contract.ts`
- `hooks/DuplicationDetection/DuplicationChecker/DuplicationChecker.test.ts`
- `hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.contract.ts`
- `hooks/DuplicationDetection/DuplicationIndexBuilder/DuplicationIndexBuilder.test.ts`

---

### Task 1R: ExecutionEvidence (1 contract)

| Contract                  | Event       | Recipes | Notes                 |
| ------------------------- | ----------- | ------- | --------------------- |
| ExecutionEvidenceVerifier | PostToolUse | R1, R2  | Continue with context |

**Files:**

- `hooks/ExecutionEvidence/ExecutionEvidenceVerifier/ExecutionEvidenceVerifier.contract.ts`
- `hooks/ExecutionEvidence/ExecutionEvidenceVerifier/ExecutionEvidenceVerifier.test.ts`

---

### Task 1S: LastResponseCache (1 contract)

| Contract          | Event       | Recipes | Notes         |
| ----------------- | ----------- | ------- | ------------- |
| LastResponseCache | PostToolUse | R8      | Async, silent |

**Files:**

- `hooks/LastResponseCache/LastResponseCache/LastResponseCache.contract.ts`

---

### Task 1T: QuestionAnswered (1 contract)

| Contract         | Event       | Recipes | Notes         |
| ---------------- | ----------- | ------- | ------------- |
| QuestionAnswered | PostToolUse | R8      | Async, silent |

**Files:**

- `hooks/QuestionAnswered/QuestionAnswered/QuestionAnswered.contract.ts`

---

### Task 1U: SkillGuard (1 contract)

| Contract   | Event      | Recipes | Notes             |
| ---------- | ---------- | ------- | ----------------- |
| SkillGuard | PreToolUse | R1, R4  | Continue or block |

**Files:**

- `hooks/SkillGuard/SkillGuard/SkillGuard.contract.ts`

---

### Task 1V: StopOrchestrator (1 contract)

| Contract         | Event | Recipes | Notes         |
| ---------------- | ----- | ------- | ------------- |
| StopOrchestrator | Stop  | R8      | Async, silent |

**Files:**

- `hooks/StopOrchestrator/StopOrchestrator/StopOrchestrator.contract.ts`

---

### Task 1W: VoiceGate (1 contract)

| Contract  | Event      | Recipes | Notes             |
| --------- | ---------- | ------- | ----------------- |
| VoiceGate | PreToolUse | R1, R4  | Continue or block |

**Files:**

- `hooks/VoiceGate/VoiceGate/VoiceGate.contract.ts`

---

### Task 1X: WikiPipeline (3 contracts)

| Contract            | Event            | Recipes | Notes                 |
| ------------------- | ---------------- | ------- | --------------------- |
| WikiContextInjector | UserPromptSubmit | R1, R2  | Continue with context |
| WikiIngest          | PostToolUse      | R8      | Async, silent         |
| WikiReadTracker     | PostToolUse      | R1, R2  | Continue with context |

**Files:**

- `hooks/WikiPipeline/WikiContextInjector/WikiContextInjector.contract.ts`
- `hooks/WikiPipeline/WikiIngest/WikiIngest.contract.ts`
- `hooks/WikiPipeline/WikiReadTracker/WikiReadTracker.contract.ts`

---

## Phase 2: Cleanup (Sequential — after all Phase 1 complete)

### Task 2A: Delete old type files

**Files:**

- Delete: `core/types/hook-outputs.ts`
- Delete: `core/types/hook-outputs.test.ts`

**Step 1: Verify no remaining imports**

Run: `cd /Users/hogers/.claude/pai-hooks && grep -r "hook-outputs" --include="*.ts" | grep -v node_modules | grep -v "docs/plans"`
Expected: No results (all imports migrated in Phase 1).

**Step 2: Delete files**

```bash
rm core/types/hook-outputs.ts core/types/hook-outputs.test.ts
```

**Step 3: Commit**

```bash
git add -A core/types/hook-outputs.ts core/types/hook-outputs.test.ts
git commit -m "cleanup: delete hook-outputs.ts — replaced by SDK SyncHookJSONOutput"
```

---

### Task 2B: Full verification

**Step 1: Type check entire project**

Run: `cd /Users/hogers/.claude/pai-hooks && npx tsc --noEmit`
Expected: Zero errors.

**Step 2: Run full test suite**

Run: `cd /Users/hogers/.claude/pai-hooks && bun test`
Expected: All tests pass.

**Step 3: Commit any remaining fixes**

---

### Task 2C: Update documentation

**Files:**

- `core/types/doc.md` (if exists)
- `core/README.md` (if exists)

Update any docs that reference the old type system (`HookOutput`, `ContinueOutput`, `BlockOutput`, `AskOutput`, `ContextOutput`, `SilentOutput`, `UpdatedInputOutput`, `continueOk()`, `block()`, `ask()`, `context()`, `silent()`, `updatedInput()`).

---

### Task 2D: Update unactioned plans

These existing plans reference old types and should be updated:

| Plan                                             | References to update                     |
| ------------------------------------------------ | ---------------------------------------- |
| `2026-04-09-hook-output-compression-plan.md`     | `continueOk`, `HookOutput`               |
| `2026-04-09-steering-rule-injector-plan.md`      | `ContinueOutput`, `hook-outputs` imports |
| `2026-04-06-pattern-detection-implementation.md` | `continueOk`, `hook-outputs`             |
| `2026-04-06-hookdoc-multi-doc-implementation.md` | `hook-outputs` imports                   |
| `2026-04-06-doc-commit-guard-implementation.md`  | `continueOk`, `hook-outputs`             |

For each: replace old type references with SDK types using the recipe reference above.

---

## Verification Checklist

After all phases complete:

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `bun test` passes all tests
- [ ] `grep -r "hook-outputs" --include="*.ts" | grep -v node_modules | grep -v docs/plans` returns nothing
- [ ] `grep -r "continueOk\|type.*ContinueOutput\|type.*BlockOutput\|type.*AskOutput\|type.*ContextOutput\|type.*SilentOutput\|type.*UpdatedInputOutput\|type.*HookOutput" --include="*.ts" | grep -v node_modules | grep -v docs/plans` returns nothing
- [ ] PreCompactStatePersist hook runs without validation errors (trigger: `/compact`)
- [ ] One full work session with zero hook errors in `MEMORY/STATE/logs/hook-log-*.jsonl`
