# SessionQualityReport

## Overview

SessionQualityReport is a **SessionEnd** hook that aggregates all quality baselines collected during a session into a human-readable Markdown report. It reads the per-session baseline store written by CodeQualityBaseline, builds a summary with file-by-file scores, and writes the report to the `MEMORY/LEARNING/QUALITY/` directory organized by year and month.

The report highlights files needing attention (score below 6.0) and clean files (score 8.0 or above), providing a persistent quality record for trend analysis across sessions.

## Event

`SessionEnd` — fires when a Claude Code session ends, reading stored baselines and writing a quality summary report to disk.

## When It Fires

- A session is ending (SessionEnd event)
- A valid `session_id` is present in the input
- A quality baselines file exists for this session (`quality-baselines-{session_id}.json`)
- The baselines file contains at least one entry

It does **not** fire when:

- No source files were read during the session (no baseline file exists)
- The baselines file is empty or cannot be parsed
- The `session_id` is missing from the input

## What It Does

1. Checks for the existence of `MEMORY/STATE/quality-baselines-{session_id}.json`
2. Reads and parses the baseline store
3. Builds a Markdown report containing:
   - Session metadata (ID, date, file count, average score)
   - A table of all analyzed files sorted by score (worst first)
   - A "Files Needing Attention" section for scores below 6.0
   - A "Clean Files" section for scores 8.0 and above
4. Writes the report to `MEMORY/LEARNING/QUALITY/{year}-{month}/quality-{timestamp}.md`
5. Returns `silent` — no output is shown to the user

```typescript
// Report output path structure
const qualityDir = join(deps.baseDir, "MEMORY", "LEARNING", "QUALITY", `${time.year}-${time.month}`);
const filename = `quality-${time.year}${time.month}${time.day}-${time.hours}${time.minutes}.md`;
deps.writeFile(join(qualityDir, filename), report);
```

## Examples

### Example 1: Session with mixed quality files

> During a session you read 8 source files. At session end, SessionQualityReport generates a report showing an average score of 7.2/10. Two files are flagged under "Files Needing Attention" (`legacy-parser.ts` at 4.1/10, `old-handler.ts` at 5.3/10) and three files appear under "Clean Files" (all scoring 8.0+ /10). The report is written to `MEMORY/LEARNING/QUALITY/2026-03/quality-20260328-1430.md`.

### Example 2: No files read during session

> You run a session that only uses Bash commands and never reads source files. No baseline file is created, so SessionQualityReport logs "No quality baselines found, skipping" to stderr and returns silently.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `time` | lib | Provides local date/time components for report filenames and timestamps |
| `fs` | adapter | Reads baseline store and writes the report file |
