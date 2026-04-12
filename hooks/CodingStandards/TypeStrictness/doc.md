# TypeStrictness

## Overview

TypeStrictness is a **PreToolUse** hook that hard-blocks any use of the `any` type in TypeScript files. It scans new content from Edit and Write operations, stripping comments and string literals first, then detecting patterns like `: any`, `as any`, `<any>`, `any[]`, and union/intersection forms. When `any` is found, the hook blocks with detailed fix guidance that directs the model to find the correct type rather than using `any`.

As a secondary check, when no `any` violations are found, the hook also warns about "lazy `unknown`" usage -- cases where `unknown` appears to be used as a quick `any` replacement without proper type narrowing. This secondary check is advisory only (returns `continue` with `additionalContext`).

## Event

`PreToolUse` — fires before Edit or Write operations on TypeScript files and blocks if the new content contains `any` type usage.

## When It Fires

- An Edit or Write tool targets a `.ts`, `.tsx`, or `.svelte` file
- The new content (Write content or Edit `new_string`) contains `any` type patterns after stripping comments and strings
- For the advisory lazy-unknown check: the content has no `any` but contains bare `unknown` that is not in an exempted context

It does **not** fire when:

- The tool is not Edit or Write
- The target file is not a TypeScript or Svelte file
- The new content is empty or null
- No `any` type patterns are found in the stripped content
- Uses of `any` appear only inside comments, string literals, or regex literals

## What It Does

1. Extracts the file path and new content from the tool input (Write: full content, Edit: `new_string`)
2. For Svelte files, extracts only the `<script lang="ts">` block
3. Strips comments, string literals, template literals, and regex literals from the content
4. Scans each line for `any` type patterns (`: any`, `as any`, `<any>`, `any[]`, `| any`, `any &`, etc.)
5. Logs the outcome (block or continue) to the signal logger (`type-strictness.jsonl`)
6. If `any` violations found: returns a `SyncHookJSONOutput` with `hookSpecificOutput.permissionDecision: "deny"` (R4 canonical PreToolUse block channel) and line numbers + fix guidance as `permissionDecisionReason`
7. If no `any` but lazy `unknown` detected: returns `{ continue: true, hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } }` (R2 advisory channel) warning against band-aid fixes
8. If fully clean: returns `{ continue: true }` silently

```typescript
// Core detection: strip non-code, then scan for any patterns
const stripped = stripCommentsAndStrings(content);
const violations = findAnyViolations(content);

if (violations.length > 0) {
  return ok({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: formatBlockMessage(violations, filePath),
    },
  });
}

// Secondary: warn about lazy unknown usage
const unknownWarnings = findLazyUnknownUsage(content);
if (unknownWarnings.length > 0) {
  return ok({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: formatLazyUnknownAdvisory(...),
    },
  });
}
```

## Examples

### Example 1: `any` type annotation blocked

> The model writes a function with `function parse(data: any)`. TypeStrictness detects `: any` on line 5 and blocks: "1 `any` type violation in src/parser.ts: Line 5: function parse(data: any) -- type annotation `: any`". The block message instructs the model to read the type definitions and find the correct type.

### Example 2: Lazy `unknown` advisory

> The model replaces `any` with `unknown` in `value: unknown` without adding a type guard. TypeStrictness passes the `any` check but detects the bare `unknown` and injects an advisory: "Do not use `unknown` as a quick replacement for `any`. Take time to find the correct type."

### Example 3: `any` in comments is safe

> The model writes a file with `// TODO: remove any usage` in a comment. TypeStrictness strips comments before scanning, so the word "any" in the comment is not detected. The file passes cleanly.

## Dependencies

| Dependency                       | Type      | Purpose                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `result`                         | core      | `ok()` for Result-based returns                                                                                                                                                                                                                                                                                                     |
| `signal-logger`                  | lib       | Logs violations and outcomes to JSONL for analysis                                                                                                                                                                                                                                                                                  |
| `narrative-reader`               | lib       | `pickNarrative` for escalating block message tone                                                                                                                                                                                                                                                                                   |
| `svelte-utils`                   | lib       | `isSvelteFile`, `extractSvelteScript` for Svelte support                                                                                                                                                                                                                                                                            |
| `@anthropic-ai/claude-agent-sdk` | SDK types | `SyncHookJSONOutput` return type; R4 PreToolUse block via `hookSpecificOutput.permissionDecision: "deny"`, R2 PreToolUse advisory via `hookSpecificOutput.additionalContext` (post-SDK-refactor, fixes a bug where the legacy top-level `additionalContext` from `continueOk(advisory)` was silently dropped for PreToolUse events) |
