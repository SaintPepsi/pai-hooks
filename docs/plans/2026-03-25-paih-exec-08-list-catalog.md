# Issue #8 — List + Catalog Commands

**Issue:** [#8](https://github.com/SaintPepsi/pai-hooks/issues/8)
**Wave:** 4 (parallel with #9, #10)
**Depends on:** #7 (lockfile format established)

## Team Composition

| Agent | Name | Model | Responsibility |
|-------|------|-------|---------------|
| Lead | `list-engineer` | Opus | Both commands — lockfile reading, manifest reading, formatting, --json |
| Agent 2 | `test-engineer` | Opus | Edge case tests — corrupt, empty, orphaned, malformed |

## Context Each Agent Needs

All agents need:
- Lockfile module from #7: `cli/core/lockfile.ts` (shared reader)
- Manifest parser: `cli/core/manifest.ts` or equivalent from #4/#5
- Lockfile types: `cli/types/lockfile.ts` (from #7)
- Manifest types: `cli/types/manifest.ts` (from #4)
- Error types: `cli/core/error.ts` with `LOCK_CORRUPT` code (from #6)
- Brainstorm consensus: [Issue #8 comment](https://github.com/SaintPepsi/pai-hooks/issues/8#issuecomment-4122378987)

## Execution Phases

### Phase 1 — Implementation (both agents, parallel)

**Duration:** ~12 min

#### list-engineer

```
Tasks:
├── Build cli/commands/list.ts:
│   ├── Read lockfile via shared cli/core/lockfile.ts (NOT a bespoke reader)
│   ├── --in <path> flag: read lockfile from specified project
│   │   └── Default: resolve from CWD walk-up via cli/core/target.ts (from #6)
│   ├── For each hook in lockfile:
│   │   ├── Check files exist on disk → status: "ok"
│   │   ├── Files missing on disk → status: "MISSING"
│   │   └── Include: name, group, event, outputMode, status
│   ├── Three distinct output states:
│   │   ├── No hooks installed → "No hooks installed. Run paih install to get started." (exit 0)
│   │   ├── Orphaned hooks present → show with MISSING status + hint
│   │   └── Lockfile corrupt (LOCK_CORRUPT) → error to stderr, exit 1
│   ├── --json flag: output typed JSON array matching lockfile hook schema
│   │   └── Errors output as PaihError JSON on stderr
│   └── All I/O through injected Deps (from #6)
│
├── Build cli/commands/catalog.ts:
│   ├── Read all hook.json files by globbing hooks/**/hook.json
│   │   └── Use shared manifest parser module (same one #5's generator uses)
│   ├── Skip malformed hook.json with warning to stderr (not fatal)
│   ├── Default view columns: Name, Group, Event, Tags, Description (truncated 60 chars)
│   ├── --groups flag: Group, Hook Count, Description (from group.json)
│   ├── --presets flag: Preset, Description, Hook/Group list (from presets.json)
│   ├── --json flag: typed JSON output matching view mode
│   │   ├── Default: HookManifest[]
│   │   ├── --groups: GroupManifest[]
│   │   └── --presets: PresetConfig
│   ├── Empty state: "No hook manifests found." with hint
│   └── All I/O through injected Deps
│
└── Commit both commands

```

#### test-engineer

```
Tasks:
├── Build test fixtures in test-fixtures/list-catalog/:
│   ├── valid-lockfile.json (3 hooks, all files present)
│   ├── orphaned-lockfile.json (1 hook with missing files)
│   ├── corrupt-lockfile.json (invalid JSON)
│   ├── empty-lockfile.json (version header, empty hooks array)
│   ├── valid-hook-manifests/ (3 hook.json files)
│   ├── malformed-manifest/ (hook.json with missing required field)
│   └── empty-manifests/ (no hook.json files)
│
├── Write list tests (cli/commands/list.test.ts):
│   ├── Valid lockfile → correct table output with all columns
│   ├── Orphaned hook → MISSING status shown
│   ├── Corrupt lockfile → LOCK_CORRUPT error, exit non-zero
│   ├── Empty lockfile → "No hooks installed" message
│   ├── --json → valid JSON matching LockfileHookEntry[] shape
│   ├── --json with error → PaihError JSON on stderr
│   └── --in <path> → reads from specified location
│
├── Write catalog tests (cli/commands/catalog.test.ts):
│   ├── Valid manifests → correct table output
│   ├── --groups → group summary view
│   ├── --presets → preset view
│   ├── Malformed manifest → warning logged, skipped, other hooks shown
│   ├── No manifests found → empty state message
│   ├── --json → valid JSON matching HookManifest[] shape
│   └── --json --groups → valid JSON matching GroupManifest[] shape
│
└── Commit all tests
```

### Phase 2 — Final Validation (both agents)

**Duration:** ~3 min

```
Tasks:
├── Verify list uses shared lockfile.ts (not a bespoke reader)
├── Verify catalog uses shared manifest parser (not ad-hoc reads)
├── bun test (all tests green)
├── tsc --noEmit (compiles clean)
└── PR ready
```

**Gate:** All tests pass. Both commands use shared modules (not bespoke parsers).

## Acceptance Criteria (from brainstorm consensus)

**`paih list`:**
- [ ] Reads via shared `cli/core/lockfile.ts`
- [ ] `--in <path>` flag, default CWD walk-up
- [ ] Columns: Name, Group, Event, Output Mode, Status
- [ ] Status: `ok` / `MISSING` / `[error]`
- [ ] Three distinct states: empty, orphaned, corrupt
- [ ] `--json` outputs typed JSON; errors as PaihError on stderr

**`paih catalog`:**
- [ ] Reads via shared manifest parser
- [ ] Skips malformed manifests with warning
- [ ] Default, `--groups`, `--presets` views
- [ ] `--json` for each view mode
- [ ] Graceful empty state

**Shared:**
- [ ] Both use same `lockfile.ts` and `manifest.ts` as install/uninstall
- [ ] All errors use `PaihError` type
- [ ] `bun test` passes
- [ ] `npx tsc --noEmit` passes

## Anti-Criteria

- Read-only — no writes to lockfile or filesystem
- No hook installation triggered from these commands
- No `.hook.ts` filesystem validation in catalog (that is `paih verify` in [#10](https://github.com/SaintPepsi/pai-hooks/issues/10))
- No `--show-installed` cross-referencing in v1
