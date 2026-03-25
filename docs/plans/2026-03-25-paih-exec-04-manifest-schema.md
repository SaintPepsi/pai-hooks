# Issue #4 — Manifest Schema + Validation

**Issue:** [#4](https://github.com/SaintPepsi/pai-hooks/issues/4)
**Wave:** 1 (no prerequisites)
**Blocks:** #5, #6

## Team Composition

| Agent | Name | Model | Responsibility |
|-------|------|-------|---------------|
| Lead | `schema-architect` | Opus | Design TypeScript interfaces, own schema decisions |
| Agent 2 | `validator-engineer` | Opus | Build bidirectional validation engine |
| Agent 3 | `fixture-engineer` | Opus | Hand-write diverse manifests, test against real hooks |

## Context Each Agent Needs

All agents need:
- Design doc: [`docs/plans/2026-03-25-paih-cli-design.md`](2026-03-25-paih-cli-design.md) (manifest format section)
- Existing types: [`core/types/hook-inputs.ts`](/core/types/hook-inputs.ts) (for `HookEventType`)
- Existing patterns: [`core/error.ts`](/core/error.ts), [`core/result.ts`](/core/result.ts) (for Result/PaiError patterns)
- Brainstorm consensus: [Issue #4 comment](https://github.com/SaintPepsi/pai-hooks/issues/4#issuecomment-4122371006)

Agent-specific context:
- `fixture-engineer` needs to read 5 real hook contracts to understand import patterns
- `validator-engineer` needs the interfaces from Phase 1 before starting

## Execution Phases

### Phase 1 — Schema Design (schema-architect, solo)

**Duration:** ~8 min

```
Tasks:
├── Read 5-6 real hook contracts to understand import surface:
│   ├── hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.contract.ts (simple, few deps)
│   ├── hooks/AlgorithmTracking/AlgorithmTracker/AlgorithmTracker.contract.ts (many lib deps)
│   ├── hooks/CronStatusLine/CronFire/CronFire.contract.ts (uses shared.ts)
│   ├── hooks/VoiceGate/*/VoiceGate.contract.ts (uses fetch adapter)
│   └── hooks/ObligationStateMachines/CitationEnforcement/CitationEnforcement.contract.ts (multiple shared files)
├── Read core/types/hook-inputs.ts for HookEventType definition
├── Design interfaces:
│   ├── HookManifest: name, group, event (HookEventType enum), description, schemaVersion,
│   │   deps: { core: string[], lib: string[], adapters: string[], shared: string[] | false }
│   │   tags: string[], presets: string[]
│   ├── GroupManifest: name, description, hooks: string[] (alphabetical), sharedFiles: string[]
│   └── PresetConfig: { [presetName]: { description, hooks?, groups?, includeAll?: boolean } }
├── Write cli/types/manifest.ts
└── Commit interfaces
```

**Deliverable:** `cli/types/manifest.ts` committed. All downstream agents can import from it.

**Gate:** Interfaces compile (`tsc --noEmit` passes on the new file).

### Phase 2 — Parallel Work (validator-engineer + fixture-engineer)

**Duration:** ~12 min (parallel)

#### validator-engineer

```
Tasks:
├── Build validator at cli/core/validator.ts (or cli/validator.ts — decide location)
├── Validator signature: validate(hookPath, manifestPath, deps): Result<ValidationReport, PaiError>
├── Implement bidirectional checks:
│   ├── Parse actual imports via regex on contract file
│   │   Pattern: import statements matching @hooks/core/*, @hooks/lib/*, ../shared
│   ├── Compare declared deps (from hook.json) against actual imports
│   ├── MANIFEST_MISSING_DEP: imported but not declared
│   ├── MANIFEST_GHOST_DEP: declared but not imported
│   └── Exclude type-only imports (import type { ... })
├── Implement shared.ts disk-existence check:
│   └── If deps.shared contains filenames, verify each exists at hooks/{Group}/*.shared.ts
├── Scope rule: only @hooks/core/* and @hooks/lib/* count as deps
│   └── Sibling hook imports (in tests) explicitly ignored — document this
├── Write unit tests with fixture files in test-fixtures/manifests/:
│   ├── Valid manifest → passes
│   ├── Missing dep → MANIFEST_MISSING_DEP error
│   ├── Ghost dep → MANIFEST_GHOST_DEP error
│   ├── shared:["foo.shared.ts"] with no foo.shared.ts on disk → error
│   └── Type-only import → not counted as dep
└── Commit validator + tests
```

**Deliverable:** Validator passes all unit tests.

#### fixture-engineer

```
Tasks:
├── Select 5 hooks covering diversity suite:
│   ├── Zero-lib deps: hooks/GitSafety/DestructiveDeleteGuard/
│   ├── Multi-lib deps: hooks/AlgorithmTracking/AlgorithmTracker/ (5+ lib imports)
│   ├── shared.ts user: hooks/CronStatusLine/CronFire/ (single shared.ts)
│   ├── Non-fs adapter: hooks/VoiceGate/ (uses fetch adapter) or similar
│   └── Multiple shared files: hooks/ObligationStateMachines/CitationEnforcement/
├── Hand-write hook.json for each (adjacent to hook directory):
│   └── Follow HookManifest interface exactly, populate all fields
├── Hand-write one group.json: hooks/CodingStandards/group.json
│   └── hooks array alphabetically sorted
├── Hand-write presets.json at repo root:
│   └── Stub with minimal/quality/full skeletons (hooks lists can be partial)
└── Commit all manifest files
```

**Deliverable:** 5 `hook.json` + 1 `group.json` + 1 `presets.json` committed.

### Phase 3 — Integration (all three agents)

**Duration:** ~5 min

```
Tasks:
├── Run validator against hand-written manifests + real hook contracts
├── Fix any schema gaps discovered (interfaces or manifests)
├── Write integration test: test-fixtures/manifests/integration.test.ts
│   └── Validates all 5 hand-written manifests pass bidirectional check
├── bun test (all tests green)
├── tsc --noEmit (compiles clean)
└── PR ready
```

**Gate:** All tests pass. All hand-written manifests validate bidirectionally.

## Acceptance Criteria (from brainstorm consensus)

- [ ] TypeScript interfaces in `cli/types/manifest.ts` with `schemaVersion`, `HookEventType` enum, `string[]` for lib deps, `string[] | false` for shared
- [ ] `GroupManifest` models shared.ts contributions explicitly
- [ ] `PresetConfig` handles `"*"` wildcard explicitly
- [ ] Bidirectional validator with `MANIFEST_GHOST_DEP` and `MANIFEST_MISSING_DEP` error codes
- [ ] `shared` validated against actual files on disk
- [ ] Only `@hooks/core/*` and `@hooks/lib/*` imports count as deps
- [ ] 5 hand-written manifests covering: zero-lib, multi-lib, shared:true, non-fs adapter, multiple shared files
- [ ] 1 hand-written `group.json`, 1 `presets.json`
- [ ] Validator returns `Result<ValidationReport, PaiError>`
- [ ] Unit tests with fixtures + integration test against real hooks
- [ ] `bun test` passes
- [ ] `npx tsc --noEmit` passes

## Anti-Criteria

- AST walking deferred to follow-on (regex sufficient for v1)
- Cross-hook dependencies out of scope
- Dynamic imports out of scope (documented limitation)
- Validator NOT wired into pre-commit in this issue
