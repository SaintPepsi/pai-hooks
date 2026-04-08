## Problem

AI coding assistants can modify configuration files through multiple vectors: direct file editing tools, shell commands (sed, python, node, jq), piped redirects, and more. A security hook that only intercepts the editing tool leaves dozens of bypass paths open. Pattern-matching every possible shell command is an arms race that can't be won.

## Solution

A two-layer protection system that combines permission prompts with filesystem-level change detection:

1. **Direct edits** (tools that declare their target file) get an interactive confirmation prompt
2. **Shell commands** are handled by snapshotting the protected file before execution and comparing afterward — if the file changed, it's automatically reverted

This eliminates the need to parse or pattern-match commands. The protection works regardless of how the file was modified.

## How It Works

1. When a direct file edit targets a protected settings file, the system returns a confirmation prompt asking the user to approve or deny
2. When any shell command runs, the system reads the protected file and stores its content in a temporary snapshot
3. After the shell command completes, a paired post-execution hook reads the file again
4. If the content differs from the snapshot, the original content is written back (reverted)
5. An error message is injected into the AI's context explaining the revert and instructing it not to retry

## Signals

**Input:**
- Tool name (Edit, Write, Bash)
- File path (for Edit/Write)
- Session ID (for snapshot namespacing)

**Output:**
- `ask` decision with confirmation message (Edit/Write)
- `continue` with snapshot side-effect (Bash — PreToolUse)
- `continue` with revert + warning context (Bash — PostToolUse, when change detected)
- `silent` (Bash — PostToolUse, when no change detected)
