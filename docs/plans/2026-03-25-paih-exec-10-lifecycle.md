# Issue #10 — Lifecycle Commands (Uninstall, Update, Verify)

**Issue:** [#10](https://github.com/SaintPepsi/pai-hooks/issues/10)
**Wave:** 4 (parallel with #8, #9)
**Depends on:** #7 (install pipeline + lockfile)

## Team Composition

| Agent | Name | Model | Responsibility |
|-------|------|-------|---------------|
| Lead | `lifecycle-architect` | Opus | Content hash scheme, lockfile schema additions, sequencing |
| Agent 2 | `verify-engineer` | Opus | Both verify modes (source-mode CI + installed-mode drift) |
| Agent 3 | `uninstall-engineer` | Opus | Uninstall with modification detection, --dry-run, --force |
| Agent 4 | `update-engineer` | Opus | Update composing verify + uninstall, hash comparison |

## Context Each Agent Needs

All agents need:
- Install pipeline from #7: `cli/commands/install.ts`, `cli/core/settings.ts`, `cli/core/lockfile.ts`, `cli/core/staging.ts`
- Lockfile types: `cli/types/lockfile.ts` (from #7)
- Manifest types + validator: `cli/types/manifest.ts`, `cli/core/validator.ts` (from #4)
- Settings module: `cli/core/settings.ts` (from #7 — needed for unmerge symmetry)
- Existing uninstall logic: [`uninstall.ts`](/uninstall.ts) (current global uninstaller, for pattern reference)
- Brainstorm consensus: [Issue #10 comment](https://github.com/SaintPepsi/pai-hooks/issues/10#issuecomment-4122380162)

Agent-specific context:
- `uninstall-engineer`: needs `cli/core/settings.ts` merge logic to build the inverse (unmerge)
- `update-engineer`: needs both verify and uninstall modules complete before starting

## Implementation Order

This issue is strictly sequential internally. Each phase depends on the previous.

```
Phase 1: Schema additions + verify source-mode
Phase 2: Uninstall (depends on Phase 1 — uses hash scheme)
Phase 3: Update (depends on Phase 2 — composes uninstall + install)
Phase 4: Verify installed-mode + integration (depends on all above)
```

## Execution Phases

### Phase 1 — Schema + Verify Source-Mode (lifecycle-architect + verify-engineer)

**Duration:** ~12 min

#### lifecycle-architect

```
Tasks:
├── Update cli/types/lockfile.ts with new fields:
│   ├── hooks[].commandString: string
│   │   └── Replaces positional settingsKey — full hook command path
│   │       e.g., "bun run ./.claude/hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts"
│   ├── hooks[].fileHashes: Record<string, string>
│   │   └── Map of relative file path → SHA-256 content hash
│   │       Enables modification detection in uninstall and update
│   └── Backward compat: lockfiles missing these fields get defaults
│       ├── commandString: reconstructed from hook name + group + outputMode
│       └── fileHashes: {} (empty — modification detection unavailable for old installs)
│
├── Update cli/core/lockfile.ts:
│   ├── Add computeFileHash(filePath, deps): Result<string, PaihError>
│   │   └── SHA-256 of file content
│   ├── Update addHookEntry to include commandString + fileHashes
│   └── Update readLockfile to handle missing fields gracefully
│
├── Update cli/commands/install.ts (from #7):
│   └── Write commandString and fileHashes when creating lockfile entries
│
└── Commit schema additions
```

#### verify-engineer (starts after schema committed)

```
Tasks:
├── Build cli/commands/verify.ts — source-mode:
│   ├── Trigger: paih verify (no --installed flag, run in source repo)
│   ├── Glob all hook.json files under hooks/
│   ├── For each hook:
│   │   ├── Parse imports in contract file (same regex as #4 validator)
│   │   ├── Compare declared deps (from hook.json) against actual imports
│   │   ├── MANIFEST_MISSING_DEP: imported but not declared
│   │   └── MANIFEST_GHOST_DEP: declared but not imported
│   ├── Skip hooks installed in compiled mode with explicit warning
│   ├── --fix flag: rewrite hook.json to match actual imports
│   │   └── Only rewrites derivable fields (same merge-mode as #5 generator)
│   ├── Exit 0 if all clean, exit 1 if any mismatches found
│   └── All I/O through injected Deps
│
├── Write source-mode tests:
│   ├── Clean hook → passes
│   ├── Missing dep → reported
│   ├── Ghost dep → reported
│   ├── --fix → hook.json rewritten correctly
│   ├── Multiple hooks, mixed results → all reported
│   └── Compiled install → skipped with warning
│
└── Commit verify source-mode + tests
```

**Deliverable:** Lockfile schema updated. `paih verify` works in CI mode.

### Phase 2 — Uninstall (uninstall-engineer)

**Duration:** ~15 min

```
Tasks:
├── Build cli/commands/uninstall.ts:
│   ├── Hook-level: paih uninstall TypeStrictness
│   │   ├── Read lockfile, find matching hook entry
│   │   ├── For each file in hooks[].files:
│   │   │   ├── Compute current content hash
│   │   │   ├── Compare against lockfile fileHashes
│   │   │   ├── Match → delete file
│   │   │   └── Mismatch → abort with warning:
│   │   │       "File modified since install: <path>. Use --force to delete anyway."
│   │   ├── Remove settings entry by commandString match
│   │   │   └── Use cli/core/settings.ts — build unmergeHookEntry() inverse of merge
│   │   ├── Update lockfile: remove hook entry
│   │   └── Clean up empty directories
│   │
│   ├── Group-level: paih uninstall CodingStandards
│   │   ├── Resolve group name → all hooks in group (from lockfile, not manifests)
│   │   └── Uninstall each hook in group, same logic as above
│   │
│   ├── Shared file ref-counting:
│   │   ├── After removing a hook, check if any remaining hooks in lockfile
│   │   │   reference the same group's shared.ts
│   │   ├── If no remaining hooks → delete shared.ts
│   │   └── If hooks remain → keep shared.ts
│   │
│   ├── Core directory cleanup:
│   │   ├── After uninstall, check if lockfile hooks[] is empty
│   │   └── If empty → remove _core/ directory entirely
│   │
│   ├── --dry-run flag:
│   │   ├── Print all files that would be deleted
│   │   ├── Print settings entries that would be removed
│   │   ├── Print shared.ts / core/ cleanup actions
│   │   └── Touch nothing on disk
│   │
│   ├── --force flag:
│   │   └── Skip modification detection, delete regardless of hash mismatch
│   │
│   ├── Idempotency:
│   │   ├── File in lockfile but missing on disk → warn, continue
│   │   └── Settings entry already absent → warn, continue
│   │
│   ├── --from <path> flag: target project path override
│   └── All I/O through injected Deps
│
├── Build unmergeHookEntry() in cli/core/settings.ts:
│   ├── Find and remove settings entry matching commandString
│   ├── Never remove entries not matching (user's own hooks preserved)
│   └── Atomic write (same .tmp + rename pattern as merge)
│
├── Write uninstall tests:
│   ├── Uninstall single hook → files removed, settings cleaned, lockfile updated
│   ├── Uninstall group → all group hooks removed
│   ├── Modified file without --force → abort with warning
│   ├── Modified file with --force → deleted anyway
│   ├── --dry-run → correct plan printed, nothing touched
│   ├── Already-missing file → warn, continue
│   ├── shared.ts ref-counting: remove last hook in group → shared.ts deleted
│   ├── shared.ts ref-counting: other hooks remain → shared.ts kept
│   ├── All hooks removed → _core/ cleaned up
│   └── --from <path> → operates on specified target
│
└── Commit uninstall + settings unmerge + tests
```

**Deliverable:** `paih uninstall` works for hooks and groups with modification detection.

### Phase 3 — Update (update-engineer, after Phase 2)

**Duration:** ~15 min

```
Tasks:
├── Build cli/commands/update.ts:
│   ├── Read lockfile: get sourceCommit, installed hooks with fileHashes
│   │
│   ├── Detect source changes:
│   │   ├── Get current HEAD: git rev-parse HEAD on source repo
│   │   │   └── If sourceCommit in lockfile no longer exists (force push),
│   │   │       fall back to HEAD and warn
│   │   ├── For each installed hook:
│   │   │   ├── Compute content hash of current source files
│   │   │   ├── Compare against lockfile fileHashes
│   │   │   ├── Changed → mark for re-install
│   │   │   └── Unchanged → skip
│   │   └── Hooks deleted from source → flag as "removed upstream"
│   │       └── Do NOT auto-remove — print message, user must paih uninstall explicitly
│   │
│   ├── Re-install changed hooks:
│   │   ├── Check for local modifications (same hash check as uninstall):
│   │   │   ├── Local mods detected → abort unless --force
│   │   │   └── --force → overwrite
│   │   ├── Use uninstall logic to remove old files
│   │   ├── Use install logic to copy new files
│   │   └── Preserve outputMode from lockfile per hook
│   │       (unless --mode flag explicitly changes it — future consideration)
│   │
│   ├── Update lockfile:
│   │   ├── sourceCommit → current HEAD
│   │   ├── installedAt → now
│   │   └── fileHashes → new hashes for re-installed hooks
│   │
│   ├── --dry-run: list what would change, don't write
│   ├── --force: overwrite locally modified files
│   ├── --in <path>: target project path override
│   │
│   ├── Error handling:
│   │   ├── Missing lockfile → "No paih.lock.json found. Run paih install first."
│   │   ├── Corrupt lockfile → "paih.lock.json is corrupt. Run paih verify --fix."
│   │   └── Git errors → "Cannot determine source state. Is this a git repo?"
│   │
│   └── All I/O through injected Deps
│
├── Write update tests:
│   ├── Source unchanged → "All hooks up to date" (no-op)
│   ├── One hook changed → only that hook re-installed
│   ├── Hook removed from source → "removed upstream" message, not auto-deleted
│   ├── Local modification without --force → abort
│   ├── Local modification with --force → overwritten
│   ├── --dry-run → correct change list, nothing touched
│   ├── Missing lockfile → clear error
│   ├── Corrupt lockfile → clear error with recovery hint
│   ├── outputMode preserved on re-install
│   └── sourceCommit and fileHashes updated in lockfile
│
└── Commit update + tests
```

**Deliverable:** `paih update` detects changes, re-installs, preserves output mode.

### Phase 4 — Verify Installed-Mode + Integration (verify-engineer + lifecycle-architect)

**Duration:** ~10 min

#### verify-engineer

```
Tasks:
├── Add installed-mode to cli/commands/verify.ts:
│   ├── Trigger: paih verify --installed (run in target project)
│   ├── Read lockfile from target
│   ├── For each installed hook:
│   │   ├── Check all files in hooks[].files exist on disk
│   │   ├── Compute content hash, compare against lockfile fileHashes
│   │   └── Report drifted files (hash mismatch)
│   ├── Check all commandString entries exist in target settings.json
│   ├── Report:
│   │   ├── Missing files
│   │   ├── Modified files (with hash diff)
│   │   └── Missing settings entries
│   ├── Instruct: "Run paih update to restore, or paih uninstall to remove."
│   └── --fix NOT available in installed-mode (update is the fix path)
│
├── Write installed-mode tests:
│   ├── Clean install → all checks pass
│   ├── Modified file → drift reported
│   ├── Missing file → reported
│   ├── Missing settings entry → reported
│   └── --fix attempted → error: "Use paih update for installed hooks"
│
└── Commit installed-mode verify + tests
```

#### lifecycle-architect

```
Tasks:
├── Write full lifecycle integration test:
│   ├── install → verify (clean) → modify file → verify (drift detected)
│   │   → update → verify (clean again)
│   ├── install → uninstall → verify (nothing installed)
│   └── install → update --dry-run → no changes on disk
│
├── bun test (all tests green)
├── tsc --noEmit (compiles clean)
└── PR ready
```

**Gate:** Full lifecycle round-trip passes. All four commands work in concert.

## Acceptance Criteria (from brainstorm consensus)

**Lockfile schema:**
- [ ] `commandString` replaces positional settingsKey
- [ ] `fileHashes` per file for modification detection
- [ ] Backward compatible with old lockfiles

**Uninstall:**
- [ ] Hook-level and group-level uninstall
- [ ] Modification detection (hash mismatch → abort unless `--force`)
- [ ] `--dry-run` prints plan, touches nothing
- [ ] Shared.ts ref-counted, removed when group empty
- [ ] `_core/` removed when all hooks gone
- [ ] Idempotent: missing file → warn, continue
- [ ] `--from <path>` flag

**Update:**
- [ ] Content hash comparison for change detection
- [ ] `--dry-run` and `--force` flags
- [ ] Preserves `outputMode` per hook
- [ ] Missing/corrupt lockfile → explicit error with recovery hint
- [ ] Hooks removed upstream → flagged, not auto-deleted
- [ ] `--in <path>` flag

**Verify:**
- [ ] Source-mode (CI): validates manifests match imports
- [ ] Source-mode `--fix`: rewrites manifests
- [ ] Installed-mode (`--installed`): checks files match lockfile hashes
- [ ] Installed-mode `--fix` → error (use `paih update`)

**All:**
- [ ] `bun test` passes
- [ ] `npx tsc --noEmit` passes

## Anti-Criteria

- No inter-hook dependency resolution (hook A requires hook B)
- No preset-level uninstall (future issue)
- No auto-detection of renamed/moved hooks
- No concurrent invocation safety (single-process only, documented)
- No downgrade support (update always moves forward)
