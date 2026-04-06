# Coding Standards Advisor

> Warn about coding standard violations when files are read, before any editing begins.

## Problem

When coding standard enforcement only happens at write-time, authors waste effort: they read a file, plan changes, write code, and only then discover that violations exist. The write gets blocked, they have to re-read the violations, and re-plan. This is especially wasteful for AI assistants that generate entire file rewrites.

## Solution

Scan files for coding standard violations at read-time and inject advisory warnings into the author's context. This way, the author sees existing violations before they start editing and can plan fixes proactively. The advisor never blocks — it only informs.

## How It Works

1. When a code file is read, scan its content against a set of coding standard rules.
2. If the file is clean, stay silent (zero noise for compliant files).
3. If violations are found, format a summary listing each violation's location and category.
4. Inject the summary as advisory context so the author sees it alongside the file content.
5. Skip files that are legitimately exempt (adapter wrappers, auto-generated code).

## Signals

- **Input:** File path and content when a code file is read
- **Output:** Advisory context listing violations (if any), or nothing for clean files
