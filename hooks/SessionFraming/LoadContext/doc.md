# LoadContext

## Overview

LoadContext is an **async SessionStart** hook that loads the full PAI context into a new Claude Code session. It rebuilds `SKILL.md` if any components have changed, loads context files (SKILL.md, AISTEERINGRULES.md, user rules), injects relationship context and coding standards, scans for active work sessions from the last 48 hours, surfaces pending improvement proposals, and wraps everything into a `<system-reminder>` block.

This is the primary context injection hook, responsible for establishing the agent's identity, session awareness, and knowledge of active work. It skips entirely for subagent sessions.

## Event

`SessionStart` — fires when a new Claude Code session begins, loading the full PAI context including identity, rules, relationship notes, active work, and pending proposals.

## When It Fires

- Every session start for main sessions (accepts always returns true)
- Rebuilds SKILL.md only if component files or settings.json are newer than the existing SKILL.md

It does **not** fire when:

- The session is a subagent (detected via `CLAUDE_PROJECT_DIR` containing `/.claude/Agents/` or `CLAUDE_AGENT_TYPE` being set)
- No context files exist (returns silent if no content is loaded)

## What It Does

1. Checks if the session is a subagent; if so, returns `silent` immediately
2. Reads or preserves tab state (keeps title through compaction if already working/thinking)
3. Records the session start for notification tracking
4. Checks if SKILL.md needs rebuilding by comparing component file timestamps
5. If rebuild is needed, runs `RebuildPAI.ts` to regenerate SKILL.md from components
6. Loads settings.json and reads context files (SKILL.md, AISTEERINGRULES.md, user rules)
7. Loads coding standards from `PAI/SYSTEM/CODINGSTANDARDS/` (general.md, hooks.md, skills.md)
8. Loads relationship context: high-confidence opinions and recent relationship notes
9. Builds a `<system-reminder>` block with date, session ID, identity rules, and all loaded context
10. Scans `MEMORY/WORK/` for active work sessions from the last 48 hours
11. Checks for pending improvement proposals in `MEMORY/LEARNING/PROPOSALS/pending/`
12. Combines all parts and returns as `ContextOutput`

```typescript
// Core context assembly
const settings = loadSettings(deps.baseDir, deps);
const contextContent = loadContextFiles(deps.baseDir, settings, deps);
const relationshipContext = loadRelationshipContext(deps.baseDir, deps);
const codingStandards = loadCodingStandards(deps.baseDir, deps);
const activeWork = buildActiveWorkSummary(deps.baseDir, deps);
const proposals = loadPendingProposals(deps.baseDir, deps);
```

## Examples

### Example 1: Full context load with active work

> A new main session starts. LoadContext detects SKILL.md is up to date, loads three context files (5,200 chars total), finds two high-confidence user opinions, discovers three active work sessions from the last 48 hours, and two pending improvement proposals. It assembles everything into a system-reminder block with identity rules, relationship context, active work summary, and proposal review instructions.

### Example 2: Subagent session skipped

> A subagent is spawned to handle a parallel task. LoadContext detects `CLAUDE_AGENT_TYPE` in the environment, logs "Subagent session - skipping PAI context loading" to stderr, and returns silent. The subagent operates without PAI context injection.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `fs` | adapter | File operations: exists, read, readJson, readDir, stat |
| `process` | adapter | Provides `exec` and `execSyncSafe` for shell commands and SKILL.md rebuild |
| `tab-setter` | lib | Manages terminal tab state (title, color) across sessions |
| `identity` | lib | Provides `getDAName` for the assistant identity name |
| `notifications` | lib | Provides `recordSessionStart` for notification tracking |
| `error` | core | Provides `unknownError` for wrapping unexpected errors |
| `result` | core | Provides `ok`, `Result`, and `tryCatch` for error handling |
