# HookDocEnforcer Multi-Doc Extension

**Date:** 2026-04-06
**Status:** Approved

## Goal

Extend HookDocEnforcer to enforce multiple doc files per hook (e.g., `doc.md` + `IDEA.md`), with configurable independent or linked obligation clearing.

## Config Shape

```json
{
  "hookConfig": {
    "hookDocEnforcer": {
      "enabled": true,
      "blocking": true,
      "docFileName": "doc.md",
      "requiredSections": ["## Overview", "## Event", "## When It Fires", "## What It Does", "## Examples", "## Dependencies"],
      "watchPatterns": ["\\.contract\\.ts$", "hook\\.json$", "group\\.json$"],
      "additionalDocs": [
        {
          "fileName": "IDEA.md",
          "requiredSections": ["## Problem", "## Solution", "## How It Works", "## Signals"]
        }
      ],
      "mode": "independent"
    }
  }
}
```

### New Fields

- `additionalDocs` — array of `{ fileName: string, requiredSections: string[] }`. Default: `[]` (backwards compatible, no behavior change without config).
- `mode` — `"independent"` or `"linked"`. Default: `"independent"`.
  - **independent:** Each doc file is its own obligation. Writing `IDEA.md` clears only the IDEA.md debt; writing `doc.md` clears only the doc.md debt.
  - **linked:** All doc files must be updated to clear the obligation for a given hook directory.

## Pending State Format

Tagged entries distinguish which doc file is owed:

```
Old: ["hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts"]
New: ["hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts:doc.md",
      "hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts:IDEA.md"]
```

Entries without `:` suffix are treated as primary doc obligation (backwards compatible with existing state files).

## Tracker Behavior (PostToolUse)

**Source file modified** (matches `watchPatterns`):
1. Create pending entry `sourcePath:doc.md` for the primary doc.
2. For each entry in `additionalDocs`, create pending entry `sourcePath:fileName`.

**Doc file written:**
- **independent mode:** Clear all pending entries where the tag matches the written doc's file name AND the directory matches.
- **linked mode:** When a doc file is written, check if ALL required doc files exist in that hook directory. If yes, clear all pending entries for that directory. If no, leave pending.

## Enforcer Behavior (Stop)

Same obligation machine — checks pending entries, blocks if any exist. The block message groups by directory and lists which doc files are owed:

```
Hook source files modified without documentation:
  hooks/CodingStandards/TypeStrictness/
    - TypeStrictness.contract.ts → needs IDEA.md
  hooks/GitSafety/DestructiveDeleteGuard/
    - DestructiveDeleteGuard.contract.ts → needs doc.md, IDEA.md
```

## Files Changed

| File | Change |
|------|--------|
| `HookDocStateMachine.shared.ts` | Add `AdditionalDoc` type, `additionalDocs`/`mode` to settings type, reader, defaults |
| `HookDocTracker.contract.ts` | Create tagged pending entries; clear by doc file name + mode |
| `HookDocEnforcer.contract.ts` | Parse tagged entries, group by directory, build structured block message |
| `HookDocStateMachine.shared.test.ts` | Test settings parsing with additionalDocs/mode |
| `HookDocTracker.test.ts` | Test multi-doc tracking, independent clearing, linked clearing |
| `HookDocEnforcer.test.ts` | Test grouped block messages |

## Backwards Compatibility

- No `additionalDocs` in config → no additional obligations created. Behavior identical to today.
- Existing pending state files without `:` suffix → treated as primary doc obligation.
- `mode` defaults to `"independent"` → no change for users who don't set it.
