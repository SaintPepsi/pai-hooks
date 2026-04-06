# Hook Documentation Tracker

> Track which automation source files changed and whether their documentation was updated.

## Problem

To enforce documentation obligations for automation code (hooks, plugins, extensions), the system needs to track two things: which source files were modified, and whether documentation in the same directory was subsequently updated.

## Solution

Watch every file write. When a file matches configurable source patterns (e.g., implementation files, config files), add its directory to the pending list. When a documentation file is written, clear all pending entries from the same directory. The watch patterns and documentation filename are configurable.

## How It Works

1. On each file write, determine whether the file matches a watched source pattern or is a documentation file.
2. If it is a source file, add it to the pending obligations list.
3. If it is a documentation file, find all pending entries in the same directory and remove them.
4. If all pending items are cleared, remove the state file entirely.

## Signals

- **Input:** File path on every file write or edit, plus configurable watch patterns and doc filename
- **Output:** Updated pending obligations list in session state (consumed by the companion enforcer)
