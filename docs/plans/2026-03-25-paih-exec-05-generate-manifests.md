# Issue #5 — Generate Manifests for All Hooks

**Issue:** [#5](https://github.com/SaintPepsi/pai-hooks/issues/5)
**Wave:** 2 (parallel with #6)
**Depends on:** #4
**Blocks:** #7 (should land before full install testing)

## Team Composition

| Agent | Name | Model | Responsibility |
|-------|------|-------|---------------|
| Lead | `generator-engineer` | Opus | Build generator script with merge mode |
| Agent 2 | `ci-validator` | Opus | Build drift checker, verify idempotency |

## Context Each Agent Needs

All agents need:
- Merged output from #4: `cli/types/manifest.ts` (interfaces), `cli/core/validator.ts`
- Design doc: [`docs/plans/2026-03-25-paih-cli-design.md`](2026-03-25-paih-cli-design.md) (manifest format section)
- Brainstorm consensus: [Issue #5 comment](https://github.com/SaintPepsi/pai-hooks/issues/5#issuecomment-4122372063)
- Full hooks directory tree: `hooks/` (56 hooks, 19 groups)

## Execution Phases

### Phase 1 — Generator Core (generator-engineer, solo)

**Duration:** ~15 min

```
Tasks:
├── Read #4's HookManifest, GroupManifest, PresetConfig interfaces
├── Build scripts/generate-manifests.ts:
│   ├── Discovery: walk hooks/*/ finding directories with *.contract.ts
│   ├── Import parser:
│   │   ├── Regex: static import statements in contract files
│   │   ├── Classify into: core[], lib[], adapters[]
│   │   ├── Exclude type-only imports (import type { ... })
│   │   └── Pattern for core: @hooks/core/* or ../../core/*
│   ├── Event extractor:
│   │   └── Regex: event:\s*["'](\w+)["'] on contract source
│   ├── Shared file discovery:
│   │   └── Glob hooks/{Group}/*.shared.ts, map to importing hooks
│   ├── Merge-mode writer:
│   │   ├── If hook.json exists on disk:
│   │   │   ├── Read existing file
│   │   │   ├── Overwrite derivable fields: name, group, event, deps, schemaVersion
│   │   │   └── Preserve human-curated fields: tags, presets, description
│   │   └── If hook.json absent:
│   │       └── Create with derivable fields + empty tags/presets/description
│   ├── group.json generator:
│   │   ├── One per group directory
│   │   ├── hooks array sorted alphabetically by hook name
│   │   └── description left empty (human-curated)
│   ├── presets.json generator:
│   │   ├── Create at repo root only if absent
│   │   ├── Stub with minimal/quality/full skeletons
│   │   └── Never overwrite existing presets.json
│   └── --dry-run flag: print what would be written, touch nothing
├── Run generator against all 56 hooks
├── Validate all output against #4 schema
└── Commit generator script + all generated manifests
```

**Deliverable:** `scripts/generate-manifests.ts` + 56 `hook.json` + 19 `group.json` + `presets.json` committed.

**Gate:** All generated manifests pass schema validation from #4.

### Phase 2 — Parallel Validation (both agents)

**Duration:** ~8 min (parallel)

#### generator-engineer

```
Tasks:
├── Run generator twice, diff output → verify byte-identical (idempotency)
├── Write generator unit tests in scripts/generate-manifests.test.ts:
│   ├── Happy path: single hook → correct hook.json
│   ├── Missing contract file → hard error with path
│   ├── Duplicate hook name across groups → hard error
│   ├── --dry-run produces output but no files
│   ├── Merge mode: existing hook.json with custom tags → tags preserved
│   └── Type-only import → excluded from deps
└── Commit tests
```

#### ci-validator

```
Tasks:
├── Build scripts/check-manifests.ts:
│   ├── Run generator in --dry-run mode, capture intended output
│   ├── Diff intended output against committed hook.json (derivable fields only)
│   ├── Exit 0 if identical, exit 1 with diff if divergent
│   └── Report which hooks have drifted
├── Wire into bun test pipeline (or as standalone CI step)
├── Test: manually modify a hook.json dep field, verify check catches drift
└── Commit CI drift checker
```

**Deliverable:** Generator is proven idempotent. CI drift check catches stale manifests.

### Phase 3 — Final Validation (both agents)

**Duration:** ~3 min

```
Tasks:
├── bun test (all tests green, including generator + CI check tests)
├── tsc --noEmit (generator script in tsconfig scope)
├── Verify all 56 manifests pass schema validation
└── PR ready
```

**Gate:** Zero schema validation failures. CI drift check passes on clean state.

## Acceptance Criteria (from brainstorm consensus)

- [ ] Generator discovers hooks by walking `hooks/*/` for `*.contract.ts` — no hardcoded lists
- [ ] `event` extracted via regex from contract source
- [ ] `deps` classified into core[], lib[], adapters[] from import statements
- [ ] `deps.shared` populated with filenames from `hooks/{Group}/*.shared.ts`
- [ ] Type-only imports excluded from runtime deps
- [ ] Merge mode: derivable fields overwritten, tags/presets/description preserved
- [ ] `group.json` hooks array sorted alphabetically
- [ ] `presets.json` created only if absent, never overwritten
- [ ] All 56 generated manifests pass schema validation from #4
- [ ] Generator is idempotent (byte-identical on re-run)
- [ ] `scripts/check-manifests.ts` CI drift check
- [ ] `--dry-run` flag
- [ ] Duplicate hook names → hard error
- [ ] `bun test` passes (includes generator tests)
- [ ] `npx tsc --noEmit` covers generator script

## Anti-Criteria

- Generator does NOT parse `accepts()` for matcher extraction
- Generator does NOT execute hook files — static analysis only
- Generator does NOT resolve transitive dependencies
- Generator does NOT auto-generate preset membership — presets are author-curated
