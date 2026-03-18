# Core Infrastructure

Shared types, patterns, and adapters for the PAI hook system.

## Contract Types (`contract.ts`)

Three exported types for hook contracts:

| Type | `execute()` returns | Use when |
|------|-------------------|----------|
| `SyncHookContract<I,O,D>` | `Result<O, PaiError>` | Most hooks (34 of 40) |
| `AsyncHookContract<I,O,D>` | `Promise<Result<O, PaiError>>` | Hooks with async I/O (6 hooks) |
| `HookContract<I,O,D>` | Union of both | Runner only — contracts should use the narrowed type |

All three share a common base: `name`, `event`, `accepts()`, `defaultDeps`.

## Result Pattern (`result.ts`)

`Result<T, E>` (Ok | Err) replaces try/catch in business logic. Constructors: `ok()`, `err()`. Combinators: `andThen`, `map`, `mapError`, `match`, `unwrapOr`. Collection ops: `collectResults`, `partitionResults`. Bridge functions (`tryCatch`, `tryCatchAsync`) exist only for adapter boundaries.

## Error Types (`error.ts`)

`PaiError` with `ErrorCode` enum. Factory functions: `fileNotFound`, `fileReadFailed`, `fileWriteFailed`, `jsonParseFailed`, etc.

## Runner (`runner.ts`)

`runHook(contract)` — full pipeline: stdin, parse, accepts, execute, format, exit.
`runHookWith(contract, input)` — pre-built input, skips stdin.

Both accept `HookContract` (the union) and normalize sync/async via `await Promise.resolve()`.

## Adapters (`adapters/`)

Boundary layer wrapping Node builtins in `Result`:
- `fs.ts` — readFile, writeFile, readJson, writeJson, fileExists, stat, etc.
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

- `hook-inputs.ts` — ToolHookInput, SessionStartInput, UserPromptSubmitInput, etc.
- `hook-outputs.ts` — ContinueOutput, BlockOutput, ContextOutput, SilentOutput, AskOutput
