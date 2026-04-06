# While Loop Guard

> Block while loops to prevent unbounded iteration in code.

## Problem

While loops create a class of bugs where termination depends on runtime conditions that may never be met, causing hangs, infinite loops, and resource exhaustion. AI assistants are particularly prone to generating while loops for tasks that have cleaner bounded alternatives. Once a while loop is in the codebase, proving it terminates requires understanding every path that modifies its condition.

## Solution

Intercept file writes and edits, simulate the resulting file content, strip comments and string literals to avoid false positives, and scan for while loop syntax. If the resulting file would contain a while or do-while loop, block the write and suggest deterministic alternatives.

## How It Works

1. When a code file is about to be written or edited, determine the full file content that would result.
2. Strip all comments and string literals from the content to avoid matching while-keywords in non-code contexts.
3. Use language-aware stripping (C-style comments for most languages, hash comments for Python/Ruby).
4. Scan the stripped content for while-loop syntax.
5. If found, block the write and suggest alternatives: for loops with known bounds, collection iteration, array methods, or bounded recursion.

## Signals

- **Input:** File path and content when a code file is written or edited
- **Output:** Block (with alternative suggestions) or pass
