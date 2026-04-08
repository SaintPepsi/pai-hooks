## Overview

Guards `~/.claude/settings.json` and `~/.claude/settings.local.json` from unauthorized modification by using a two-layer strategy: permission prompts for direct tool edits and filesystem-level snapshot/revert for Bash commands.

## Event

PreToolUse

## When It Fires

- **Edit/Write tools**: When the target `file_path` ends with `settings.json` or `settings.local.json` and is in `~/.claude/`
- **Bash tool**: On every Bash command (snapshot strategy — no pattern matching needed)

## What It Does

1. **Edit/Write targeting settings files**: Returns an `ask` decision prompting the user to confirm the modification. The prompt includes an AI instruction not to suggest workarounds if denied.

2. **Bash commands**: Reads the current content of both settings files and writes snapshots to `/tmp/pai-settings-snapshot-{session_id}-{filename}`. Returns `continue` so the command proceeds normally. The paired PostToolUse hook (`SettingsProtectorPost`) compares the files after execution and reverts any unauthorized changes.

> A user edits settings.json via the Edit tool. Claude shows: "Settings Protection: Claude wants to modify a settings file. Allow this modification?" The user approves or denies.

> A Bash command runs `python3 -c "open('settings.json','w')..."`. The command completes, but SettingsProtectorPost detects the change and reverts settings.json to its pre-command state, injecting an error message.

## Examples

```bash
# Edit tool targeting settings.json — triggers ask prompt
Edit { file_path: "~/.claude/settings.json", ... }
# → ask("⚠️ Settings Protection: Claude wants to modify a settings file...")

# Any Bash command — snapshots settings files silently
Bash { command: "git status" }
# → continue (snapshot written to /tmp/)

# Bash command that modifies settings.json — caught by PostToolUse pair
Bash { command: "python3 -c \"...writeFileSync('settings.json')...\"" }
# → continue (PostToolUse will compare and revert)
```

## Dependencies

- `core/adapters/fs` — `readFile`, `writeFile`, `fileExists` for snapshot I/O
- `lib/tool-input` — `getFilePath` for extracting file paths from tool input
- `lib/paths` — `defaultStderr` for logging
- Paired with `SettingsProtectorPost` (PostToolUse) for the revert mechanism
