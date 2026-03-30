# RelationshipMemory

## Overview

RelationshipMemory extracts relationship signals from session transcripts and persists them as structured notes in daily log files. It analyzes user and assistant messages for preferences, frustrations, positive feedback, and milestones, then appends typed notes (W for work, B for behavior, O for observation) to `MEMORY/RELATIONSHIP/{YYYY-MM}/{YYYY-MM-DD}.md`.

The hook uses pattern matching on transcript text to detect emotional signals (frustration, positive feedback) and extracts assistant summary lines to capture what was accomplished. These notes build a long-term relationship memory that other hooks and the AI can reference.

## Event

`Stop` — fires when Claude Code generates a response, analyzing the full transcript for relationship signals and appending notes to the daily log.

## When It Fires

- A Stop event occurs with a valid `transcript_path`
- The transcript file exists and contains parseable entries
- The analysis produces at least one relationship note

It does **not** fire when:

- No `transcript_path` is provided (accepts returns false)
- The transcript file is missing or empty
- The transcript has no entries after parsing
- No relationship signals are detected (no preferences, frustrations, positives, or milestones found)

## What It Does

1. Reads and parses the transcript file (JSONL format) into typed entries via `safeParseTranscriptLine` (exported for direct testing)
2. Scans user messages for emotional patterns:
   - Frustration keywords (frustrat, annoy, bother, irritat)
   - Positive keywords (great, awesome, perfect, excellent, good job)
   - Preference expressions (prefer, like, want, appreciate)
3. Scans assistant messages for:
   - SUMMARY lines (extracted as behavior notes)
   - Milestone language (first time, finally, breakthrough, success)
4. Aggregates signals: 2+ positive messages generate an observation note, 2+ frustrations generate a frustration note
5. Creates or appends to the daily relationship log file with timestamped sections

```typescript
// Pattern-based analysis, then structured note output
for (const entry of entries) {
  const text = extractText(entry);
  if (entry.type === "user") {
    if (patterns.frustration.test(text)) frustrations++;
    if (patterns.positive.test(text)) positives++;
  }
  if (entry.type === "assistant") {
    const summaryMatch = text.match(/SUMMARY:\s*([^\n]+)/i);
    if (summaryMatch) sessionSummary.push(summaryMatch[1].trim());
  }
}
// Write typed notes: B (behavior), O (observation), W (work)
deps.writeNotes(notes);
```

## Examples

### Example 1: Positive session captured

> During a session, you say "great approach" and "awesome, that works perfectly". RelationshipMemory detects 2+ positive signals and writes an observation note: `- O(c=0.70) @Ian: Responded positively to this session's approach` to `MEMORY/RELATIONSHIP/2026-03/2026-03-28.md`.

### Example 2: Frustration detected

> You express frustration twice during a session ("this is frustrating" and "really annoying behavior"). RelationshipMemory captures: `- O(c=0.75) @Ian: Experienced frustration during this session (likely tooling-related)`.

### Example 3: Work summaries extracted

> The assistant produces two responses with SUMMARY lines. RelationshipMemory extracts these as behavior notes: `- B @Maple: Refactored auth middleware to use JWT tokens` appended to the daily log.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `core/adapters/fs` | adapter | File read/write/append, existence checks, directory creation |
| `lib/identity` | lib | DA name and principal name for note entities |
| `lib/paths` | lib | Resolves PAI directory path |
| `lib/time` | lib | Local date components for file naming |
| `core/error` | core | JSON parse error handling |
