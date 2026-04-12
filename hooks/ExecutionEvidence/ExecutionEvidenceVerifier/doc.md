# ExecutionEvidenceVerifier

## Overview

ExecutionEvidenceVerifier is a **PostToolUse** hook that checks whether state-changing Bash commands (such as `git push`, deploy scripts, `curl POST`, etc.) produced substantive output. When a command is classified as state-changing but its output is thin or absent, the hook injects `additionalContext` nudging the agent to show actual execution evidence in its response.

This hook never blocks execution. It only adds contextual reminders when evidence of successful execution is missing, helping ensure the agent reports real results rather than assuming success.

## Event

`PostToolUse` — fires after a Bash tool call completes, checking whether state-changing commands produced adequate execution evidence.

## When It Fires

- The tool is `Bash` (accepts gate)
- The executed command is classified as state-changing by `classifyCommand`
- The tool response lacks substantive output (checked by `hasSubstantiveOutput`)

It does **not** fire when:

- The tool is not `Bash`
- The command is not classified as state-changing (e.g., `ls`, `cat`, read-only commands)
- The command produced substantive output proving execution occurred

## What It Does

1. Extracts the command string from `tool_input.command`
2. Classifies the command using `classifyCommand` to determine if it is state-changing
3. If the command is not state-changing, returns `continue` immediately
4. Checks the `tool_response` for substantive output using `hasSubstantiveOutput`
5. If substantive output exists, returns `continue` (evidence is present)
6. If evidence is missing, builds a reminder using `buildReminder` and injects it as `additionalContext`
7. Logs the injection to stderr

```typescript
const classification = classifyCommand(command);

if (!classification.isStateChanging) {
  return ok({ continue: true });
}

if (hasSubstantiveOutput(input.tool_response)) {
  return ok({ continue: true });
}

const reminder = buildReminder(command, classification);
return ok({
  continue: true,
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: reminder,
  },
});
```

## Examples

### Example 1: Git push with no output

> The agent runs `git push origin main` and the tool response is empty or contains only whitespace. ExecutionEvidenceVerifier classifies this as state-changing, detects no substantive output, and injects a reminder asking the agent to verify the push succeeded and report the actual result.

### Example 2: Deploy command with full output

> The agent runs `./deploy.sh production` and the tool response contains build logs, deployment URLs, and status codes. ExecutionEvidenceVerifier classifies it as state-changing but finds substantive output present, so it returns `continue` with no additional context.

## Dependencies

| Dependency                       | Type      | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execution-classification`       | lib       | Provides `classifyCommand`, `hasSubstantiveOutput`, and `buildReminder`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `result`                         | core      | Provides `ok` and `Result` type for error handling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `@anthropic-ai/claude-agent-sdk` | SDK types | `SyncHookJSONOutput` return type. Post-SDK Type Foundation refactor (1R, bug #10 fix), the reminder injection channel is `hookSpecificOutput.additionalContext` with `hookEventName: "PostToolUse"`. The pre-refactor legacy form `continueOk(reminder)` placed `additionalContext` at top level, which the SDK silently dropped for PostToolUse events — same bug class as PreCompactStatePersist (1A), CodingStandards advisories (1C×3), CitationEnforcement (1E-1), SettingsRevert (1B), WikiContextInjector (1X), and ArchitectureEscalation+SonnetDelegation (1M×2). |
