# BashWriteGuard

## Overview

BashWriteGuard is a **PreToolUse** hook that blocks Bash commands that would write to TypeScript files. It detects output redirection (`>`, `>>`), in-place sed (`sed -i`), `tee`, `cp`, and `mv` patterns targeting `.ts`/`.tsx` files. By blocking these bypass paths, it forces the model to use the Edit or Write tools where CodingStandardsEnforcer can enforce coding standards.

Without this hook, the model could circumvent all coding standards enforcement by using Bash commands like `echo "..." > file.ts` or `sed -i 's/old/new/' file.ts` instead of the monitored Edit/Write tools.

## Event

`PreToolUse` — fires before Bash tool invocations that reference `.ts`/`.tsx` files and blocks if the command would write to a TypeScript file.

## When It Fires

- A Bash tool is about to execute
- The command string contains a `.ts` or `.tsx` file reference
- The command contains a write pattern targeting a TypeScript file (redirect, sed -i, tee, cp, or mv)

It does **not** fire when:

- The tool is not Bash
- The command does not reference any `.ts`/`.tsx` files
- The command only reads TypeScript files (e.g., `cat file.ts`, `grep pattern file.ts`)
- The command references `.ts` files but does not use a write pattern

## What It Does

1. Extracts the command string from the tool input
2. Checks if the command references a `.ts`/`.tsx` file (if not, `accepts` returns false)
3. Checks for write patterns targeting TypeScript files:
   - Output redirection: `> file.ts` or `>> file.ts`
   - In-place sed: `sed -i` with a `.ts` file in the command
   - Tee: `tee file.ts` or `tee -a file.ts`
   - Copy/move: `cp`/`mv` with a `.ts`/`.tsx` destination (last argument)
4. If no write pattern is detected, returns `continue`
5. If a write pattern is detected, formats a block message explaining why the command is blocked and returns `block`

```typescript
// Core detection patterns
if (/>{1,2}\s*\S*\.tsx?\b/.test(command)) return true;  // redirect
if (/\bsed\b.*-i\b/.test(command) && TS_FILE_PATTERN.test(command)) return true;  // sed -i
if (/\btee\b/.test(command) && TS_FILE_PATTERN.test(teeTarget)) return true;  // tee
if (/\b(?:cp|mv)\b/.test(command) && TS_FILE_PATTERN.test(lastArg)) return true;  // cp/mv
```

## Examples

### Example 1: Redirect to TypeScript file blocked

> The model attempts to run `echo 'export const x = 1;' > src/config.ts`. BashWriteGuard detects the output redirection targeting a `.ts` file and blocks: "Use the Edit or Write tool instead. Those tools are monitored by CodingStandardsEnforcer which ensures code meets coding standards."

### Example 2: Reading TypeScript files allowed

> The model runs `cat src/utils.ts | grep "export"`. BashWriteGuard checks the command, finds no write patterns, and returns `continue` -- read-only Bash operations on TypeScript files are allowed.

### Example 3: sed in-place blocked

> The model attempts `sed -i 's/old/new/g' src/handler.ts`. BashWriteGuard detects the `sed -i` pattern with a `.ts` file and blocks the command.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result-based returns |
| `narrative-reader` | lib | `pickNarrative` for block message opener |
