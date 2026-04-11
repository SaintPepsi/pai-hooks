# CitationEnforcement

## Overview

CitationEnforcement is a **PostToolUse** hook that injects citation reminders the first time Claude writes to each unique file during a session where the citation obligation is active. It works in tandem with CitationTracker, which activates the obligation when research tools are used.

The hook ensures that factual claims derived from research are backed by verifiable citations (URLs, file paths, or documentation references) rather than vague attributions like "According to X."

## Event

`PostToolUse` — fires after a Write or Edit tool use, injecting a citation reminder into the conversation context for each newly written file.

## When It Fires

- The citation obligation flag is active (set by CitationTracker after research tool use)
- The tool used is `Write` or `Edit`
- The target file has not already received a citation reminder in this session

It does **not** fire when:

- No research tools have been used in the session (flag file does not exist)
- The tool is not `Write` or `Edit`
- The file has already been reminded (tracked in the reminded list)
- The file path cannot be extracted from the tool input

## What It Does

1. Checks whether the citation obligation flag file exists in the state directory
2. Extracts the file path from the tool input; exits silently if unavailable
3. Reads the list of already-reminded files from the state directory
4. If the file is already in the reminded list, returns `continue` with no context
5. Adds the file to the reminded list and persists it
6. Builds a citation reminder message using a narrative opener and returns it as `additionalContext`

```typescript
// Core reminder injection (R2 — PostToolUse context injection via hookSpecificOutput)
const reminded = deps.readReminded(remindedPath(deps.stateDir));
if (reminded.includes(filePath)) {
  return ok({ continue: true });
}
reminded.push(filePath);
deps.writeReminded(remindedPath(deps.stateDir), reminded);
return ok({
  continue: true,
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: buildCitationReminder(),
  },
});
```

> **Bug fix note (SDK Type Foundation refactor — 1E-1):** Pre-refactor, this hook used the legacy
> `continueOk(buildCitationReminder())` shape, which placed `additionalContext` at the **top
> level** of the output object. The SDK silently dropped that field for `PostToolUse` events,
> meaning citation reminders were never actually surfaced to the model. Migration to the R2 recipe
> (`hookSpecificOutput.additionalContext` with `hookEventName: "PostToolUse"`) routes the reminder
> through the channel the SDK actually reads. Same bug class as the PreCompactStatePersist 1A fix.

## Examples

### Example 1: First write after research

> You use WebSearch to look up API documentation, then use the Write tool to create a new file `docs/api-guide.md`. CitationTracker has already set the citation flag. CitationEnforcement detects the write, sees the file has not been reminded yet, and injects a reminder: "Ensure every factual claim includes a citation: URLs for web sources, file paths for codebase facts, documentation section names for framework claims."

### Example 2: Subsequent edits to the same file

> You edit `docs/api-guide.md` a second time in the same session. CitationEnforcement checks the reminded list, finds the file already present, and returns silently without injecting another reminder.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `narrative-reader` | lib | Picks narrative opener text for the reminder message |
| `CitationEnforcement.shared` | shared | Provides deps type, flag/reminded path helpers, and `getFilePath` extractor |
| `result` | core | `ok` wrapper for Result type returns |
