# Scripts

Automation scripts for the pai-hooks settings sync workflow.

See also the root-level scripts:
- `install.ts` — Merges hooks into `~/.claude/settings.json` (user-facing entry point)
- `uninstall.ts` — Removes all pai-hooks entries from `~/.claude/settings.json`

## export-hooks.ts

Extracts hook entries from `~/.claude/settings.json` and writes `settings.hooks.json`.
Filters to only hooks matching the source path prefix, rewrites paths to use the repo's
namespaced env var (`${SAINTPEPSI_PAI_HOOKS_DIR}/`). Only includes hooks whose `.hook.ts`
file exists in the repo, so PAI-specific hooks that aren't implemented here are excluded
automatically.

The default source prefix is read from `pai-hooks.json` manifest (`${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/`),
matching hooks already installed under the repo's own env var. A custom prefix can be passed
as an argument for initial migration from a different path (e.g., `${PAI_DIR}/hooks/`).

**Safety guard:** If the export finds zero matcher groups but `settings.hooks.json` already
contains hooks, the write is aborted to prevent accidental data loss.

**Used by:** Husky pre-commit hook (author workflow).

```bash
bun run scripts/export-hooks.ts
# Optional: specify a custom source prefix (for migration)
bun run scripts/export-hooks.ts '${PAI_DIR}/hooks/'
```

## import-hooks.ts

Reads `settings.hooks.json` and merges entries into `~/.claude/settings.json`.
Reuses `mergeHooksIntoSettings` from `install.ts` for idempotent merge logic.

**Used by:** Husky post-merge hook (keeps settings in sync after pulling changes).

```bash
bun run scripts/import-hooks.ts
```
