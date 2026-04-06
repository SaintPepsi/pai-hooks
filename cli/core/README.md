# cli/core/

Core logic for the `paih` CLI. Business logic modules that power CLI commands.

## Modules

| Module | Purpose | Added in |
|--------|---------|----------|
| `validator.ts` | Bidirectional manifest validation (contract + hook shell imports vs declared deps) | #4, #12 |
| `error.ts` | `PaihErrorCode` enum + `PaihError` class + factory functions | #6 |
| `result.ts` | Re-exports `ok`, `err`, `Result` from `@hooks/core/result` | #6 |
| `pipe.ts` | `pipe()` combinator threading `Result` through steps, short-circuits on first Err | #6 |
| `args.ts` | CLI argument parser: commands, multi-name positionals, known/unknown flags, --preset value flag | #6, #14 |
| `target.ts` | `resolveTarget()` walks up from CWD to find nearest `.claude/` directory | #6 |
| `resolver.ts` | Resolve names to hooks (hook > group > preset priority, wildcard, cycle detection) | #6 |
| `deps.ts` | `dedup()` for hook deduplication by identity (name + sourceDir) | #6 |
| `settings.ts` | Append-only settings.json merge (`mergeHookEntry`, `unmergeHookEntry`, `detectForeignHooks`) | #7 |
| `staging.ts` | Atomic file staging via `.paih-staging/` directory (create, stage, commit, clean). Core deps staged to `pai-hooks/`. Command strings use `$CLAUDE_PROJECT_DIR` for stable path resolution across CWD changes | #7, #32 |
| `lockfile.ts` | Lockfile I/O at `.claude/hooks/pai-hooks/paih.lock.json` (`readLockfile`, `writeLockfile`, `addHookEntry`, `computeFileHash`) | #7 |
| `tsconfig-gen.ts` | Generate `tsconfig.json` inside `pai-hooks/` with `@hooks/*` → `./*` path aliases | #7 |
| `manifest-loader.ts` | Build `ManifestIndex` from source repo hook/group/preset files | #7 |
| `compiler.ts` | `compileHook()` for --compiled (Node) and --compiled-ts (Bun) output modes. `compiledCommandString()` formats hook paths for settings.json. Callers pass `$CLAUDE_PROJECT_DIR`-prefixed paths for worktree compatibility (#32). Uses --tsconfig-override for path alias resolution and stdin shim substitution. CompilerDeps = CliDeps (no extra methods) | #9, #13, #32 |
| `node-stdin-shim.ts` | Node-compatible stdin adapter replacing `Bun.stdin` in compiled output | #9 |

## Patterns

All modules follow the project coding standards:
- Result pattern (`Result<T, E>`) for error handling, no try-catch in business logic
- DI via Deps interfaces for testability
- Adapters for all I/O (no raw Node builtins)
- `@hooks/*` path aliases
