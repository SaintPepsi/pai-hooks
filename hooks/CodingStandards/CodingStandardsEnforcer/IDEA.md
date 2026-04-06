# Coding Standards Enforcer

> Block code writes that violate architectural coding patterns.

## Problem

Codebases accumulate anti-patterns when there's no automated enforcement of architectural rules. Developers and AI assistants write code that compiles but violates conventions: calling I/O libraries directly instead of through wrappers, using try-catch for flow control instead of result types, hardcoding configuration, using unsafe type casts. Linters catch syntax issues but miss these deeper architectural violations.

## Solution

Intercept every file write and edit operation on code files, simulate the resulting file state, and scan for architectural violations. If the final file would contain any violations, block the operation with a categorized list of problems and specific fix guidance. Log all violations for trend analysis.

## How It Works

1. When a code file is about to be written or edited, determine the full file content that would result from the operation.
2. For partial edits, read the existing file and apply the edit to produce the complete result.
3. Scan the resulting content against a set of architectural rules (raw I/O imports, try-catch flow control, hardcoded config, unsafe casts, etc.).
4. If the file is clean, allow the write.
5. If violations are found, block the write with a categorized message showing each violation's line, content, and required fix.
6. Log blocked violations to a signal file for pattern analysis over time.

## Signals

- **Input:** File path, operation type (write or edit), and the content being written
- **Output:** Block (with violation details grouped by category and fix guidance) or pass

## Context

This is the "enforce" side of a warn-then-enforce pattern. A companion advisor warns about violations when files are read, so authors are informed before they attempt writes that would be blocked.
