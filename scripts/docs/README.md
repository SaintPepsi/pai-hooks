# scripts/docs

HTML documentation generator for pai-hooks. Reads `hook.json`, `group.json`, and `doc.md` from each hook directory and produces static HTML pages.

## Scripts

| File | Purpose |
|------|---------|
| `render.ts` | Main generator — walks `hooks/`, reads manifests + doc.md, outputs HTML to `docs/` |
| `check.ts` | Validator — verifies all hooks have doc.md with required sections |
| `template.ts` | HTML templates — renders hook pages, group pages, and the index |
| `pre-commit-gate.ts` | Pre-commit check — blocks commits with undocumented hooks |
| `cli-utils.ts` | Shared CLI helpers (e.g. `getArg`) used by render and check |
| `style.css` | Stylesheet embedded into generated pages |

## Usage

```bash
bun run scripts/docs/render.ts              # Generate HTML to docs/
bun run scripts/docs/render.ts --out ./out  # Custom output directory
bun run scripts/docs/check.ts               # Verify all hooks have valid doc.md
```

## Multi-event badges

`hook.json` supports `event` as a string or string array. Hooks registered for multiple events (e.g. `["SessionStart", "PostToolUse"]`) render multiple colored badges in the docs.
