# Type Check Verifier

> Run the project's type checker after code changes and surface real type errors.

## Problem

After editing a code file, it's common to assume the change is type-safe without actually running the type checker. AI assistants are especially prone to this — they confidently declare "this should compile" without verification. Real type errors get discovered much later, often after more code has been built on top of the broken change.

## Solution

Automatically run the project's type checker after every code file modification and surface any type errors for the edited file as advisory feedback. The verifier discovers the correct type-check command by walking up the directory tree, respects project-specific configurations, and debounces to avoid redundant runs.

## How It Works

1. After a code file is written or edited, walk up the directory tree to find the project root and its type-check command.
2. Run the type checker with a timeout to prevent blocking on large projects.
3. Parse the output and extract only the errors relevant to the file that was just changed.
4. If errors are found, inject them as advisory context with line numbers and messages.
5. Debounce per file so the same file isn't re-checked within a cooldown window.

## Signals

- **Input:** File path after a code file is written or edited
- **Output:** Advisory context listing type errors (if any), or nothing for clean files

## Context

This guard never blocks writes — it provides feedback after the fact. The key insight is "don't trust claims, run the checker." The verifier discovers the type-check command automatically, supporting multiple toolchains and frameworks.
