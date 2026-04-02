# pai-hooks

PAI hook system — TypeScript contracts for Claude Code hooks.

## Key Rules

- **Commit changes when done.** Don't leave uncommitted work in this repo.
- Run `bun test` before committing to verify no regressions.
- Run `npx tsc --noEmit` to check for type errors.

## Type System

Contracts use narrowed types from `core/contract.ts`:
- `SyncHookContract<I, O, D>` — most hooks (execute returns `Result`)
- `AsyncHookContract<I, O, D>` — 6 async hooks (execute returns `Promise<Result>`)
- `HookContract<I, O, D>` — union type, used by the runner only

## Coding Standards

- No raw Node builtins — use adapters from `core/adapters/` (`node:path` is exempt — pure functions, no I/O)
- No try-catch in business logic — use `Result<T, E>` pipelines
- No direct `process.env` outside `defaultDeps`
- No direct `settings.json` reads for hook-specific config — use `readHookConfig()` from `lib/hook-config.ts` (reads `hookConfig.{hookName}` section)
- Use `@hooks/*` path aliases, not relative imports
- Use `import type` for type-only imports

## Hook Documentation

Every hook should have a `doc.md` file in its directory. The HookDocEnforcer hook will block session end if you modify hook source files (`.contract.ts`, `hook.json`, `group.json`) without updating docs.

### Writing a doc.md

Create `hooks/{Group}/{Hook}/doc.md` with these required sections:

```markdown
## Overview
## Event
## When It Fires
## What It Does
## Examples
## Dependencies
```

Content within each section maps to framework components automatically:
- **Bullet lists** → reason boxes
- **Numbered lists** → flow steps
- **Code blocks** → code windows (macOS-style)
- **Blockquotes** → use-case example panels
- **Tables** → styled data tables

### Generating HTML docs

```bash
bun run docs:render              # Generate HTML to docs/
bun run docs:check               # Verify all hooks have valid doc.md
bun run docs:render --out ./out  # Custom output directory
```

### Configuring the enforcer

In `~/.claude/settings.json`:

```json
{
  "hookConfig": {
    "hookDocEnforcer": {
      "enabled": true,
      "blocking": true,
      "docFileName": "doc.md",
      "requiredSections": ["## Overview", "## Event", "## When It Fires", "## What It Does", "## Examples", "## Dependencies"],
      "watchPatterns": ["\\.contract\\.ts$", "hook\\.json$", "group\\.json$", "shared\\.ts$", "README\\.md$"]
    }
  }
}
```

Set `"blocking": false` to get advisory warnings instead of session blocks.
