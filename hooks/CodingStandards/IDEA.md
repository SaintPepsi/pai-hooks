# Coding Standards

> Enforce coding patterns at write-time by intercepting file operations and blocking violations before code lands.

## Problem

Coding standards drift when enforcement only happens during code review or CI — by then the bad pattern is already written and the author has to context-switch back to fix it. AI assistants make this worse because they confidently produce code that compiles but violates project conventions. Post-hoc linting catches syntax issues but misses architectural rules like "don't call I/O directly" or "don't use try-catch for flow control."

## Solution

A suite of pre-write checks that intercept file creation and modification at the moment of writing. Each check targets a specific class of violation — forbidden syntax, bypassed safety channels, architectural anti-patterns — and blocks the write with a clear explanation and fix guidance. An advisory companion scans files on read so the author knows about violations before they start editing.

## How It Works

1. When a file is about to be written or edited, the relevant guards activate based on file type and operation.
2. Each guard simulates the final file state (applying partial edits to the existing content) and scans for violations.
3. If violations are found, the write is blocked with a message explaining what was wrong and how to fix it.
4. An advisory check runs when files are read, warning about existing violations so authors can plan fixes proactively.
5. After a successful write, a type checker runs to verify the change didn't introduce type errors.

## Signals

- **Input:** File path, operation type (read/write/edit), and file content on every code file operation
- **Output:** Block (with violation details and fix guidance), warn (advisory for existing violations), or pass

## Context

This pattern works best in teams or AI-assisted workflows where many contributors write code without internalizing every project convention. The warn-then-enforce model (advise on read, block on write) reduces frustration by giving advance notice.

## Test Helpers

`hooks/CodingStandards/test-helpers.ts` exposes shared narrowing helpers for guard tests post-SDK Type Foundation refactor: `getPreToolUseDenyReason`, `isPreToolUseAsk`, `getPreToolUseAskReason`, plus advisory-context accessors for `hookSpecificOutput.additionalContext`. These centralize the discriminated-union narrowing on `SyncHookJSONOutput` so individual guard tests don't duplicate the `hookEventName === "PreToolUse"` check before accessing `permissionDecision` or `additionalContext`. Also consumed by GitSafety tests after the 1D migration (commit f432c3b).
