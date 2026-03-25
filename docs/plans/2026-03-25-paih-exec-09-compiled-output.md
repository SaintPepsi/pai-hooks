# Issue #9 — Compiled Output Modes

**Issue:** [#9](https://github.com/SaintPepsi/pai-hooks/issues/9)
**Wave:** 4 (parallel with #8, #10)
**Depends on:** #7 (install pipeline to extend)

## Team Composition

| Agent | Name | Model | Responsibility |
|-------|------|-------|---------------|
| Lead | `compiler-architect` | Opus | Design compiler.ts — strategy interface, stdin adapter swap, shebang/chmod |
| Agent 2 | `node-engineer` | Opus | Build + test `--compiled` path under actual Node |
| Agent 3 | `bun-engineer` | Opus | Build + test `--compiled-ts` path under Bun |

## Context Each Agent Needs

All agents need:
- Design doc: [`docs/plans/2026-03-25-paih-cli-design.md`](2026-03-25-paih-cli-design.md) (output modes section)
- Install pipeline from #7: `cli/commands/install.ts`, `cli/core/staging.ts`
- Lockfile types from #7: `cli/types/lockfile.ts` (outputMode field)
- Existing stdin adapter: [`core/adapters/stdin.ts`](/core/adapters/stdin.ts) (uses `Bun.stdin`)
- Brainstorm consensus: [Issue #9 comment](https://github.com/SaintPepsi/pai-hooks/issues/9#issuecomment-4122379588)

Agent-specific context:
- `compiler-architect`: needs to understand how [`core/adapters/stdin.ts`](/core/adapters/stdin.ts) uses `Bun.stdin.stream()` to design the Node shim
- `node-engineer`: needs Node >= 20 installed for runtime testing
- `bun-engineer`: needs current Bun for runtime testing

## Execution Phases

### Phase 1 — Compiler Design (compiler-architect, solo)

**Duration:** ~10 min

```
Tasks:
├── Read core/adapters/stdin.ts to understand Bun.stdin.stream() usage
├── Design cli/core/compiler.ts interface:
│   ├── compileHook(hookPath: string, mode: "compiled" | "compiled-ts", deps: CompilerDeps):
│   │   Promise<Result<CompiledMeta, PaihError>>
│   ├── CompiledMeta: { outputPath, outputMode, shebang, size }
│   └── CompilerDeps: extends base Deps with exec for bun build
│
├── Design stdin adapter substitution for Node target:
│   ├── Problem: Bun.stdin.stream() throws under Node — no equivalent API
│   ├── Solution: Build a Node-compatible stdin shim at cli/core/node-stdin-shim.ts
│   │   └── Uses process.stdin (Node built-in) to replicate readStdin behavior
│   ├── Compiler swaps the import at build time:
│   │   └── bun build --external ./core/adapters/stdin --define approach
│   │       OR: pre-process the entry file to swap the import before building
│   └── Document the chosen approach in code comments
│
├── Design build pipeline per mode:
│   ├── --compiled:
│   │   1. Swap stdin adapter import → node-stdin-shim
│   │   2. bun build --target=node --bundle --format=esm --outfile=<temp>
│   │   3. Read temp output
│   │   4. Prepend shebang: #!/usr/bin/env node
│   │   5. Write to final path (atomic: temp → rename)
│   │   6. chmod 0o755
│   │
│   └── --compiled-ts:
│       1. bun build --bundle --format=esm --outfile=<temp>
│       2. Read temp output
│       3. Prepend shebang: #!/usr/bin/env bun
│       4. Rename to .ts extension (output is bundled JS, NOT TypeScript source)
│       5. Write to final path (atomic)
│       6. chmod 0o755
│
├── Ensure process.env is NOT inlined at build time:
│   └── Verify bun build default does not inline (it doesn't — confirm with test)
│
├── Add BUILD_FAILED to PaihErrorCode if not already present (from #6)
├── Write cli/core/node-stdin-shim.ts
├── Write cli/core/compiler.ts skeleton
└── Commit design + skeleton + shim
```

**Deliverable:** Compiler interface defined. stdin shim written. Build pipeline documented.

### Phase 2 — Parallel Implementation (node-engineer + bun-engineer)

**Duration:** ~15 min (parallel)

#### node-engineer

```
Tasks:
├── Implement --compiled path in compiler.ts:
│   ├── stdin adapter substitution (using architect's shim)
│   ├── bun build --target=node --bundle --format=esm
│   ├── Shebang prepend: #!/usr/bin/env node
│   ├── chmod 0o755
│   └── Atomic write (temp → rename)
│
├── Build settings registration for compiled hooks:
│   ├── Command format: direct path (relies on shebang), NOT "bun run <path>"
│   │   └── e.g., ./.claude/hooks/TypeStrictness.js
│   └── Update cli/core/settings.ts to handle compiled command format
│
├── Write tests (must run under actual node, not bun):
│   ├── Compile a real hook (e.g., DestructiveDeleteGuard — simple deps)
│   ├── Execute compiled .js under node: verify it runs without error
│   ├── stdin round-trip: pipe test input → verify expected output
│   │   └── Must run under node explicitly: child_process.execSync("node compiled.js")
│   ├── process.env accessible at runtime (not inlined)
│   ├── No Bun.* globals in compiled output (grep the output file)
│   ├── Native addon dep → BUILD_FAILED error (if applicable)
│   └── Verify chmod: file has execute permission after compile
│
└── Commit --compiled implementation + tests
```

#### bun-engineer

```
Tasks:
├── Implement --compiled-ts path in compiler.ts:
│   ├── bun build --bundle --format=esm
│   ├── Rename output to .ts extension
│   ├── Shebang prepend: #!/usr/bin/env bun
│   ├── chmod 0o755
│   └── Atomic write
│
├── Build settings registration for --compiled-ts:
│   ├── Command format: bun <relative-path>
│   │   └── e.g., bun ./.claude/hooks/TypeStrictness.ts
│   └── Update settings.ts if needed
│
├── Update lockfile outputMode to typed enum:
│   ├── Edit cli/types/lockfile.ts: outputMode: "source" | "compiled" | "compiled-ts"
│   └── Backward compat: existing lockfiles without outputMode default to "source"
│
├── Write tests:
│   ├── Compile a real hook → .ts file produced
│   ├── Execute under bun directly: verify it runs
│   ├── stdin round-trip under bun
│   ├── process.env accessible at runtime
│   ├── Verify chmod: execute permission set
│   └── Verify .ts output is NOT valid TypeScript (it's bundled JS — tsc would fail on it)
│
└── Commit --compiled-ts implementation + tests
```

### Phase 3 — Integration (all three agents)

**Duration:** ~8 min

```
Tasks:
├── Wire compiler into install pipeline:
│   ├── install.ts checks for --compiled or --compiled-ts flag
│   ├── If present: call compiler.ts instead of copy pipeline
│   ├── Settings registration uses correct format per mode
│   └── Lockfile records outputMode per hook
│
├── Test mode change:
│   ├── Install in source mode, then re-install with --compiled → requires --force
│   └── Warning message about mode change
│
├── Verify shared.ts statelessness concern:
│   └── Document: shared.ts gets inlined N times in compiled mode.
│       If shared.ts has mutable module-level state, behavior diverges.
│       Flag for paih verify to check (future work).
│
├── Verify tsc --noEmit does NOT cover compiled output:
│   └── tsconfig excludes the compiled output directory
│
├── bun test (all tests green — both node and bun execution tests)
├── tsc --noEmit (compiles clean on source, ignores compiled output)
└── PR ready
```

**Gate:** Compiled .js executes under node. Compiled .ts executes under bun. stdin works in both. Mode change requires --force.

## Acceptance Criteria (from brainstorm consensus)

- [ ] `--compiled` produces single `.js` via `bun build --target=node`
- [ ] `--compiled-ts` produces bundled JS with `.ts` extension (documented as JS wrapper)
- [ ] Shebangs: `#!/usr/bin/env node` and `#!/usr/bin/env bun` respectively
- [ ] `chmod +x` (0o755) set by compiler step
- [ ] Atomic writes (temp → rename)
- [ ] `--compiled` substitutes Node-compatible stdin reader (no `Bun.*` globals)
- [ ] `process.env` NOT inlined at build time
- [ ] Compiled `.js` tested under actual `node` (>= 20) in CI
- [ ] stdin round-trip verified under `node`
- [ ] Compiled `.ts` tested under `bun`
- [ ] Settings: compiled hooks use relative paths, correct command format per mode
- [ ] Lockfile `outputMode` typed as `"source" | "compiled" | "compiled-ts"`
- [ ] Old lockfiles without `outputMode` default to `"source"`
- [ ] Mode change requires `--force`
- [ ] `BUILD_FAILED` error code for build failures
- [ ] `tsc` excludes compiled output directory
- [ ] `bun test` passes

## Open Question

Consider renaming `--compiled-ts` to `--compiled-bun` since the output is bundled JS, not TypeScript. This affects lockfile values, docs, and user expectations. Decision should be made before implementation starts.

## Anti-Criteria

- No source maps for compiled output
- No hot-reload or watch mode
- No cross-compilation guarantees (compile on Mac, run on Linux)
- No type-checking of compiled output
- No bundling of hooks with dynamic computed imports (fail explicitly)
