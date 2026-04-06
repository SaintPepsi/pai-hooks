# Security Validator

> Block dangerous commands and protect sensitive paths before any tool executes.

## Problem

AI assistants with shell access can run arbitrary commands and write to any file. Without pre-execution validation, a hallucinated `rm -rf`, an accidental write to a credentials file, or a `sed -i` that bypasses file-write protections can cause real damage. Users need policy-based guardrails that work across all tool types.

## Solution

Intercept every shell command and file operation before execution. Match them against a YAML policy file that defines blocked command patterns, tiered path access rules, and per-project overrides. Detect tool-substitution bypasses by extracting write targets from shell commands that modify files indirectly.

## How It Works

1. Load a YAML security policy defining bash patterns (blocked, confirm, alert) and path tiers (zero-access, read-only, confirm-write, no-delete).
2. For shell commands: strip environment variable prefixes, split chained commands, and test each against pattern lists.
3. For file operations: resolve the path and check it against the appropriate tier based on the action (read, write, or delete).
4. For shell commands that write files (sed -i, cp, mv, tee, redirects, inline scripts): extract write targets and validate them against path rules.
5. Return block, confirm, alert, or allow — and log all non-trivial events to structured files.

## Signals

- **Input:** Tool name and arguments (command string or file path) on every tool invocation
- **Output:** Block (hard stop with reason), confirm (requires manual execution), alert (logged warning), or allow (silent pass-through)
