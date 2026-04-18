## Overview

Injects configured coding standards files as context on the first Write or Edit tool use in a session. Ensures Claude has access to project-specific conventions before making code changes.

## Event

PreToolUse

## When It Fires

- Tool is Write or Edit
- First Write/Edit in the session (subsequent calls are skipped)
- `codingStandards` array is configured in settings.json

## What It Does

1. Checks if already injected this session (skip if so)
2. Reads `codingStandards` array from top-level settings.json
3. For each configured path:
   - Resolves relative paths against PAI_DIR
   - Skips files over 50KB
   - Deduplicates by content hash
4. Injects combined content as `additionalContext`

## Examples

> **Injecting TypeScript standards**
>
> Configure in settings.json:
> ```json
> {
>   "codingStandards": [
>     "standards/typescript.md",
>     "standards/testing.md"
>   ]
> }
> ```
> On first Write/Edit, both files are injected as context.

> **Absolute path standards**
>
> ```json
> {
>   "codingStandards": [
>     "/shared/company-standards.md"
>   ]
> }
> ```
> Absolute paths are used as-is without PAI_DIR prefix.

## Dependencies

- `@hooks/core/adapters/fs` — File reading
- `@hooks/core/adapters/json` — Safe JSON parsing
- `@hooks/lib/paths` — PAI_DIR and settings path resolution
