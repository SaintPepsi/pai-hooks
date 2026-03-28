# AgentPrepromptInjector

## Overview

AgentPrepromptInjector is a **sync PreToolUse** hook that injects a worker preprompt template into background agent prompts before they are spawned. When the Agent tool is about to run with `run_in_background: true`, this hook reads a Markdown template, replaces variables like `{{agent_name}}`, `{{thread_id}}`, and `{{task_description}}`, and appends the rendered preprompt to the agent's prompt via `updatedInput`.

This ensures every Koord background worker agent receives coordination instructions automatically — it is impossible to spawn a Koord worker without them.

## Event

`PreToolUse` — fires before the Agent tool executes with `run_in_background: true`, injecting the worker preprompt into the agent's prompt.

## When It Fires

- The `tool_name` is `"Agent"`
- `run_in_background` is `true` in the tool input
- A worker preprompt template file exists at the configured path

It does **not** fire when:

- The tool is not the Agent tool
- `run_in_background` is not true (foreground agent calls)
- The template file does not exist at the configured or fallback path
- The template file cannot be read (returns `continueOk()`, fails open)

## What It Does

1. Checks `accepts()`: only proceeds for Agent tool with `run_in_background: true`
2. Resolves template path from `hookConfig.koordDaemon.prepromptPath` in settings.json, falling back to `{cwd}/src/prompts/worker.md`
3. Verifies the template file exists; returns `continueOk()` if missing
4. Reads the template file content
5. Extracts `agent_name`, `thread_id`, and `task_description` from tool input
6. Replaces `{{agent_name}}`, `{{thread_id}}`, and `{{task_description}}` placeholders in the template
7. Appends the rendered preprompt to the original prompt separated by `\n\n---\n\n`
8. Returns `updatedInput({ prompt: updatedPrompt })` to modify the Agent tool's input

```typescript
// Replace template variables
const preprompt = template
  .replace(/\{\{agent_name\}\}/g, agentName)
  .replace(/\{\{thread_id\}\}/g, threadId)
  .replace(/\{\{task_description\}\}/g, taskDesc);

// Append to original prompt
const updatedPrompt = originalPrompt + SEPARATOR + preprompt;
return ok(updatedInput({ prompt: updatedPrompt }));
```

## Examples

### Example 1: Background worker receives coordination instructions

> Claude spawns a background agent named "code-reviewer" with `run_in_background: true`. AgentPrepromptInjector reads `src/prompts/worker.md`, replaces `{{agent_name}}` with "code-reviewer", `{{thread_id}}` with the extracted thread ID, and `{{task_description}}` with the task. The agent's prompt now includes full Koord coordination instructions appended after the original prompt.

### Example 2: Template not found (fail open)

> A background agent is spawned but no worker preprompt template exists at the configured path or the fallback `{cwd}/src/prompts/worker.md`. AgentPrepromptInjector logs a warning and returns `continueOk()`, allowing the agent to proceed without coordination instructions.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result wrapping |
| `types/hook-outputs` | core | `updatedInput()`, `continueOk()` for PreToolUse outputs |
| `fs` | adapter | `fileExists`, `readFile` for template access |
| `KoordDaemon/shared` | shared | `readKoordConfig`, `extractThreadId`, `extractAgentName`, `extractTask` |
| `paths` | lib | Path resolution utilities |
