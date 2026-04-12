## Overview

Diagnostic hook that logs every Claude Code permission prompt to a JSONL file. Does not modify permission behavior — purely observational.

## Event

`PermissionRequest` — fires when Claude Code is about to show a permission dialog to the user.

## When It Fires

Every time Claude Code determines a tool call needs user approval (based on deny > ask > allow precedence from `settings.json`). This includes:

- Tools not in the allow list
- Tools matching an ask-list pattern (e.g., `Bash(kill *)`)
- Operations on sensitive paths (e.g., `~/.claude/` directory)

## What It Does

1. Reads the tool name and input from the PermissionRequest event
2. Summarizes the tool input (command for Bash, file_path for Edit/Write, prompt for Agent)
3. Appends a JSON log entry to `MEMORY/SECURITY/permission-prompts.jsonl`
4. Returns silent — the permission prompt shows normally to the user

> **Example:** A `Bash(kill -0 1234)` command triggers the `Bash(kill *)` ask pattern. The hook logs:
>
> ```json
> {
>   "timestamp": "2026-03-29T08:30:00Z",
>   "session_id": "abc",
>   "tool_name": "Bash",
>   "tool_input_summary": "kill -0 1234",
>   "permission_mode": "default",
>   "suggestions": "[...]"
> }
> ```
>
> The user still sees the normal "Allow Bash?" prompt.

## Examples

**Viewing the log after a session:**

```bash
cat ~/.claude/MEMORY/SECURITY/permission-prompts.jsonl | python3 -m json.tool
```

**Counting prompts by tool:**

```bash
cat ~/.claude/MEMORY/SECURITY/permission-prompts.jsonl | jq -r '.tool_name' | sort | uniq -c | sort -rn
```

## Dependencies

- `appendFile` from `core/adapters/fs` — appends log entries
- `ensureDir` from `core/adapters/fs` — creates log directory
- No external dependencies
