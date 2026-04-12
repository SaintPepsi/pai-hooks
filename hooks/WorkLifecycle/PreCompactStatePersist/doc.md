# PreCompactStatePersist

## Overview

PreCompactStatePersist preserves active PRD state before Claude Code compacts the conversation context. When the context window fills up and compaction occurs, the AI loses awareness of what task it was working on. This hook finds the most recently modified PRD.md under MEMORY/WORK/, reads its frontmatter, and injects a summary into the compacted context via `systemMessage` so the AI retains task, phase, and progress awareness after the reset.

The hook always returns `continue` and never blocks compaction. Any read errors fail open with no context injection.

## Event

`PreCompact` — fires just before Claude Code compacts the conversation context, injecting PRD state so task awareness survives the compaction.

## When It Fires

- A PreCompact event occurs (context window is about to be compacted)
- At least one MEMORY/WORK/ subdirectory contains a PRD.md file
- The most recently modified PRD.md has valid YAML frontmatter with a task or slug field

It does **not** fire when:

- No MEMORY/WORK/ directory exists or it contains no subdirectories
- No PRD.md files exist in any work subdirectory
- The most recent PRD.md has no YAML frontmatter
- The frontmatter is missing both task and slug fields

## What It Does

1. Scans all subdirectories under MEMORY/WORK/ for PRD.md files
2. Finds the most recently modified PRD.md by comparing file modification times
3. Reads the file and parses YAML frontmatter for task, phase, progress, and slug
4. Builds a context summary string with the active PRD state
5. Returns `continue` with `systemMessage` containing the summary

```typescript
// Find most recent PRD, inject its state into compacted context
const prdPath = findMostRecentPrd(workDir, deps);
const fm = parseFrontmatter(readResult.value);
const summary = buildContextSummary({ task, phase, progress, slug });
return ok({ continue: true, systemMessage: summary });
```

## Examples

### Example 1: Active task preserved through compaction

> You are 45 minutes into a session working on "refactor-auth" in the BUILD phase with 3/5 criteria done. The context window fills and compaction triggers. PreCompactStatePersist reads the PRD.md frontmatter and injects: "[PreCompact] Active PRD state persisted before compaction: Task: Refactor auth middleware, Slug: refactor-auth, Phase: BUILD, Progress: 3/5". After compaction, the AI knows what it was working on.

### Example 2: No active work

> You start a fresh session and trigger compaction before creating any work directories. PreCompactStatePersist finds no PRD.md files under MEMORY/WORK/ and returns continue with no additional context.

## Dependencies

| Dependency                       | Type      | Purpose                                                                                                                                                                                                                    |
| -------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/adapters/fs`               | adapter   | Directory listing, file reading, stat for modification times                                                                                                                                                               |
| `core/result`                    | core      | Result type for error handling                                                                                                                                                                                             |
| `@anthropic-ai/claude-agent-sdk` | SDK types | `SyncHookJSONOutput` return type; `systemMessage` is the PreCompact-compatible context injection channel (post-SDK-refactor, fixes a bug where `additionalContext` was silently dropped for non-hookSpecificOutput events) |
