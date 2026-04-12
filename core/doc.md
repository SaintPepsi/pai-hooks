## Overview

`core/` is the pai-hooks foundation layer. Everything in this directory is pure logic — no I/O, no try/catch, no side effects. I/O and error recovery live in `core/adapters/` and `core/runner.ts`, which are the only boundary layers.

## Files

- **contract.ts** — `HookContract` / `SyncHookContract` / `AsyncHookContract` interfaces. Every hook implements one of these. Two generic parameters: `I` (input) and `D` (deps). Output is always `SyncHookJSONOutput` from `@anthropic-ai/claude-agent-sdk`.
- **runner.ts** — The shared pipeline (`runHook` / `runHookWith`): stdin → parse → accepts → dedup → execute → validate → serialize → exit. Handles all boundary errors; contracts never see uncaught exceptions.
- **result.ts** — `Result<T, E>` type + `ok` / `err` / `tryCatch` helpers. Railway-oriented error handling replacement for try/catch in business logic.
- **error.ts** — `ResultError` types and factory functions (`invalidInput`, `jsonParseFailed`, `securityBlock`, etc.).
- **dedup.ts** — Session-scoped deduplication guard (`isDuplicate`) used by the runner to skip re-processing of identical inputs.
- **quality-scorer.ts** — Static analysis helpers used by CodingStandards hooks. Not hot-path.
- **index.ts** — Barrel exports. Re-exports the SDK `SyncHookJSONOutput` and helper aliases so contracts can import from a single place.
- **types/** — Typed interfaces for hook events (input + output). See `core/types/doc.md` for details.
- **adapters/** — Impure wrappers for Node APIs (stdin, log, fs). Business logic imports adapters, never raw Node builtins.

## Type System

Contracts use narrowed types from `core/contract.ts`:

- `SyncHookContract<I, D>` — most hooks (execute returns `Result`)
- `AsyncHookContract<I, D>` — async hooks (execute returns `Promise<Result>`)
- `HookContract<I, D>` — union type, used by the runner for generic dispatch

All three return `SyncHookJSONOutput` from `@anthropic-ai/claude-agent-sdk` — the SDK is the source of truth for hook output shape.

## Coding Standards (enforced by CodingStandardsEnforcer)

- No raw Node builtins — use adapters from `core/adapters/` (`node:path` is exempt)
- No try-catch in business logic — use `Result<T, E>` pipelines
- No direct `process.env` outside `defaultDeps`
- Use `@hooks/*` path aliases, not relative imports
- Use `import type` for type-only imports
