# Scripts

Automation scripts for the pai-hooks settings sync workflow.

See also the root-level scripts:
- `install.ts` — Merges hooks into `~/.claude/settings.json` (user-facing entry point)
- `uninstall.ts` — Removes all pai-hooks entries from `~/.claude/settings.json`

## export-hooks.ts

Extracts hook entries from `~/.claude/settings.json` and writes `settings.hooks.json`.
Filters to only hooks matching the source path prefix, rewrites paths to use the repo's
namespaced env var (`${SAINTPEPSI_PAI_HOOKS_DIR}/`).

**Used by:** Husky pre-commit hook (author workflow).

```bash
bun run scripts/export-hooks.ts
# Optional: specify a custom source prefix
bun run scripts/export-hooks.ts '${PAI_DIR}/hooks/'
```

## import-hooks.ts

Reads `settings.hooks.json` and merges entries into `~/.claude/settings.json`.
Reuses `mergeHooksIntoSettings` from `install.ts` for idempotent merge logic.

**Used by:** Husky post-merge hook (keeps settings in sync after pulling changes).

```bash
bun run scripts/import-hooks.ts
```
