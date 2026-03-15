# pai-hooks

PAI hook system — TypeScript contracts for Claude Code hooks.

## Key Rules

- **Commit changes when done.** Don't leave uncommitted work in this repo.
- Run `bun test` before committing to verify no regressions.
- Run `npx tsc --noEmit` to check for type errors.

## Type System

Contracts use narrowed types from `core/contract.ts`:
- `SyncHookContract<I, O, D>` — most hooks (execute returns `Result`)
- `AsyncHookContract<I, O, D>` — 6 async hooks (execute returns `Promise<Result>`)
- `HookContract<I, O, D>` — union type, used by the runner only

## Coding Standards

- No raw Node builtins — use adapters from `core/adapters/`
- No try-catch in business logic — use `Result<T, PaiError>` pipelines
- No direct `process.env` outside `defaultDeps`
- Use `@hooks/*` path aliases, not relative imports
- Use `import type` for type-only imports
