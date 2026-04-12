# WhileLoopGuard

## Overview

WhileLoopGuard is a **PreToolUse** hook that blocks `while` and `do...while` loops in code files. It uses state-checking: simulates the full file after the Write or Edit operation, then checks for while loop syntax using comment-aware regex. This enforces the PAI steering rule "No While Loops" which requires deterministic bounded constructs (`for`, `for-of`, `.map`, `.filter`) instead.

Detection strips comments and string literals before matching `\bwhile\b`, so it catches `while()`, `do...while()`, and language variants like Python's `while cond:` without false positives from words like "meanwhile" or "worthwhile" in string literals.

## Event

`PreToolUse` — fires before Write and Edit tool invocations targeting code files (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.c`, `.cpp`, `.rb`, `.swift`, `.kt`, `.sh`).

## When It Fires

- A Write or Edit tool is about to execute
- The target file has a code file extension
- The hook simulates the resulting file state and checks for while loops

It does **not** fire when:

- The tool is not Write or Edit
- The target file is not a code file (e.g., `.md`, `.json`, `.yaml`)
- The file path cannot be determined from tool_input

## What It Does

1. Extracts the file path from tool_input
2. Checks if the file has a code extension via `accepts()`
3. For **Write**: checks the `content` field directly
4. For **Edit**: reads the existing file, simulates the edit (replacing `old_string` with `new_string`), and checks the resulting content
5. Strips comments (single-line `//`, block `/* */`, hash `#`) and string literals (single, double, backtick) from the content
6. Tests the stripped content for `\bwhile\b` regex match
7. If a while loop is found, returns a `SyncHookJSONOutput` with `hookSpecificOutput.permissionDecision: "deny"` (R4 PreToolUse block) and a `permissionDecisionReason` explaining the violation and suggesting alternatives
8. If no while loop is found, returns `{ continue: true }`

```typescript
// Core detection (after stripping comments and strings)
function containsWhileLoop(strippedCode: string): boolean {
  return /\bwhile\b/.test(strippedCode);
}
```

## Examples

### Example 1: Write with while loop blocked

> The model writes a file containing `while (items.length > 0) { process(items.pop()); }`. WhileLoopGuard strips comments/strings, finds `\bwhile\b`, and blocks: "Use a for loop with known bounds, for-of over collections, or Array methods instead."

### Example 2: Edit that removes while loop allowed

> A file contains a while loop. The model edits to replace `while (x > 0) { x--; }` with `for (let i = x; i > 0; i--) { }`. WhileLoopGuard simulates the resulting file, finds no while loops, and returns `continue`.

### Example 3: "meanwhile" in a string allowed

> The model writes `const msg = 'meanwhile, back at the ranch';`. WhileLoopGuard strips string literals before matching, so "meanwhile" inside quotes is not detected. Returns `continue`.

## Dependencies

| Dependency                       | Type      | Purpose                                                                                                                                                               |
| -------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/adapters/fs`               | adapter   | `readFile` for reading existing file content during Edit state-checking                                                                                               |
| `core/result`                    | core      | `ok()` for Result-based returns                                                                                                                                       |
| `@anthropic-ai/claude-agent-sdk` | SDK types | `SyncHookJSONOutput` return type; R4 PreToolUse block via `hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason }` |
