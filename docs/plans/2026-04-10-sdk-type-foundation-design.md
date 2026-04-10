# SDK Type Foundation — Design Document

**Date:** 2026-04-10
**Status:** Approved
**Trigger:** PreCompactStatePersist hook failing with `Hook JSON output validation failed: Invalid input`
**Scope:** Major refactor of pai-hooks to use `@anthropic-ai/claude-agent-sdk` as the single source of truth for all hook types

## Problem

Two bugs exposed a systemic issue:

1. **Invalid hookEventName** — `hookSpecificOutput` with `hookEventName: "PreCompact"` rejected because PreCompact is not in Claude Code's discriminated union
2. **Mismatched hookEventName** — Outputting `hookEventName: "PostToolUse"` from a SessionStart hook rejected with `Hook returned incorrect event name`

**Root cause:** pai-hooks defines its own input/output types manually. These diverge from what Claude Code actually validates. The runner's `formatOutput` function blindly stamps any event name into `hookSpecificOutput` without checking the validated union. The abstraction layer (`ContinueOutput`, `BlockOutput`, etc.) hid the wire format and prevented both humans and AI from seeing what Claude Code actually receives.

## Principle

**`@anthropic-ai/claude-agent-sdk` types are the source of truth. No parallel type definitions. No abstraction layers between contracts and the wire format.**

- SDK package: `@anthropic-ai/claude-agent-sdk@0.2.98+`
- Hooks reference: https://code.claude.com/docs/en/agent-sdk/hooks
- SDK reference: https://code.claude.com/docs/en/agent-sdk/typescript
- GitHub: https://github.com/anthropics/claude-agent-sdk-typescript

## Design Decisions

### 1. Contracts return `SyncHookJSONOutput` directly

No helper functions. No "business type" abstraction. Contracts build the exact SDK output object that Claude Code validates.

**Why:** AI agents writing hook contracts are ephemeral — they don't have full context of a custom type system. The SDK's `SyncHookJSONOutput` appears in Claude Code documentation that AI models are trained on. Custom helpers like `continueOk()` require discovering and reading source files the AI may not know exist. Raw SDK objects are self-documenting, greppable, and copy-paste friendly.

**Anti-rationalization check applied:** The previous helper abstraction was motivated reasoning (we built it, so we defended it) and substitution (optimizing for "less typing" when the real question is "what reduces errors for ephemeral AI?"). The abstraction itself caused the bug we're fixing.

### 2. Type aliases for compile-time safety

One type alias extracts valid `hookEventName` values from the SDK union:

```typescript
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

/** Event names that support hookSpecificOutput — derived from the SDK type */
type HookSpecificEventName = NonNullable<
  SyncHookJSONOutput["hookSpecificOutput"]
>["hookEventName"];
// → "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "UserPromptSubmit" | "SessionStart" | ...
```

TypeScript catches `hookEventName: "PreCompact"` at compile time — the exact bug that started this investigation.

### 3. Effect Schema as runtime safety net

Effect Schema validates the output against `SyncHookJSONOutput` before `JSON.stringify`. Built to match SDK types (not manual definitions). Falls back to `{ continue: true }` on validation failure (fail-open).

### 4. Input types from SDK

Replace all manually-defined input types with SDK imports. The SDK's `BaseHookInput` includes fields our manual types were missing: `cwd`, `transcript_path`, `agent_id`, `agent_type`, `permission_mode`.

## Claude Code's hookSpecificOutput Schema

From `SyncHookJSONOutput` in `@anthropic-ai/claude-agent-sdk/sdk.d.ts:4360-4369`:

### Events WITH hookSpecificOutput support

| hookEventName | Additional Fields | Source type |
|---|---|---|
| `PreToolUse` | `permissionDecision`, `permissionDecisionReason`, `updatedInput`, `additionalContext` | `PreToolUseHookSpecificOutput` |
| `PostToolUse` | `additionalContext`, `updatedMCPToolOutput` | `PostToolUseHookSpecificOutput` |
| `PostToolUseFailure` | `additionalContext` | `PostToolUseFailureHookSpecificOutput` |
| `UserPromptSubmit` | `additionalContext`, `sessionTitle` | `UserPromptSubmitHookSpecificOutput` |
| `SessionStart` | `additionalContext`, `initialUserMessage`, `watchPaths` | `SessionStartHookSpecificOutput` |
| `Setup` | `additionalContext` | `SetupHookSpecificOutput` |
| `SubagentStart` | `additionalContext` | `SubagentStartHookSpecificOutput` |
| `Notification` | `additionalContext` | `NotificationHookSpecificOutput` |
| `PermissionRequest` | `decision: { behavior: "allow" \| "deny", ... }` | `PermissionRequestHookSpecificOutput` |
| `PermissionDenied` | `retry` | `PermissionDeniedHookSpecificOutput` |
| `Elicitation` | `action`, `content` | `ElicitationHookSpecificOutput` |
| `ElicitationResult` | `action`, `content` | `ElicitationResultHookSpecificOutput` |
| `CwdChanged` | `watchPaths` | `CwdChangedHookSpecificOutput` |
| `FileChanged` | `watchPaths` | `FileChangedHookSpecificOutput` |
| `WorktreeCreate` | `worktreePath` | `WorktreeCreateHookSpecificOutput` |

### Events WITHOUT hookSpecificOutput support

PreCompact, PostCompact, SessionEnd, Stop, StopFailure, SubagentStop, TeammateIdle, TaskCreated, TaskCompleted, ConfigChange, WorktreeRemove, InstructionsLoaded.

These events can only use top-level fields: `continue`, `systemMessage`, `decision`, `reason`, etc.

### Top-level fields (all events)

From `SyncHookJSONOutput` — available regardless of event type:

```typescript
{
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: "approve" | "block";
  systemMessage?: string;
  reason?: string;
  hookSpecificOutput?: /* discriminated union above */;
}
```

## What a Contract Looks Like After

### Before (broken)

```typescript
import { continueOk } from "@hooks/core/types/hook-outputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";

// Contract returns our custom type. Runner maps it. Mapping breaks.
execute(): Result<ContinueOutput, ResultError> {
  return ok(continueOk(summary));
}
```

### After (correct)

```typescript
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

// Contract returns the exact SDK type. No mapping. What you see is what Claude Code gets.
execute(): Result<SyncHookJSONOutput, ResultError> {
  // For events WITH hookSpecificOutput:
  return ok({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: summary,
    },
  });

  // For events WITHOUT hookSpecificOutput (PreCompact, Stop, etc.):
  return ok({ continue: true, systemMessage: summary });

  // Simple continue:
  return ok({ continue: true });
}
```

## Files Changed

| File | Change |
|---|---|
| `core/types/hook-inputs.ts` | Replace manual types with re-exports from SDK |
| `core/types/hook-input-schema.ts` | Effect Schema validates SDK's `HookInput` type |
| `core/types/hook-outputs.ts` | **Delete** — replaced by direct use of `SyncHookJSONOutput` |
| `core/types/hook-output-helpers.ts` | **New** — type aliases only (no functions) |
| `core/types/hook-output-schema.ts` | Effect Schema built against SDK types for runtime validation |
| `core/contract.ts` | Contract output generic becomes `SyncHookJSONOutput` |
| `core/runner.ts` | Delete `formatOutput`. Runner calls `JSON.stringify(result.value)` with Effect Schema validation |
| `core/runner.test.ts` | Update test contracts to return `SyncHookJSONOutput` |
| **40+ hook contracts** | Change return type to `SyncHookJSONOutput`, build output objects directly |

## Impact Inventory

Exploration of the full codebase found **387 files** that reference types being replaced:

| Category | Count | What changes |
|---|---|---|
| Core infrastructure | 9 | Structural changes — contract.ts, runner.ts, hook-inputs.ts, hook-outputs.ts, hook-input-schema.ts |
| Contract files (`.contract.ts`) | 92 | Output type generic + factory function imports → SDK objects |
| Hook implementation files | 35 | Input/output type imports |
| Test files | 134 | Import updates + assertion updates against new output shapes |
| Library/utility files | 44 | Type reference updates |
| Script/CLI files | 15 | Import updates |
| Docs generator | 2 | Template type references |
| Handlers | 1 | AlgorithmEnrichment.ts |

### Files deleted entirely
- `core/types/hook-outputs.ts` — old business type definitions
- `core/types/hook-outputs.test.ts` — tests for deleted file

### Unactioned plans referencing old types

These existing plans use the old type system and need updating when executed:

| Plan | References |
|---|---|
| `2026-04-09-hook-output-compression-plan.md` | `continueOk`, `HookOutput` |
| `2026-04-09-steering-rule-injector-plan.md` | `ContinueOutput`, `hook-outputs` imports |
| `2026-04-06-pattern-detection-implementation.md` | `continueOk`, `hook-outputs` |
| `2026-04-06-hookdoc-multi-doc-implementation.md` | `hook-outputs` imports |
| `2026-04-06-doc-commit-guard-implementation.md` | `continueOk`, `hook-outputs` |
| `2026-04-10-hook-output-schema-design.md` | Superseded by this document |

These plans should reference SDK types when actioned. The `2026-04-10-hook-output-schema-design.md` is superseded by this document.

## Migration Strategy

### Phase 1: Foundation (non-breaking)
- Install SDK dependency (done: v0.2.98)
- Create type alias file `core/types/hook-output-helpers.ts` (type aliases only, no functions)
- Update `hook-output-schema.ts` — Effect Schema built against SDK types for runtime validation
- Update runner — replace `formatOutput` with direct serialization + schema validation

### Phase 2: Contract migration (breaking, incremental)
- Update `contract.ts` to accept `SyncHookJSONOutput` as output type
- Migrate contracts one group at a time, starting with WorkLifecycle (fixes PreCompactStatePersist)
- Each group: update contracts → run tests → verify → commit
- Priority order: WorkLifecycle (broken) → SecurityValidator → CodingStandards → GitSafety → remaining

### Phase 3: Input type migration
- Replace `hook-inputs.ts` with SDK re-exports
- Update `hook-input-schema.ts` Effect Schema to validate SDK's `HookInput`
- Update contracts to use SDK input types (`PreToolUseHookInput` instead of `ToolHookInput`, etc.)

### Phase 4: Cleanup
- Delete `hook-outputs.ts` and its test file
- Remove unused Effect Schema definitions superseded by SDK types
- Update all documentation (including `core/types/doc.md`, `core/README.md`)
- Update unactioned plans listed above to reference SDK types

## Dogfooding Strategy

The refactor's value is only proven when hooks actually run correctly in production. Dogfooding validates that the SDK types prevent the class of bugs that started this investigation.

### Phase 1: Validate the fix (immediate)
- After migrating PreCompactStatePersist, trigger `/compact` manually and verify no validation errors
- Check stderr for any `hook-output-schema` validation warnings
- Confirm the PRD context appears in the compaction summary (or `systemMessage` works)

### Phase 2: Canary contracts (during migration)
- Migrate 3-5 high-traffic hooks first: SteeringRuleInjector, CodingStandardsEnforcer, LoadContext, MapleBranding, SecurityValidator
- Run a full session with these migrated — verify all context injection, blocking, and tool modification works
- Check hook logs at `MEMORY/STATE/logs/hook-log-*.jsonl` for any `error` status entries

### Phase 3: Type safety regression test
- Add a compile-time test file that attempts invalid output constructions:
  ```typescript
  // This file should fail `tsc --noEmit` — verifies type safety
  const bad: SyncHookJSONOutput = {
    hookSpecificOutput: {
      hookEventName: "PreCompact",  // Should error: not in union
      additionalContext: "test",
    },
  };
  ```
- Add to CI: `tsc --noEmit` on the test file must fail. If it passes, the SDK types changed and we need to investigate.

### Phase 4: Full session burn-in
- After all contracts migrated, run 5+ full work sessions (not test sessions)
- Monitor hook log for:
  - Any `error` status entries (output validation failures)
  - Any hooks that silently fall back to `{ continue: true }` (schema safety net triggered)
  - Any Claude Code-side "Hook JSON output validation failed" errors
- Compare hook success rate before vs after migration

### Phase 5: SDK update protocol
- When `@anthropic-ai/claude-agent-sdk` releases a new version:
  1. Update the dependency
  2. Run `tsc --noEmit` — any type breakage surfaces immediately
  3. Check if new events were added to `hookSpecificOutput` union (expand our contracts if needed)
  4. Check if fields were added to existing `*HookSpecificOutput` types (adopt if useful)
  5. Run full test suite
  6. One burn-in session before committing

## Open Questions

1. **Does `systemMessage` work for PreCompact?** — Needs live testing in Phase 1 dogfooding. If not, PreCompact hooks must persist to file and inject via UserPromptSubmit.
2. **Effect Schema long-term** — Monitor during dogfooding whether runtime validation catches real bugs or just adds overhead. If no real catches after 20+ sessions, consider removing.
3. **SDK version pinning** — Use caret range (`^0.2.98`) but add the compile-time regression test to catch breaking changes early.
