# HookDocEnforcer

## Overview

HookDocEnforcer is a **Stop-event** hook that blocks session end when hook source files have been modified without updating their corresponding documentation. It works in tandem with the HookDocTracker (PostToolUse) which tracks which files are stale.

This hook is fully configurable via `hookConfig.hookDocEnforcer` in `settings.json`, allowing per-project control over required sections, blocking behavior, and watched file patterns.

## Event

`Stop` — fires when the user attempts to end a Claude Code session.

If pending documentation obligations exist, the hook blocks the session and tells Claude exactly which `doc.md` files need to be created and what sections they must contain.

## When It Fires

- The HookDocTracker has flagged one or more hook source files as having stale or missing documentation
- The user attempts to end their session (Stop event)
- The hook is enabled in settings (default: enabled)
- No project-level override exists (checked via `projectHasHook`)

It does **not** fire when:

- No source files were modified during the session
- All modified hooks already had their `doc.md` updated
- The hook is disabled via `hookConfig.hookDocEnforcer.enabled: false`
- A project-level `HookDocEnforcer.hook.ts` exists in `.claude/hooks/`

## What It Does

1. Reads pending state from the session's obligation state file
2. If no pending files exist, returns `silent` (session proceeds)
3. Checks the block count against `maxBlocks` (default: 1)
4. If the block limit has been reached, writes a review document and releases the session
5. Otherwise, builds a block message containing:
   - A narrative opener (escalating tone based on violation count)
   - The list of modified source files lacking documentation
   - Specific suggestions for which `doc.md` files to create
   - The required sections that each doc must contain

```typescript
// Core enforcer flow (R8 silent + R5 block via top-level decision/reason)
const result = checkObligation(deps, HOOK_DOC_CONFIG, input.session_id);

if (result.action === "silent" || result.action === "release") {
  return ok({}); // R8 — bare empty object, SDK treats as silent skip
}

// Build reason with file list + required sections
// R5 — Stop is a NonHookSpecificEvent, so block decision/reason go at the top level
// (NOT nested under hookSpecificOutput as PreToolUse permissionDecision would be).
return ok({ decision: "block", reason });
```

## Examples

### Example 1: Source file edited without docs

> You edit `FooBar/FooBar.contract.ts` during a session. When you try to end the session, HookDocEnforcer blocks with:
>
> "Hook source files modified without documentation:
>   - /hooks/MyGroup/FooBar/FooBar.contract.ts
>
> Create or update `/hooks/MyGroup/FooBar/doc.md`
>
> Required sections in `doc.md`:
>   - ## Overview
>   - ## Event
>   - ## When It Fires
>   - ## What It Does
>   - ## Examples
>   - ## Dependencies"

### Example 2: Doc written, session proceeds

> After being blocked, you create `FooBar/doc.md` with all required sections. The HookDocTracker detects the write and clears the pending flag. On the next Stop attempt, HookDocEnforcer returns `silent` and the session ends normally.

### Example 3: Block limit reached

> If you attempt to end the session twice without writing docs, the enforcer reaches its block limit (default: 1), writes a review document to `MEMORY/STATE/hook-doc-obligation/review-{session_id}.md`, and releases the session.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `obligation-machine` | lib | Generic state machine (checkObligation, createDefaultDeps) |
| `narrative-reader` | lib | Picks escalating narrative tone for block messages |
| `paths` | lib | Resolves settings.json path |
| `DocObligationStateMachine.shared` | shared | Provides `projectHasHook` for deduplication |
| `HookDocStateMachine.shared` | shared | Settings reader, config, doc suggestions builder |
| `@anthropic-ai/claude-agent-sdk` | SDK types | `SyncHookJSONOutput` return type. R5 block path uses top-level `decision: "block"` + `reason` because Stop is a NonHookSpecificEvent and has no `hookSpecificOutput` wrapping (contrast with PreToolUse where deny goes through `hookSpecificOutput.permissionDecision`). R8 silent path is a bare `{}`. Post-SDK-refactor migration. |

## Configuration

Settings are read from `~/.claude/settings.json` under `hookConfig.hookDocEnforcer`:

```json
{
  "hookConfig": {
    "hookDocEnforcer": {
      "enabled": true,
      "blocking": true,
      "docFileName": "doc.md",
      "requiredSections": [
        "## Overview",
        "## Event",
        "## When It Fires",
        "## What It Does",
        "## Examples",
        "## Dependencies"
      ],
      "watchPatterns": [
        "\\.contract\\.ts$",
        "hook\\.json$",
        "group\\.json$",
        "shared\\.ts$",
        "README\\.md$"
      ]
    }
  }
}
```

| Setting | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enable or disable the enforcer entirely |
| `blocking` | `true` | Whether to block (true) or just log (false) |
| `docFileName` | `"doc.md"` | Name of the documentation file to look for |
| `requiredSections` | 6 headings | Markdown headings that must appear in the doc |
| `watchPatterns` | 5 patterns | Regex patterns for files that trigger the obligation |
| `additionalDocs` | `[]` | Array of `{ fileName, requiredSections }` for extra doc files |
| `mode` | `"independent"` | How obligations clear: `"independent"` or `"linked"` |

## Multi-Doc Support

The enforcer can track multiple documentation files per hook via `additionalDocs` in the config. When a hook source file is modified, obligations are created for each configured doc file.

### Configuration

- `additionalDocs` — array of `{ fileName, requiredSections }`. Each entry adds another doc obligation per hook.
- `mode` — controls how obligations clear:
  - `"independent"` (default) — writing IDEA.md clears the IDEA.md obligation; writing doc.md clears the doc.md obligation. Each clears independently.
  - `"linked"` — ALL doc files must exist in the hook directory before any obligations clear.

### Example

With `additionalDocs: [{ fileName: "IDEA.md", requiredSections: ["## Problem", "## Solution", "## How It Works", "## Signals"] }]`, modifying `TypeStrictness.contract.ts` creates two obligations:
1. Update `doc.md` with required sections (Overview, Event, etc.)
2. Update `IDEA.md` with required sections (Problem, Solution, etc.)
