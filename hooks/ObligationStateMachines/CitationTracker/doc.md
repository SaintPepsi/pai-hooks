# CitationTracker

## Overview

CitationTracker is a **PostToolUse** hook that detects when research tools are used and activates the citation enforcement obligation for the session. It is the companion to CitationEnforcement: CitationTracker sets the flag, and CitationEnforcement acts on it by injecting reminders during subsequent writes.

The hook recognizes both built-in research tools (`WebSearch`, `WebFetch`) and research-related skills, ensuring that any information gathered from external sources triggers the citation obligation.

## Event

`PostToolUse` — fires after a research tool or research skill is used, writing a flag file that activates citation enforcement for the remainder of the session.

## When It Fires

- The tool used is `WebSearch` or `WebFetch` (members of the `RESEARCH_TOOLS` set)
- The tool use matches a research skill pattern (detected via `isResearchSkill`)

It does **not** fire when:

- The tool is not a recognized research tool or research skill
- The tool is a standard code editing tool (Write, Edit, Bash, etc.)

## What It Does

1. Checks if the tool matches a known research tool name or research skill pattern
2. Writes a flag file to the session state directory marking citation enforcement as active
3. Logs a message to stderr indicating citation enforcement is now active
4. Returns `continue` with no additional context (silent activation)

```typescript
// Flag activation on research tool detection
const flag = flagPath(deps.stateDir);
deps.writeFlag(flag);
deps.stderr("[CitationTracker] Research tool detected — citation enforcement active");
return ok({ continue: true });
```

## Examples

### Example 1: Web search triggers citation obligation

> You ask Claude to research a topic, and it uses the WebSearch tool. CitationTracker fires, writes the citation flag file, and logs that citation enforcement is now active. Any subsequent file writes will receive citation reminders from CitationEnforcement.

### Example 2: Research skill triggers citation obligation

> You invoke a research-related skill that performs web fetches internally. CitationTracker recognizes the skill pattern via `isResearchSkill` and activates the citation flag, ensuring downstream writes include proper citations.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `CitationEnforcement.shared` | shared | Provides `RESEARCH_TOOLS` set, `isResearchSkill` helper, `flagPath`, and deps type |
| `result` | core | `ok` wrapper for Result type returns |
