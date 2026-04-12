# IssueCreateGate

## Overview

IssueCreateGate is a **PreToolUse** hook that blocks `gh issue create` and `gh api .../issues` calls. These commands bypass the `submit_issue` MCP tool, which is the only entrypoint that wires milestones, project board placement, and issue relationships correctly. Calls made directly via `gh` leave orphaned issues with no milestone, no board placement, and no sub-issue links.

## Event

`PreToolUse` — fires before Bash commands execute.

## When It Fires

- Tool name is `Bash`
- Command matches `gh issue create ...` or `gh api .../issues ...`

It does **not** fire when:

- The command is any non-Bash tool
- The command is an unrelated `gh` subcommand (e.g. `gh pr list`)

## What It Does

1. Extracts the command string from Bash tool input via `getCommand`
2. Tests against `ISSUE_CREATE_PATTERN` (`/\bgh\s+(issue\s+create|api\b[^|&;]*\/issues\b)/`)
3. If no match → `ok({ continue: true })`
4. If match → `ok({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: BLOCK_MESSAGE } })` — SDK-canonical R4 deny shape

## Examples

> **Blocked:** `gh issue create --title "Bug"` — Direct issue creation, blocked with submit_issue guidance
> **Blocked:** `gh api repos/owner/repo/issues -f title=Bug` — `gh api` call targeting an `/issues` endpoint
> **Allowed:** `gh pr list` — Unrelated gh subcommand
> **Allowed:** `gh issue list` — Read-only issue command

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `lib/tool-input` | lib | Provides `getCommand` helper for extracting Bash command |
| `lib/paths` | lib | Provides `defaultStderr` for logging |
| `@anthropic-ai/claude-agent-sdk` | SDK | `SyncHookJSONOutput` return type; PreToolUse block via `hookSpecificOutput.permissionDecision: "deny"` (R4, 1D migration) |
