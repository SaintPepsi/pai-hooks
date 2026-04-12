# CodingStandardsAdvisor

## Overview

CodingStandardsAdvisor is a **PostToolUse** hook that scans TypeScript files after they are read and injects advisory context about coding standard violations. It is the "warn" side of the warn-then-enforce pattern: CodingStandardsAdvisor advises after Read so the model can plan fixes, while CodingStandardsEnforcer blocks on Write/Edit to prevent new violations.

This hook is silent for clean files (zero context cost). It only injects `additionalContext` when violations are found. It also supports Svelte files by extracting and checking only the `<script lang="ts">` block.

## Event

`PostToolUse` — fires after a Read operation on a TypeScript file and warns about any coding standard violations found in the file content.

## When It Fires

- A Read tool has just completed on a `.ts`, `.tsx`, or `.svelte` file
- The file is not an adapter file (not in an `adapters/` directory or named `adapter(s).ts`)
- The file is not auto-generated
- The file is not in the skipped filenames list
- The file content contains at least one coding standard violation

It does **not** fire when:

- The tool is not Read
- The target file is not a TypeScript or Svelte file
- The file is an adapter file (these legitimately wrap Node builtins)
- The file is auto-generated or has a skipped filename
- The file is clean (no violations found)
- The file cannot be read from disk

## What It Does

1. Extracts the file path from the tool input
2. Reads the file content from disk
3. For Svelte files, extracts only the `<script lang="ts">` block
4. Runs `findAllViolations()` against the content to detect raw Node imports, try-catch flow control, direct `process.env` access, and other violations
5. If no violations are found, logs "clean" to stderr and returns `{ continue: true }` silently
6. If violations are found, formats a violation summary and returns it as `hookSpecificOutput.additionalContext` with `hookEventName: "PostToolUse"` (R2 PostToolUse context-injection channel)

```typescript
// Core advisory flow
const content = deps.readFile(filePath);
const violations = findAllViolations(content, filePath);

if (violations.length > 0) {
  const advisory = formatViolationSummary(violations, filePath);
  return ok({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: advisory,
    },
  });
}
```

## Examples

### Example 1: File with raw Node imports

> The model reads `src/fileManager.ts` which contains `import fs from "fs"`. CodingStandardsAdvisor detects the raw Node builtin import and injects an advisory: "1 violation in src/fileManager.ts: Raw Node builtin import on line 3. Use an adapters/ wrapper instead." The model can now plan the fix before attempting an edit.

### Example 2: Clean file

> The model reads `src/utils.ts` which follows all coding standards. CodingStandardsAdvisor finds zero violations, logs "clean" to stderr, and returns `continue` with no additional context -- zero cost to the conversation.

## Dependencies

| Dependency                       | Type      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `result`                         | core      | `ok()` for Result-based returns                                                                                                                                                                                                                                                                                                                                                                                   |
| `fs`                             | adapter   | `readFile` for reading file content                                                                                                                                                                                                                                                                                                                                                                               |
| `coding-standards-checks`        | lib       | `findAllViolations`, `formatViolationSummary`, file classification helpers                                                                                                                                                                                                                                                                                                                                        |
| `svelte-utils`                   | lib       | `isSvelteFile`, `extractSvelteScript` for Svelte support                                                                                                                                                                                                                                                                                                                                                          |
| `@anthropic-ai/claude-agent-sdk` | SDK types | `SyncHookJSONOutput` return type; `hookSpecificOutput.additionalContext` with `hookEventName: "PostToolUse"` is the PostToolUse-compatible context injection channel (post-SDK-refactor, fixes a bug where the legacy top-level `additionalContext` from `continueOk(advisory)` was silently dropped for PostToolUse events — same bug class as PreCompactStatePersist 1A fix, applied here via R2 instead of R3) |
