## Problem

Shell commands can modify files through arbitrarily complex means — variable indirection, string concatenation, encoded paths, multi-step pipelines. No amount of command parsing can reliably detect every write vector. A pre-execution hook that tries to block dangerous commands will always have gaps.

## Solution

Instead of trying to predict what a command will do, observe what it actually did. Compare the protected file's content before and after execution. If it changed, revert it. This is a post-execution guard that catches every modification regardless of the mechanism used.

## How It Works

1. A pre-execution hook (paired with this one) snapshots the protected file to a temporary location before each shell command
2. After the shell command completes, this hook reads the file and compares it to the snapshot
3. If the content differs, the snapshot is written back over the modified file (revert)
4. If the file was deleted, the snapshot restores it
5. A warning message is injected into the AI's context explaining what happened
6. If the file is unchanged or no snapshot exists, the hook exits silently with zero overhead

## Signals

**Input:**

- Tool name (only processes Bash)
- Session ID (to locate the correct snapshot)

**Output:**

- `silent` when no change detected (most common path)
- `continue` with warning context when a change was reverted
