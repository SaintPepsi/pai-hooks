# SecurityValidator

## Overview

SecurityValidator is a **PreToolUse** hook that validates Bash commands and file operations against a JSON-defined security policy. It enforces path-based access controls (zero-access, read-only, confirm-write, no-delete) and command-pattern matching (blocked, confirm, alert) to prevent dangerous operations from executing within Claude Code.

The hook also detects tool substitution bypasses where a user might use `sed -i`, `cp`, `mv`, `tee`, or other Bash commands to write to protected files that would be blocked via Edit/Write. All security events are logged to structured JSONL files for audit purposes.

## Event

`PreToolUse` — fires before Bash, Edit, MultiEdit, Write, and Read tool operations, validating the command or file path against security patterns and blocking or alerting as appropriate.

## When It Fires

- The tool is one of: `Bash`, `Edit`, `MultiEdit`, `Write`, `Read`
- For Bash: the command matches a blocked, confirm, or alert pattern, or writes to a protected path
- For file tools: the target path matches a zero-access, read-only, confirm-write, or no-delete pattern

It does **not** fire when:

- The tool is not one of the five monitored tools (e.g., Skill, Agent)
- The Bash command is empty
- No file path is provided for file operations
- No security patterns file is found (fails open with permissive defaults)
- The command/path does not match any configured patterns

## What It Does

1. Loads security patterns from `hooks/SecurityValidator/patterns.json` (collocated with the hook)
2. For Bash commands:
   - **Clipboard exemption**: Commands piping to `pbcopy`/`pbpaste` are allowed regardless of content (prevents false positives when copying text containing SQL keywords)
   - Strips environment variable prefixes from the command
   - Checks against blocked patterns (hard block via exit code 2)
   - Checks against confirm patterns (block with manual-run guidance)
   - Checks against alert patterns (log and allow)
   - Extracts write targets from file-modifying commands (`sed -i`, `cp`, `mv`, `tee`, redirects, inline scripts) and validates each against path patterns
3. For file operations (Edit/MultiEdit/Write/Read):
   - Determines the action type (read vs. write)
   - Validates the file path against zero-access, read-only, confirm-write, and no-delete path lists
4. Logs all security events (block, confirm, alert) to `MEMORY/SECURITY/{year}/{month}/` as structured JSON files

```typescript
// Tool substitution bypass prevention
const writeTargets = extractWriteTargets(command);
for (const target of writeTargets) {
  const pathResult = validatePath(target, "write", patterns, home, deps);
  if (pathResult.action === "block" || pathResult.action === "confirm") {
    return err(
      securityBlockError(
        `Bash command modifies protected path via tool substitution: ${target}`,
      ),
    );
  }
}
```

## Examples

### Example 1: Blocked Bash command

> Claude attempts to run `chmod 777 /etc/shadow`. The command matches a blocked bash pattern in the security YAML. SecurityValidator logs the event and returns a hard block (exit code 2), preventing execution entirely.

### Example 2: Tool substitution bypass caught

> Claude tries `sed -i 's/old/new/g' ~/.ssh/authorized_keys` via Bash to bypass Write tool restrictions. SecurityValidator extracts `~/.ssh/authorized_keys` as a write target, matches it against the zero-access path list, and blocks the command with guidance to run it manually.

### Example 3: Read-only path write blocked

> Claude attempts to Edit `~/.claude/settings.json` which is in the read-only path list. SecurityValidator blocks the write with a reason explaining it is a read-only path, while Read operations to the same path are allowed.

## Dependencies

| Dependency         | Type    | Purpose                                                  |
| ------------------ | ------- | -------------------------------------------------------- |
| `narrative-reader` | lib     | Picks contextual narrative openers for security messages |
| `fs`               | adapter | Reads security patterns JSON and writes audit logs       |
| `regex`            | adapter | Safe regex testing for pattern matching                  |
| `patterns-schema`  | lib     | Effect Schema decoder for patterns.json validation       |

## History

> **2026-04-17 — Clipboard exemption (#240):** Added `pbcopy`/`pbpaste` exemption before pattern matching. Previously, piping markdown containing SQL keywords (e.g., "TRUNCATE") to `pbcopy` triggered false positive blocks. Fix: `SecurityValidator.contract.ts:288-291`.
