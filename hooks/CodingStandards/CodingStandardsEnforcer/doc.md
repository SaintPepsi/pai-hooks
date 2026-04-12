# CodingStandardsEnforcer

## Overview

CodingStandardsEnforcer is a **PreToolUse** hook that hard-blocks Edit and Write operations on TypeScript files when the resulting content violates coding standards. It checks for raw Node builtin imports, try-catch flow control, direct `process.env` access, inline import types, unsafe `as any` casts, relative imports, and default exports.

This hook is the "enforce" side of the warn-then-enforce pattern. CodingStandardsAdvisor warns after Read so the model can plan fixes, while this hook blocks before Write/Edit to prevent new violations from being committed. For Edit operations, it reads the current file, simulates the edit, and checks the entire resulting file -- this prevents surgical edits from bypassing enforcement on files with existing violations.

## Event

`PreToolUse` — fires before Edit or Write operations on TypeScript files and blocks if the resulting content would contain coding standard violations.

## When It Fires

- An Edit or Write tool targets a `.ts`, `.tsx`, or `.svelte` file
- The file is not an adapter file (not in an `adapters/` directory or named `adapter(s).ts`)
- The file is not auto-generated or in the skipped filenames list
- The resulting content contains at least one coding standard violation

It does **not** fire when:

- The tool is not Edit or Write
- The target file is not a TypeScript or Svelte file
- The file is an adapter file (these legitimately wrap Node builtins)
- The file is auto-generated or has a skipped filename
- The resulting content is clean (no violations)

## What It Does

1. Extracts the file path from the tool input
2. Determines the full file content that would exist after the operation:
   - For Write: uses the new content directly
   - For Edit: reads the current file from disk, applies the string replacement, and checks the entire result
3. For Svelte files, extracts only the `<script lang="ts">` block
4. Runs `findAllViolations()` against the content
5. If violations are found, logs them to the signal logger (`coding-standards-violations.jsonl`)
6. Formats a block message with an escalating narrative opener, grouped violations by category, and specific fix guidance
7. Returns a `SyncHookJSONOutput` with `hookSpecificOutput.permissionDecision: "deny"` (R4 canonical PreToolUse block) and the formatted reason as `permissionDecisionReason`

```typescript
// Core enforcement flow (Edit simulation)
const currentFile = deps.readFile(filePath);
const contentToCheck = applyEdit(
  currentFile,
  editParts.oldStr,
  editParts.newStr,
);
const violations = findAllViolations(contentToCheck, filePath);

if (violations.length > 0) {
  return ok({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: formatBlockMessage(violations, filePath),
    },
  });
}
```

## Examples

### Example 1: Raw Node import blocked

> The model attempts to write a file containing `import { readFileSync } from "fs"`. CodingStandardsEnforcer detects the raw Node builtin import and blocks: "1 violation in src/loader.ts: Raw Node builtin imports (use an adapters/ wrapper instead): Line 1: import { readFileSync } from 'fs'".

### Example 2: Edit on file with existing violations

> The model edits line 50 of a file that already has a `try-catch` violation on line 10. CodingStandardsEnforcer reads the full file, applies the edit, and checks the entire result. The existing try-catch violation is caught even though the edit did not touch it, forcing the model to fix all violations.

### Example 3: Adapter file excluded

> The model writes to `core/adapters/fs.ts` which legitimately wraps Node builtins. CodingStandardsEnforcer recognizes this as an adapter file and skips enforcement entirely.

## Dependencies

| Dependency                       | Type      | Purpose                                                                                                                                                               |
| -------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `result`                         | core      | `ok()` for Result-based returns                                                                                                                                       |
| `fs`                             | adapter   | `readFile` for reading current file content on Edit                                                                                                                   |
| `coding-standards-checks`        | lib       | `findAllViolations`, file classification helpers                                                                                                                      |
| `signal-logger`                  | lib       | Logs violations to JSONL for pattern analysis                                                                                                                         |
| `narrative-reader`               | lib       | `pickNarrative` for escalating block message tone                                                                                                                     |
| `svelte-utils`                   | lib       | `isSvelteFile`, `extractSvelteScript` for Svelte support                                                                                                              |
| `@anthropic-ai/claude-agent-sdk` | SDK types | `SyncHookJSONOutput` return type; R4 PreToolUse block via `hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason }` |
