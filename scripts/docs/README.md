# scripts/docs

HTML documentation generator for pai-hooks. Reads `hook.json`, `group.json`, `doc.md`, and `IDEA.md` from each hook directory and produces static HTML pages.

## Scripts

| File | Purpose |
|------|---------|
| `render.ts` | Main generator — walks `hooks/`, reads manifests + doc.md + IDEA.md, outputs HTML to `docs/` |
| `check.ts` | Validator — verifies all hooks have doc.md with required sections |
| `template.ts` | HTML templates — renders hook pages, group pages, and the index |
| `pre-commit-gate.ts` | Pre-commit check — blocks commits when hooks are missing doc.md, IDEA.md, or rendered HTML |
| `pre-commit-regen.ts` | Pre-commit auto-regen — regenerates HTML when doc sources are staged |
| `cli-utils.ts` | Shared CLI helpers (e.g. `getArg`) used by render and check |
| `style.css` | Stylesheet embedded into generated pages |

## Usage

```bash
bun run scripts/docs/render.ts              # Generate HTML to docs/
bun run scripts/docs/render.ts --out ./out  # Custom output directory
bun run scripts/docs/check.ts               # Verify all hooks have valid doc.md
```

## IDEA.md Copy Button

When a hook has an `IDEA.md` file alongside its `doc.md`, the generated HTML page includes a "Copy Idea" button next to the source link. Clicking it copies the raw IDEA.md markdown to the clipboard so users can paste it into any LLM conversation and get a working implementation for their own stack.

The renderer reads `IDEA.md` in `render.ts`, passes the content to `renderHookPage()` in `template.ts`, which stores it in a hidden `<script type="text/plain">` element and wires up a `copyIdea()` script.

## Multi-event badges

`hook.json` supports `event` as a string or string array. Hooks registered for multiple events (e.g. `["SessionStart", "PostToolUse"]`) render multiple colored badges in the docs. Badge colors are consistent across all views (summary counts, card badges, detail page tags) via a shared `eventColor()` mapping in `template.ts`.
