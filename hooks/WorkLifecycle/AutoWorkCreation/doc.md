# AutoWorkCreation

## Overview

AutoWorkCreation automatically creates MEMORY/WORK session directories and task structures when the user submits a prompt. On the first real prompt of a session, it creates a timestamped session directory with META.yaml, a task subdirectory with a PRD template and ISC.json, and writes a session-scoped state file. On subsequent prompts, it classifies whether the prompt is a continuation or conversational filler.

This hook is the entry point of the work lifecycle, creating the directory structure that PRDSync, WorkCompletionLearning, ArticleWriter, and SessionSummary all depend on.

## Event

`UserPromptSubmit` — fires when the user submits a prompt, creating work directories for new sessions and classifying prompts for existing ones.

## When It Fires

- The user submits a prompt with 2 or more characters
- For new sessions: no existing session-scoped state file matches the current session_id
- For existing sessions: runs classification but only creates new structures for new topics

It does **not** fire when:

- The prompt is less than 2 characters
- The prompt is conversational filler in an existing session (e.g., "yes", "ok", "thanks", "continue", single numbers)

## What It Does

1. Reads the session-scoped state file (`current-work-{session_id}.json`) to check for an existing session
2. Classifies the prompt as "work", "question", or "conversational" with effort level and new-topic detection
3. For new sessions:
   - Creates a timestamped session directory under MEMORY/WORK/ (e.g., `20260328-143025_refactor-auth`)
   - Creates `tasks/` and `scratch/` subdirectories
   - Writes META.yaml with session metadata
   - Creates the first task directory (e.g., `001_refactor-auth`)
   - Generates a PRD template and ISC.json in the task directory
   - Creates a `current` symlink pointing to the active task
   - Writes the session state file to MEMORY/STATE/
4. For conversational continuations: returns silent with no changes

```typescript
// Classify prompt, create work structure for new sessions
const classification = classifyPrompt(prompt, !!isExistingSession);
if (!isExistingSession) {
  const sessionDirName = `${timestamp}_${slugify(title, 50)}`;
  deps.ensureDir(join(sessionPath, "tasks"));
  deps.writeFile(join(sessionPath, "META.yaml"), meta);
  deps.writeFile(join(taskPath, prdFilename), prdContent);
  deps.writeFile(join(taskPath, "ISC.json"), JSON.stringify(isc, null, 2));
}
```

## Examples

### Example 1: First prompt creates full work structure

> You start a new session and type "Refactor the auth middleware to use JWT". AutoWorkCreation creates `MEMORY/WORK/20260328-143025_refactor-the-auth-middleware/` with META.yaml, `tasks/001_refactor-the-auth-middleware/` containing PRD.md and ISC.json, a `current` symlink, and `MEMORY/STATE/current-work-{session_id}.json`.

### Example 2: Conversational prompt skipped

> Mid-session, you type "ok". AutoWorkCreation classifies this as conversational, logs "Conversational continuation, no new task", and returns silent without creating any directories.

## Dependencies

| Dependency                       | Type      | Purpose                                                  |
| -------------------------------- | --------- | -------------------------------------------------------- |
| `core/adapters/fs`               | adapter   | Directory creation, file writes, symlinks, stat          |
| `lib/time`                       | lib       | Timestamp and local date components for directory naming |
| `lib/prd-template`               | lib       | PRD markdown template and filename generation            |
| `core/result`                    | core      | Result type for error handling                           |
| `@anthropic-ai/claude-agent-sdk` | SDK types | `SyncHookJSONOutput` return type (post-SDK-refactor)     |
