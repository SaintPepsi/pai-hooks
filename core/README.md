# Core Infrastructure

Shared types, patterns, and adapters for the PAI hook system.

## Contract Types (`contract.ts`)

Three exported types for hook contracts:

| Type | `execute()` returns | Use when |
|------|-------------------|----------|
| `SyncHookContract<I,D>` | `Result<SyncHookJSONOutput, ResultError>` | Most hooks (34 of 40) |
| `AsyncHookContract<I,D>` | `Promise<Result<SyncHookJSONOutput, ResultError>>` | Hooks with async I/O (6 hooks) |
| `HookContract<I,D>` | Union of both | Runner only — contracts should use the narrowed type |

All three share a common base: `name`, `event`, `accepts()`, `defaultDeps`.

The output type is always `SyncHookJSONOutput` from `@anthropic-ai/claude-agent-sdk` — no custom output types. The previous `O` generic parameter was dropped in the SDK type foundation refactor; contracts construct SDK-shaped return values directly.

The `event` field accepts `HookEventType | HookEventType[]` — multi-event hooks declare an array (e.g., `event: ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart", "PreCompact", "Stop"]`). The runner resolves the actual event from the input shape for logging and output formatting.

## Barrel Exports (`index.ts`)

The barrel re-exports SDK types and validation directly rather than wrapping them: `SyncHookJSONOutput` from `@anthropic-ai/claude-agent-sdk`, the `HookSpecificEventName` / `NonHookSpecificEvent` type aliases from `types/hook-output-helpers.ts`, and `validateHookOutput` from `types/hook-output-schema.ts`. Contracts that want SDK types can import from `@hooks/core` and get SDK shapes directly — no translation layer.

## Result Pattern (`result.ts`)

`Result<T, E>` (Ok | Err) replaces try/catch in business logic. Constructors: `ok()`, `err()`. Combinators: `andThen`, `map`, `mapError`, `match`, `unwrapOr`. Collection ops: `collectResults`, `partitionResults`. Bridge functions (`tryCatch`, `tryCatchAsync`) exist only for adapter boundaries.

## Error Types (`error.ts`)

`ResultError` type with `ErrorCode` enum. Factory functions: `fileNotFound`, `fileReadFailed`, `fileWriteFailed`, `jsonParseFailed`, etc.

## Runner (`runner.ts`)

`runHook(contract)` — full pipeline: stdin → parse → accepts → dedup → execute → validate → serialize → exit.
`runHookWith(contract, input)` — pre-built input, skips stdin.

Both accept `HookContract<I, D>` (the 2-generic union) and normalize sync/async via `await Promise.resolve()`. Contracts return `SyncHookJSONOutput` from `@anthropic-ai/claude-agent-sdk` directly — the runner calls `validateHookOutput()` from `types/hook-output-schema.ts` and `JSON.stringify`s the result without any mapping layer. An empty object `{}` serializes to silent (no write). If validation fails, the runner writes `{ continue: true }` as a fail-open safety net rather than crashing. Both include a dedup guard after `accepts()` that prevents the same hook from firing twice when registered at both global and project config levels. Running dedup after accepts avoids creating lock files for hooks that don't apply to the input.

Multi-event contracts (e.g., SteeringRuleInjector handling 7 events) receive different input shapes per event. The runner determines whether the current input is a tool event after parsing, and uses this to decide the safe-exit output format (`{"continue":true}` for tool events, empty for others). The `resolveEvent()` function uses the Effect Schema from `types/hook-input-schema.ts` to discriminate on the `hook_type` field — no field-sniffing or type casts.

`RunHookOptions` allows overriding stdout, stderr, exit, log, and `isDuplicate` for testing.

## Dedup Guard (`dedup.ts`)

Prevents duplicate hook firing when the same hook is registered at both global (`~/.claude/settings.json`) and project (`.claude/settings.json`) levels. Uses atomic file creation (`O_EXCL`) in `/tmp/pai-dedup/{sessionId}/` so concurrent processes race safely — first writer proceeds, second exits silently.

Exports: `isDuplicate(hookName, sessionId, input, deps?)`, `stableHash(hookName, input)`, `DedupDeps` interface, `defaultDedupDeps()` (factory function).

## Adapters (`adapters/`)

Boundary layer wrapping Node builtins in `Result`:
- `fs.ts` — readFile, writeFile, writeFileExclusive, readJson, writeJson, fileExists, stat, etc.
- `process.ts` — exec, execSyncSafe, spawnBackground
- `stdin.ts` — readStdin with timeout
- `log.ts` — appendHookLog for structured hook logging

## Quality Scorer (`quality-scorer.ts`)

SOLID heuristic analysis for source files. `scoreFile(content, profile, filePath)` returns a composite score (0-10) with per-check breakdown across 18 checks in 3 categories:

- **SRP** (4): function-count, naming-clusters, mixed-io-patterns, section-headers, try-catch-count
- **DIP** (8): import-depth, infra-imports, type-import-ratio, missing-deps-interface, contract-pattern, adapter-bypass, throw-count, null-return-count, mixed-error-strategy
- **ISP** (3): interface-members, parameter-count, options-object-width

Contract-specific checks (missing-deps-interface, contract-pattern, adapter-bypass, throw-count, mixed-error-strategy) only fire on files in `/contracts/` and skip test files (`.test.`/`.spec.`). Language profiles from `language-profiles.ts` provide per-language regex patterns.

## Types (`types/`)

- `hook-inputs.ts` — ToolHookInput, SessionStartInput, UserPromptSubmitInput, SubagentStartInput, SubagentStopInput, etc.
- `hook-input-schema.ts` — Effect Schema discriminated union for validated input parsing
- `hook-outputs.ts` — ContinueOutput, BlockOutput, ContextOutput, UpdatedInputOutput, SilentOutput, AskOutput
- `hook-output-schema.ts` — Effect Schema for Claude Code's output validation. Encodes the `hookSpecificOutput` discriminated union and provides `encodeHookOutput()` for schema-validated encoding. Events without hookSpecificOutput support (PreCompact, Stop, etc.) fall back to `systemMessage`.

**Source of truth:** `@anthropic-ai/claude-agent-sdk` (v0.2.98+) exports all hook input/output types. See `types/doc.md` for the full hookSpecificOutput support matrix.
