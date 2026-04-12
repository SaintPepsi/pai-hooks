# PRDSync

## Overview

PRDSync keeps the central `work.json` dashboard file in sync with PRD.md frontmatter and criteria checkboxes. Whenever a PRD file under MEMORY/WORK/ is written or edited, this hook reads the YAML frontmatter (task, slug, effort, phase, progress, mode, timestamps) and counts checked/unchecked criteria checkboxes, then upserts an entry in `MEMORY/STATE/work.json` keyed by slug.

It also updates the session state file (`current-work-{sessionId}.json`) to point to the correct work directory, enabling downstream hooks like ArticleWriter and WorkCompletionLearning to locate the session's PRD.

## Event

`PostToolUse` — fires after a Write or Edit tool call targets a file matching `MEMORY/WORK/**/PRD.md`, syncing the PRD state to the dashboard.

## When It Fires

- The tool used is `Write` or `Edit`
- The file path in `tool_input.file_path` contains `MEMORY/WORK/` and ends with `PRD.md`

It does **not** fire when:

- The tool is anything other than Write or Edit
- The file path does not match the `MEMORY/WORK/**/PRD.md` pattern
- The PRD file does not exist on disk after the tool operation
- The PRD has no YAML frontmatter or the frontmatter is missing a `slug` field

## What It Does

1. Reads the PRD.md file from disk
2. Parses YAML frontmatter between `---` markers for task, slug, effort, phase, progress, mode, and timestamps
3. Counts criteria checkboxes: `- [x]` (done) and `- [ ]` (todo) patterns
4. Builds a WorkEntry with frontmatter fields and criteria counts
5. Reads existing `MEMORY/STATE/work.json` (or starts fresh if missing/corrupt), upserts the entry by slug, and writes it back
6. Extracts the session directory from the PRD file path and updates the session state file

```typescript
// Parse frontmatter + criteria, upsert into work.json
const fm = parseFrontmatter(content);
const { total, done } = parseCriteriaCounts(content);
const entry: WorkEntry = {
  task: fm.task ?? "", phase: fm.phase ?? "",
  progress: fm.progress ?? `${done}/${total}`,
  criteria_total: total, criteria_done: done, ...
};
syncWorkJson(slug, entry, workJsonPath, deps);
```

## Examples

### Example 1: PRD written during task creation

> AutoWorkCreation creates a new PRD.md with frontmatter containing `slug: refactor-auth`. After the Write tool completes, PRDSync fires, parses the frontmatter, counts 0/5 criteria done, and writes `{"refactor-auth": {"task": "Refactor auth middleware", "phase": "PLAN", "progress": "0/5", ...}}` to work.json.

### Example 2: Criteria checked during work

> You check off 3 criteria in an existing PRD.md via the Edit tool. PRDSync fires, re-parses the checkboxes, updates the work.json entry to show `"progress": "3/5"`, and logs "Synced refactor-auth -> phase=BUILD progress=3/5".

## Dependencies

| Dependency                       | Type      | Purpose                                              |
| -------------------------------- | --------- | ---------------------------------------------------- |
| `core/adapters/fs`               | adapter   | File read/write, existence checks, JSON parsing      |
| `core/result`                    | core      | Result type for error handling pipelines             |
| `@anthropic-ai/claude-agent-sdk` | SDK types | `SyncHookJSONOutput` return type (post-SDK-refactor) |
