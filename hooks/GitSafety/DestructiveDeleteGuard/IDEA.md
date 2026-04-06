# Destructive Delete Guard

> Block recursive deletes and mass file removal, distinguishing artifacts from real code.

## Problem

A recursive delete command can destroy an entire directory tree in milliseconds. AI assistants sometimes generate these commands to "clean up" or embed them in code they write. The risk is asymmetric: artifacts like build output or dependency caches are trivially regenerated, but source code, configuration, and data are not. A single `rm -rf` with a wrong path variable can be catastrophic.

## Solution

Intercept both shell commands and code writes. For shell commands, detect recursive delete patterns and either block (for real directories) or prompt for confirmation (for known artifact directories). For code being written, detect embedded destructive delete patterns in source files and block them, directing the author to use safe wrapper functions instead.

## How It Works

1. When a shell command is about to execute, scan for recursive delete patterns (rm -r, find -delete, language-specific tree removal, rsync --delete, git clean).
2. If the target is a known artifact directory (node_modules, dist, build, coverage, etc.), prompt for user confirmation instead of blocking.
3. If the target is anything else, block the command outright.
4. When code files are being written or edited, scan the new content for embedded destructive delete patterns (string literals, spawn arrays, API calls).
5. Block code containing destructive patterns and direct the author to use safe wrapper functions.
6. Exempt documentation files, container build files, and safe wrapper implementations.

## Signals

- **Input:** Shell command string, or file content being written/edited
- **Output:** Block (with safe alternative), ask (confirmation for artifact cleanup), or pass
