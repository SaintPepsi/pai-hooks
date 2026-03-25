# Issue #7 — Install MVP (Source Mode)

**Issue:** [#7](https://github.com/SaintPepsi/pai-hooks/issues/7)
**Wave:** 3
**Depends on:** #5 (all manifests generated), #6 (resolver + CLI core)
**Blocks:** #8, #9, #10

## Team Composition

| Agent | Name | Model | Responsibility |
|-------|------|-------|---------------|
| Lead | `install-architect` | Opus | Pipeline design, conflict model, staging, path format decision |
| Agent 2 | `settings-engineer` | Opus | settings.json merge — append-only, command-string identity |
| Agent 3 | `copy-engineer` | Opus | File staging, dep deduplication, shared.ts, atomic rename |
| Agent 4 | `qa-engineer` | Opus | Test suite — all install scenarios |

## Context Each Agent Needs

All agents need:
- Design doc: [`docs/plans/2026-03-25-paih-cli-design.md`](2026-03-25-paih-cli-design.md) (install pipeline + lockfile sections)
- CLI core from #6: `cli/core/`, `cli/adapters/`, `cli/types/`
- Manifest files from #5: all `hook.json`, `group.json`, `presets.json`
- Existing install logic for reference: [`install.ts`](/install.ts) (current global installer)
- Existing settings format: [`settings.hooks.json`](/settings.hooks.json)
- Brainstorm consensus: [Issue #7 comment](https://github.com/SaintPepsi/pai-hooks/issues/7#issuecomment-4122374551)

Agent-specific context:
- `settings-engineer`: existing [`install.ts`](/install.ts) conflict resolution logic (`ConflictMode`)
- `qa-engineer`: all acceptance criteria from brainstorm consensus for test case design

## Execution Phases

### Phase 1 — Architecture (install-architect, solo)

**Duration:** ~10 min

```
Tasks:
├── Read #6's resolver, adapter, and pipe() interfaces
├── Read existing install.ts for ConflictMode pattern reference
├── DECISION: Hook command path format
│   ├── Recommendation: relative to target .claude/ (e.g., ./hooks/Group/Hook/Hook.hook.ts)
│   └── Document decision in this file and in code comment
├── Design install pipeline as pipe() chain:
│   pipe(
│     parseArgs,
│     resolveTarget,
│     resolveHooks,        // from #6 resolver
│     loadManifests,
│     resolveDependencies,  // from #6 deps.ts
│     stageFiles,           // new: copy to .paih-staging/
│     mergeSettings,        // new: settings-engineer builds this
│     writeLockfile,        // new: copy-engineer builds this
│     commitStaging,        // new: atomic rename staging → final
│   )
├── Design conflict semantics:
│   ├── Lockfile-tracked hook → update-in-place (no prompt, no conflict)
│   └── Foreign hook (settings entry with no lockfile match) → prompt with --keep/--replace/--both
├── Design lockfile schema (cli/types/lockfile.ts):
│   ├── lockfileVersion: 1
│   ├── source: string (repo URL or local path)
│   ├── sourceCommit: string | null
│   ├── installedAt: ISO8601
│   ├── outputMode: "source"
│   └── hooks: { name, group, event, commandString, files: string[], sourceHash?: string }[]
├── Write cli/commands/install.ts skeleton with pipeline shape
├── Write cli/types/lockfile.ts
└── Commit skeleton + types
```

**Deliverable:** Pipeline shape committed. Lockfile types defined. Path format decision documented.

### Phase 2 — Parallel Implementation (settings + copy + qa)

**Duration:** ~15 min (parallel)

#### settings-engineer

```
Tasks:
├── Build cli/core/settings.ts:
│   ├── readSettings(targetPath, deps): Result<SettingsJson, PaihError>
│   ├── mergeHookEntry(settings, hookEntry): Result<SettingsJson, PaihError>
│   │   ├── Find the event array (e.g., hooks.PreToolUse[])
│   │   ├── Check if entry with matching commandString already exists
│   │   ├── If exists → skip (idempotent)
│   │   ├── If not exists → append to array
│   │   └── Never remove, reorder, or modify existing entries
│   ├── detectForeignHooks(settings, lockfile): ForeignHook[]
│   │   └── Settings entries that have no matching lockfile commandString
│   ├── writeSettings(targetPath, settings, deps): Result<void, PaihError>
│   │   └── Write to .tmp then fs.rename (atomic)
│   └── All I/O through injected Deps
├── Write tests:
│   ├── Merge into empty settings → new entry added
│   ├── Merge into settings with existing hooks → appended, existing preserved
│   ├── Merge same hook twice → idempotent (no duplicate)
│   ├── Foreign hook detection → correctly identifies untracked entries
│   └── Atomic write → .tmp file used
└── Commit settings module + tests
```

#### copy-engineer

```
Tasks:
├── Build cli/core/staging.ts:
│   ├── createStaging(targetPath, deps): Result<string, PaihError>
│   │   └── Create .claude/hooks/.paih-staging/ directory
│   ├── stageHook(stagingPath, hookDef, depTree, deps): Result<StagedFiles, PaihError>
│   │   ├── Copy hook files (contract.ts, hook.ts)
│   │   ├── Copy shared.ts if hook's group has one
│   │   ├── Dedupe core deps into _core/ (one copy per dep, shared across hooks)
│   │   └── Track all staged file paths for lockfile
│   ├── commitStaging(stagingPath, finalPath, deps): Result<void, PaihError>
│   │   └── Atomic rename: staging → final location
│   └── cleanStaging(stagingPath, deps): Result<void, PaihError>
│       └── Remove staging dir on failure
├── Build cli/core/lockfile.ts:
│   ├── readLockfile(targetPath, deps): Result<Lockfile | null, PaihError>
│   ├── writeLockfile(targetPath, lockfile, deps): Result<void, PaihError>
│   ├── addHookEntry(lockfile, hookEntry): Lockfile
│   └── Backward compat: missing fields get defaults (outputMode → "source")
├── Build cli/core/tsconfig-gen.ts:
│   ├── generateTsconfig(installedHooks): TsconfigJson
│   └── Write to target/.claude/hooks/tsconfig.json (overwrite — paih owns this file)
├── Write tests:
│   ├── Stage → commit → files at final location
│   ├── Stage → failure → staging cleaned, nothing at final location
│   ├── Dep dedup: two hooks sharing core/result.ts → one copy in _core/
│   ├── shared.ts copied alongside group hooks
│   ├── Lockfile write + read round-trip
│   └── tsconfig generation with correct path aliases
└── Commit staging + lockfile + tsconfig-gen + tests
```

#### qa-engineer

```
Tasks:
├── Build test fixtures:
│   ├── Mock target project with .claude/ directory
│   ├── Mock source repo with 3-4 hooks across 2 groups
│   └── Mock manifests matching #4 schema
├── Write integration test scenarios:
│   ├── Fresh install single hook → files copied, settings merged, lockfile written
│   ├── Fresh install group → all group hooks installed
│   ├── Fresh install preset → preset hooks installed
│   ├── Re-install same hook → idempotent (no duplicates in settings)
│   ├── Install with --force → overwrites conflicts
│   ├── Foreign hook detected → conflict reported (not auto-resolved without flag)
│   ├── Partial failure → staging cleaned, settings untouched, lockfile untouched
│   ├── Missing bun on PATH → error before any file ops
│   ├── Missing .claude/ → TARGET_NOT_FOUND error
│   ├── --to <path> → installs to specified location
│   └── tsconfig valid after install (tsc --noEmit on target)
├── Document manual smoke test procedure in docs/smoke-test.md:
│   └── Steps to verify installed hook fires in Claude Code session
└── Commit all tests + smoke test doc
```

### Phase 3 — Assembly (install-architect + qa-engineer)

**Duration:** ~8 min

```
Tasks:
├── Wire settings + copy + lockfile into install pipeline via pipe()
├── End-to-end test: paih install TypeStrictness
│   ├── Verify hook files at target/.claude/hooks/CodingStandards/TypeStrictness/
│   ├── Verify settings.json has PreToolUse entry with correct command
│   ├── Verify paih.lock.json has entry with commandString + files
│   └── Verify tsconfig.json has @hooks/* alias
├── bun test (all tests green)
├── tsc --noEmit (compiles clean)
└── PR ready
```

**Gate:** End-to-end install produces correct artifacts. All integration tests pass.

## Acceptance Criteria (from brainstorm consensus)

- [ ] `paih install <hook>` copies hook + deps to target `.claude/hooks/`
- [ ] `paih install <group>` installs all hooks in group
- [ ] `paih install --preset <name>` installs preset bundle
- [ ] Lockfile-tracked → update-in-place; foreign → conflict prompt with flags
- [ ] Settings identity by command string, not positional index
- [ ] Settings merge is append-only, idempotent, never removes existing entries
- [ ] Atomic staging: `.paih-staging/` → rename on success, clean on failure
- [ ] Lockfile with `lockfileVersion`, `commandString`, `sourceCommit` (nullable), `outputMode`
- [ ] `tsconfig.json` at `.claude/hooks/` (DX/CI only, documented)
- [ ] Core deps deduped into `_core/`
- [ ] `bun` on PATH validated before file ops
- [ ] `bun test` and `tsc --noEmit` pass
- [ ] Manual smoke test documented

## Anti-Criteria

- No Windows path support
- No multi-source installs
- No symlink mode
- No automated Claude Code session testing
