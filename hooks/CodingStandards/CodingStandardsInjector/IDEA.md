## Problem

When AI assistants modify code, they lack awareness of project-specific conventions. Each project has its own patterns, naming conventions, and architectural rules that aren't captured in the language specification or general best practices.

## Solution

Inject configured documentation files as context before the first code modification. The assistant sees the standards before writing any code, not after violations occur.

## How It Works

1. Configuration declares a list of standards file paths
2. On first code-modifying action, read all configured files
3. Inject combined content as additional context for the assistant
4. Skip injection on subsequent actions (session dedup)

## Signals

**Input:**
- Tool use event (code modification tools only)
- Configuration: array of file paths
- Session state: whether injection already occurred

**Output:**
- Additional context containing standards content
- Or silent pass-through if already injected / not configured

## Context

This differs from enforcement hooks that block violations. Injection is proactive — the assistant has the information before acting, reducing the need for correction cycles.

Size limits prevent context bloat. Session deduplication prevents redundant injection on every tool call.
