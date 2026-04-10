## Overview

Detects and automatically reverts unauthorized changes to `~/.claude/settings.json` and `~/.claude/settings.local.json` after Bash commands. Paired with `SettingsGuard` (PreToolUse) which takes the pre-command snapshots.

## Event

PostToolUse

## When It Fires

After every Bash tool call completes.

## What It Does

1. Reads the snapshot files written by `SettingsGuard` from `/tmp/pai-settings-snapshot-{session_id}-{filename}`
2. Compares each settings file's current content to its snapshot
3. If any file changed (content differs) or was deleted:
   - **Reverts** the file by writing the snapshot content back
   - **Logs** the revert to stderr
   - **Injects context** telling the AI the change was reverted and not to retry
   - **Spawns a hardening agent** via `lib/spawn-agent.ts` that auto-adds a `blocked` pattern to `patterns.json` so SecurityValidator catches the same bypass pre-execution next time
4. If no snapshot exists (SettingsGuard didn't run) or files are unchanged, returns silent

> A Bash command runs `sed -i 's/true/false/' ~/.claude/settings.json`. After it completes, SettingsRevert detects the content differs from the snapshot and overwrites settings.json with the original content. The AI receives a security warning.

> A Bash command runs `rm ~/.claude/settings.json`. SettingsRevert detects the file is missing and restores it from the snapshot.

## Examples

```bash
# No change detected — silent return
PostToolUse { tool_name: "Bash", command: "git status" }
# → silent (settings unchanged)

# Change detected — revert + inject warning
PostToolUse { tool_name: "Bash", command: "python3 -c '...'" }
# settings.json content differs from snapshot
# → writeFile(settings.json, snapshot_content)
# → continue("[SECURITY] Your Bash command modified settings.json... reverted")

# Non-Bash tools — not processed
PostToolUse { tool_name: "Edit", ... }
# → rejected by accepts() (Edit changes go through SettingsGuard ask flow)
```

## Audit Log

Every comparison result is logged to `MEMORY/SECURITY/settings-audit.jsonl`:

| Field | Description |
|-------|-------------|
| `ts` | ISO timestamp |
| `session_id` | Claude Code session ID |
| `tool` | Always `Bash` |
| `target` | Reverted filename(s) or `settings.json` if unchanged |
| `action` | `reverted` (change detected and undone) or `unchanged` (no modification) |
| `command` | First 500 chars of the Bash command |

## Hardening Loop

When a revert occurs, SettingsRevert calls `runHardening(command)` which spawns a background Claude agent with a purpose-built MCP server (least-privilege). The agent:

1. Calls `get_blocked_patterns` to check if the bypass is already covered and see valid groups
2. Calls `insert_blocked_pattern` to add a new `blocked` entry with pattern, reason, and optional group (must match an existing group)

The agent runs from `hooks/SecurityValidator/` with `--strict-mcp-config` (MCP tools only, no filesystem access), `--setting-sources ""` (no user hooks), and `--disable-slash-commands`. Agent lifecycle is logged as JSONL to `MEMORY/SECURITY/hardening-log.jsonl` with session IDs for traceability. A lock file at `/tmp/pai-hardening-agent.lock` prevents concurrent runs.

## Dependencies

- `core/adapters/fs` — `readFile`, `writeFile`, `appendFile`, `ensureDir`, `fileExists` for comparison, revert, and audit I/O
- `hooks/SecurityValidator/SettingsGuard/SettingsGuard.contract` — `snapshotPath` and `logSettingsAudit` for snapshot locations and shared audit logging
- `hooks/SecurityValidator/run-hardening` — `runHardening()` spawns a background hardening agent via MCP
- `lib/tool-input` — `getCommand` for extracting Bash commands
- `lib/paths` — `defaultStderr`, `getPaiDir` for logging and base directory
- Requires `SettingsGuard` (PreToolUse) to have run first to create snapshots
