## Overview

Detects and automatically reverts unauthorized changes to `~/.claude/settings.json` and `~/.claude/settings.local.json` after Bash commands. Paired with `SettingsProtector` (PreToolUse) which takes the pre-command snapshots.

## Event

PostToolUse

## When It Fires

After every Bash tool call completes.

## What It Does

1. Reads the snapshot files written by `SettingsProtector` from `/tmp/pai-settings-snapshot-{session_id}-{filename}`
2. Compares each settings file's current content to its snapshot
3. If any file changed (content differs) or was deleted:
   - **Reverts** the file by writing the snapshot content back
   - **Logs** the revert to stderr
   - **Injects context** telling the AI the change was reverted and not to retry
4. If no snapshot exists (SettingsProtector didn't run) or files are unchanged, returns silent

> A Bash command runs `sed -i 's/true/false/' ~/.claude/settings.json`. After it completes, SettingsProtectorPost detects the content differs from the snapshot and overwrites settings.json with the original content. The AI receives a security warning.

> A Bash command runs `rm ~/.claude/settings.json`. SettingsProtectorPost detects the file is missing and restores it from the snapshot.

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
# → rejected by accepts() (Edit changes go through SettingsProtector ask flow)
```

## Dependencies

- `core/adapters/fs` — `readFile`, `writeFile`, `fileExists` for comparison and revert I/O
- `hooks/SecurityValidator/SettingsProtector/SettingsProtector.contract` — `snapshotPath` function for deterministic snapshot file locations
- `lib/paths` — `defaultStderr` for logging
- Requires `SettingsProtector` (PreToolUse) to have run first to create snapshots
