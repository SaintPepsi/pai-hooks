# Security Validator

> Enforce configurable security policies on every tool operation before it executes.

## Problem

AI coding assistants execute shell commands and file operations on behalf of users. Without guardrails, they can access sensitive paths, run destructive commands, or bypass file-level protections by using shell equivalents (e.g., `sed -i` instead of a file-write tool). A single misconfigured prompt or hallucinated command can expose credentials, delete protected files, or modify system configurations.

## Solution

Intercept every tool invocation — shell commands, file reads, file writes — and evaluate it against a user-defined security policy before execution. The policy is a set of pattern rules organized by category: blocked commands, paths with zero access, read-only paths, delete-protected paths, and commands requiring manual confirmation. Critically, also detect when shell commands would modify files that are otherwise protected, closing the tool-substitution bypass.

## How It Works

1. Load a security policy file (YAML) that defines blocked command patterns, path access tiers (zero-access, read-only, confirm-write, no-delete), and per-project overrides.
2. When a shell command is invoked, test it against blocked, confirm, and alert pattern lists in priority order.
3. When a file operation is invoked, resolve the file path and check it against the path access tiers for the relevant action (read, write, delete).
4. For shell commands that modify files (sed -i, cp, mv, tee, redirects, inline scripts), extract the write targets and validate them against path rules — preventing tool-substitution bypasses.
5. Return block (hard stop), confirm (require manual execution), alert (log and allow), or allow.
6. Log every non-trivial security event with timestamp, tool, target, matched pattern, and action taken.

## Signals

- **Input:** Tool name, tool arguments (command string or file path), and session identifier on every tool invocation
- **Output:** Allow (proceed silently), alert (log and proceed), confirm (block with explanation, suggest manual execution), or block (hard stop with reason)

## Context

Designed for AI-assisted development environments where the AI has direct tool access. The YAML-based policy is user-editable, so security posture can be tuned per-project without code changes.
