# WorkCompletionLearning

## Overview

WorkCompletionLearning bridges the WORK/ and LEARNING/ memory systems. When a session ends with significant work (files changed, multiple tasks, or manual work), it reads the work directory's META.yaml and ISC.json, then creates a structured learning file capturing what was done, how long it took, and what criteria were satisfied.

The learning files are organized by category (SYSTEM or ALGORITHM) and month, providing a persistent record that downstream hooks like LearningActioner can analyze for improvement proposals.

## Event

`SessionEnd` — fires when a Claude Code session ends, capturing learning signals from the session's completed work before state is cleared.

## When It Fires

- A session-scoped state file (`current-work-{session_id}.json`) exists in MEMORY/STATE/
- The state file belongs to the current session (session IDs match)
- The work directory has a valid META.yaml
- The session had significant work: files changed > 0, task count > 1, or source is MANUAL

It does **not** fire when:

- No session-scoped state file exists for the current session
- The state file belongs to a different session
- No work directory is recorded in the current session state
- No META.yaml exists in the work directory
- The session was trivial (no files changed, single task, non-manual source)
- A learning file for this exact work already exists

## What It Does

1. Reads the session-scoped state file from `MEMORY/STATE/current-work-{session_id}.json`
2. Validates the state file belongs to the current session
3. Reads `META.yaml` from the work directory and parses YAML frontmatter (title, timestamps, lineage)
4. Reads `ISC.json` for criteria, anti-criteria, and satisfaction scores
5. Checks if the work was significant (files changed, task count, or manual source)
6. Determines the learning category (SYSTEM or ALGORITHM) from the work title
7. Writes a structured markdown learning file to `MEMORY/LEARNING/{category}/{YYYY-MM}/`

```typescript
// Core flow: bridge WORK/ metadata to LEARNING/ files
const workMeta = parseYaml(metaContent);
const category = deps.getLearningCategory(workMeta.title);
const filepath = join(monthDir, `${dateStr}_${timeStr}_work_${titleSlug}.md`);
deps.writeFile(filepath, content);
```

## Examples

### Example 1: Significant session with ISC criteria

> You complete a session where 5 files were changed and the ISC.json has 3 satisfied criteria out of 4 total, with 1 partial. At session end, WorkCompletionLearning creates `MEMORY/LEARNING/SYSTEM/2026-03/2026-03-28_1430_work_refactor-auth-middleware.md` containing the title, duration, category, criteria summary, and lineage (files changed, tools used, agents spawned).

### Example 2: Trivial session skipped

> You have a short session where you only asked a question and no files were changed. The state file shows task_count of 1 and the META.yaml lineage has zero files_changed. WorkCompletionLearning logs "Trivial work session, skipping learning capture" and returns silent.

## Dependencies

| Dependency                       | Type      | Purpose                                                 |
| -------------------------------- | --------- | ------------------------------------------------------- |
| `core/adapters/fs`               | adapter   | File system operations (read, write, exists, ensureDir) |
| `lib/time`                       | lib       | ISO timestamp and local date generation                 |
| `lib/learning-utils`             | lib       | Categorizes learnings as SYSTEM or ALGORITHM            |
| `core/result`                    | core      | Result type for error handling                          |
| `@anthropic-ai/claude-agent-sdk` | SDK types | `SyncHookJSONOutput` return type (post-SDK-refactor)    |
