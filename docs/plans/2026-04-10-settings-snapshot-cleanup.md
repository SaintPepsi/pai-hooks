# Settings Snapshot Cleanup Refactor

## Problem

SettingsGuard creates snapshot files in `/tmp/` before every Bash command but never cleans them up. This causes:

1. **False positive reverts** — stale snapshots from earlier in a session (or failed writes) cause SettingsRevert to detect phantom diffs and inject security warnings for innocent commands like `rm docs/plans/`
2. **File accumulation** — ~72KB per session, never cleaned, 29 orphans observed in `/tmp/`

## Changes Made

### SettingsRevert: snapshot lifecycle cleanup
- Delete snapshot files after every comparison (revert or no-change)
- Probabilistic sweep (1-in-20) removes orphaned snapshots from dead sessions
- Added `removeFile` and `readDir` to deps

### SettingsGuard: write failure detection
- Check `writeFile` result on snapshot writes (was silently discarded)
- Warn on stderr if snapshot write fails

### Housekeeping
- `.hardening-session` removed from git, added to `.gitignore`

## Future Considerations

- **Move snapshots out of `/tmp/`** — use `MEMORY/STATE/snapshots/` for consistency with other state files, with session-scoped cleanup on SessionStart
- **Consolidate SettingsGuard + SettingsRevert** — they share types, constants (`SETTINGS_FILENAMES`), and the `snapshotPath` function; a single module with pre/post exports would reduce coupling
- **Drop Bash snapshot strategy entirely** — SecurityValidator already validates Bash commands against path patterns and `extractWriteTargets`; the snapshot/revert is a redundant safety net that adds complexity
