# MapleBranding

## Overview

MapleBranding is a **PreToolUse** hook that enforces consistent branding on GitHub CLI commands. It intercepts `gh` commands that create or modify PRs, issues, comments, and reviews, blocking any that contain the default "Generated with Claude Code" footer or use an emoji-only sign-off instead of the required HTML image sign-off.

When a command is blocked, the hook provides the correct Maple sign-off format (an HTML `<img>` tag with the maple leaf pixel art) so the agent can rewrite the command with proper branding.

## Event

`PreToolUse` — fires before a Bash tool call executes, blocking `gh` commands that use incorrect sign-off formatting.

## When It Fires

- The tool is `Bash` and the command matches a `gh` PR/issue create/comment/edit/review or `gh api` pattern
- The command body contains the default "Generated with [Claude Code]" footer
- The command body contains an emoji sign-off (`🍁 Maple`) without the HTML image version

It does **not** fire when:

- The tool is not `Bash`
- The command does not involve `gh` PR/issue/API operations
- The command already uses the correct HTML image sign-off (`<img ... alt="🍁"> Maple`)
- No sign-off or footer is present in the command

## What It Does

1. Checks if the tool is `Bash` and the command matches the `gh` command pattern (accepts gate)
2. Tests the command body against the Claude Code footer regex (`Generated with [Claude Code]`)
3. If the footer is found, blocks the command with a narrative message and the correct Maple sign-off
4. Tests the command body for emoji-only sign-off (`🍁 Maple` without the HTML `<img>` version)
5. If emoji sign-off is found, blocks with the same correction message
6. If neither problematic pattern is found, returns `continue` to allow execution

```typescript
// Pattern matching for gh commands
const GH_COMMAND_PATTERN = /\bgh\s+(?:(pr|issue)\s+(create|comment|edit|review)|api\b)/;
const CLAUDE_CODE_FOOTER = /Generated with \[Claude Code\]/i;
const EMOJI_SIGNOFF = /🍁\s*Maple/;
const HTML_IMG_SIGNOFF = /<img\s[^>]*alt="🍁"[^>]*>\s*Maple/;
```

## Examples

### Example 1: Claude Code footer detected

> The agent runs `gh pr create --body "... Generated with [Claude Code] ..."`. MapleBranding detects the default footer, blocks the command, and responds with the correct HTML image sign-off: `<img src="..." alt="🍁" width="16" height="16"> Maple`. The agent rewrites the PR body with the proper branding.

### Example 2: Emoji sign-off instead of HTML image

> The agent runs `gh issue comment --body "Fixed the bug. 🍁 Maple"`. MapleBranding detects the emoji-only sign-off (no HTML `<img>` tag) and blocks the command, providing the correct format. The agent retries with the HTML image version.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `narrative-reader` | lib | Provides `pickNarrative` for selecting block message tone |
| `result` | core | Provides `ok` and `Result` type for error handling |
| `@anthropic-ai/claude-agent-sdk` | SDK | `SyncHookJSONOutput` return type; PreToolUse R1 continue and R4×2 denies via `hookSpecificOutput.permissionDecision: "deny"` (post-SDK-refactor 1I, replaces legacy `BlockOutput | ContinueOutput`) |
