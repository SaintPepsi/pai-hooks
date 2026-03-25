# Issue #6 — CLI Core Infrastructure + Resolver Engine

**Issue:** [#6](https://github.com/SaintPepsi/pai-hooks/issues/6)
**Wave:** 2 (parallel with #5)
**Depends on:** #4 (manifest interfaces)
**Blocks:** #7, #8, #9, #10

## Team Composition

| Agent | Name | Model | Responsibility |
|-------|------|-------|---------------|
| Lead | `cli-architect` | Opus | Entry point, arg parsing, exit codes, pipe(), error types |
| Agent 2 | `resolver-engineer` | Opus | Resolver logic, cycle detection, wildcard expansion |
| Agent 3 | `adapter-engineer` | Opus | `cli/adapters/`, Deps interfaces, test doubles |

## Context Each Agent Needs

All agents need:
- Design doc: [`docs/plans/2026-03-25-paih-cli-design.md`](2026-03-25-paih-cli-design.md) (CLI architecture section)
- Manifest interfaces from #4: `cli/types/manifest.ts`
- Existing Result/error patterns: [`core/result.ts`](/core/result.ts), [`core/error.ts`](/core/error.ts)
- Brainstorm consensus: [Issue #6 comment](https://github.com/SaintPepsi/pai-hooks/issues/6#issuecomment-4122373030)

Agent-specific context:
- `resolver-engineer`: design doc "Selection Resolution" section (hook → group → preset order)
- `adapter-engineer`: existing adapters at [`core/adapters/`](/core/adapters/) for pattern reference

## Execution Phases

### Phase 1 — Foundation (cli-architect, solo)

**Duration:** ~10 min

```
Tasks:
├── Create directory structure:
│   └── cli/{bin,commands,core,adapters,types}/
├── Build cli/core/error.ts:
│   ├── PaihErrorCode enum with ALL codes needed by current + downstream issues:
│   │   TARGET_NOT_FOUND, HOOK_NOT_FOUND, MANIFEST_MISSING, MANIFEST_PARSE_ERROR,
│   │   MANIFEST_SCHEMA_INVALID, DEP_CYCLE, INVALID_ARGS, BUILD_FAILED,
│   │   SETTINGS_CONFLICT, WRITE_FAILED, LOCK_CORRUPT
│   └── PaihError class with code, message, context fields
├── Build cli/core/result.ts:
│   └── Reuse ok(), err(), Result<T, E> from core/result.ts (import or copy)
├── Build cli/core/pipe.ts:
│   ├── pipe<T, E>(...fns) threading Result<T, E> through steps
│   ├── Short-circuits on first Err
│   └── Unit tests: success chain, early-exit on first error, error passthrough
├── Build cli/core/args.ts:
│   ├── ParsedArgs type: { command: string, names: string[], flags: Record<string, boolean|string> }
│   ├── Parse --help, --version, --to/--from/--in, --force, --dry-run, --json
│   ├── Unknown flags → Err(PaihError(INVALID_ARGS))
│   └── Multi-name support: "paih install A B C" → names: ["A", "B", "C"]
├── Build cli/types/:
│   ├── ParsedArgs (from args.ts)
│   ├── HookDef (resolved hook with manifest + file paths)
│   └── ResolvedHooks (result of resolver: HookDef[] + dep tree)
├── Build cli/bin/paih.ts:
│   ├── Entry point, reads args via args.ts
│   ├── --help → print usage to stdout, exit 0
│   ├── --version → print version from package.json, exit 0
│   ├── No args → print usage to stderr, exit 1
│   ├── Unknown command → "Unknown command: X" to stderr, exit 1
│   ├── Result → exit code mapping: Ok → 0, user error → 1, internal error → 2
│   └── Subcommand routing shell (delegates to cli/commands/*.ts — stubs for now)
└── Commit all foundation files
```

**Deliverable:** `paih` binary runs, shows help, handles flags. All types and error codes defined.

**Gate:** `paih --help` exits 0, `paih --version` exits 0, `paih` exits 1, `paih bogus` exits 1.

### Phase 2 — Parallel Work (resolver-engineer + adapter-engineer)

**Duration:** ~12 min (parallel)

#### resolver-engineer

```
Tasks:
├── Build cli/core/target.ts:
│   ├── resolveTarget(startDir?: string): Result<string, PaihError>
│   ├── Walk up from startDir (default: process.cwd()) to filesystem root
│   ├── Look for directory containing .claude/
│   ├── No .claude/ found → Err(TARGET_NOT_FOUND) with path chain walked
│   └── Injectable startDir enables testing without real filesystem
├── Build cli/core/resolver.ts:
│   ├── resolve(names: string[], manifests: ManifestIndex): Result<ResolvedHooks, PaihError>
│   ├── Resolution order per name (from design doc "Selection Resolution" section):
│   │   1. Hook name match → single hook
│   │   2. Group name match → all hooks in group
│   │   3. Preset name match → all hooks in preset
│   │   Hook wins on collision — documented in code comment
│   ├── Wildcard expansion: groups: ["*"] → all groups
│   ├── Multi-name: resolve each independently, union results, deduplicate
│   ├── Missing name → Err(HOOK_NOT_FOUND) naming the identifier
│   ├── Preset referencing nonexistent group → Err(HOOK_NOT_FOUND) naming the group
│   └── Dependency cycle → Err(DEP_CYCLE) listing the cycle path
├── Build cli/core/deps.ts:
│   ├── dedup(hooks: HookDef[]): HookDef[]
│   ├── By hook identity (name + source path), not content
│   ├── First-seen-wins ordering (stable)
│   └── Empty input → empty output, no error
├── Write resolver test matrix (10 cases from brainstorm):
│   ├── Single hook by name
│   ├── Group expansion
│   ├── Preset expansion (direct hooks list)
│   ├── Preset expansion (via groups list)
│   ├── Wildcard groups: ["*"] expansion
│   ├── Ambiguous name (hook name = preset name) → hook wins
│   ├── Missing hook name
│   ├── Missing group in preset
│   ├── Dependency cycle detection
│   └── Multi-name union + dedup
└── Commit resolver + target + deps + tests
```

**Deliverable:** Resolver passes all 10 test cases.

#### adapter-engineer

```
Tasks:
├── Build cli/adapters/fs.ts:
│   ├── Result-wrapped: readFile, writeFile, fileExists, readDir, ensureDir, stat
│   ├── Each returns Result<T, PaihError> (never throws)
│   └── Pattern matches existing core/adapters/fs.ts
├── Build cli/adapters/process.ts:
│   ├── Result-wrapped: exec, cwd
│   └── Returns Result<string, PaihError>
├── Build Deps interface (cli/core/deps-interface.ts or in types/):
│   ├── All methods from fs.ts + process.ts adapters
│   ├── Narrow interface — only methods actually called by this issue's code
│   └── Reference: core/adapters/ for existing pattern
├── Build defaultDeps: Deps object wiring real adapters
├── Build test double: InMemoryDeps
│   ├── Constructor accepts virtual file tree: Record<string, string>
│   ├── All operations work against in-memory map
│   └── No real filesystem access in tests
├── Unit test adapters:
│   ├── readFile success → Ok with content
│   ├── readFile missing → Err with WRITE_FAILED
│   ├── fileExists true/false
│   └── exec success/failure
└── Commit adapters + Deps interface + test double + tests
```

**Deliverable:** Adapters, Deps interface, and InMemoryDeps test double ready for all downstream issues.

### Phase 3 — Integration (all three agents)

**Duration:** ~5 min

```
Tasks:
├── Wire resolver + adapters through pipe() in a smoke test:
│   └── pipe(parseArgs, resolveTarget, resolveHooks) with mock data
├── Verify tsc --noEmit covers cli/types/ (all exports reachable from tests)
├── bun test (all tests green)
├── tsc --noEmit (compiles clean)
└── PR ready
```

**Gate:** All resolver tests pass. Adapters tested. pipe() tested. Binary runs.

## Acceptance Criteria (from brainstorm consensus)

- [ ] `paih --help` exits 0, `paih --version` exits 0, `paih` (no args) exits 1
- [ ] Exit codes: 0 = success, 1 = user error, 2 = internal error
- [ ] Target resolution walks up to `.claude/`, injectable startDir for testing
- [ ] Resolver: hook → group → preset order, hook wins on collision
- [ ] Wildcard `"groups": ["*"]` expansion
- [ ] `DEP_CYCLE` error code with cycle path
- [ ] Multi-name args → union, deduplicated
- [ ] `pipe()` tested: success chain, short-circuit, error passthrough
- [ ] `PaihErrorCode` includes all codes for this + downstream issues
- [ ] `cli/adapters/fs.ts` tested with mocked Bun calls
- [ ] `InMemoryDeps` test double ships with this issue
- [ ] Dep deduplication: two hooks sharing a dep → one copy
- [ ] `tsc --noEmit` covers `cli/types/`
- [ ] `bun test` passes

## Anti-Criteria

- No command implementations — only routing shells in `cli/commands/`
- No `--dry-run` behavior — define the flag in args.ts but don't implement
- No speculative types for future issues — only what this issue's code consumes
