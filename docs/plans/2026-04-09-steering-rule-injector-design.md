# SteeringRuleInjector Design

**Date:** 2026-04-09
**Status:** Approved

## Problem

PAI's steering rules (AISTEERINGRULES.md) were loaded via the LoadContext hook at SessionStart, but the full context output hit 90KB and got truncated by Claude Code. The hook was disabled to control token usage, leaving steering rules unloaded entirely.

Loading all rules at session start is wasteful — most rules are only relevant in specific contexts (e.g., git push safety rules only matter when pushing).

## Solution

A single **SteeringRuleInjector** hook registered for both `SessionStart` and `UserPromptSubmit`. Steering rules are individual `.md` files with frontmatter declaring when they should fire. Each rule injects at most once per session, tracked via a gitignored JSON file.

## Rule File Format

Each rule is a standalone `.md` file with YAML frontmatter:

```markdown
---
name: minimize-output-tokens
events: [UserPromptSubmit]
keywords: [tokens, output, cost, verbose, concise, brief]
---

Output tokens cost 5x input tokens. Lead with action, not reasoning...
```

- **`name`** — unique identifier, used for injection tracking
- **`events`** — hook events this rule fires on (`SessionStart`, `UserPromptSubmit`)
- **`keywords`** — substring matches against prompt text. Empty keywords on a `SessionStart` event means always-inject. Empty keywords on `UserPromptSubmit` means never-inject (must have at least one keyword to fire).

## Hook Architecture

### Directory Structure

```
hooks/SteeringRuleInjector/SteeringRuleInjector/
├── SteeringRuleInjector.contract.ts
├── SteeringRuleInjector.hook.ts
├── hook.json
├── steering-rules/
│   └── *.md
├── doc.md
├── IDEA.md
└── *.test.ts
```

### Execution Flow

1. Determine event type from input (`prompt` field present = `UserPromptSubmit`, absent = `SessionStart`)
2. Read config via `readHookConfig("steeringRuleInjector")`
3. Resolve all rule files from `includes` globs
4. Parse frontmatter, filter to rules matching current event
5. For `UserPromptSubmit`: substring-match keywords against prompt text (case-insensitive)
6. Check injection tracker — skip rules already injected this session
7. If no rules matched, return `SilentOutput`
8. Concatenate matched rule contents, return as `ContextOutput`
9. Record injected rule names to tracker file

### Event Type Detection

```typescript
const event = "prompt" in input && input.prompt != null
  ? "UserPromptSubmit"
  : "SessionStart";
```

### Injection Tracking

File-based, gitignored. Written to `{trackerDir}/injections-{sessionId}.json`:

```json
{
  "sessionId": "abc-123",
  "injected": {
    "identity-and-interaction": {
      "event": "SessionStart",
      "timestamp": "2026-04-09T07:42:17Z"
    },
    "minimize-output-tokens": {
      "event": "UserPromptSubmit",
      "timestamp": "2026-04-09T07:45:03Z"
    }
  }
}
```

Each rule injects at most once per session. The tracker file is the source of truth.

## Configuration

### hookConfig (via `readHookConfig`)

```json
{
  "hookConfig": {
    "steeringRuleInjector": {
      "enabled": true,
      "includes": [
        "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SteeringRuleInjector/SteeringRuleInjector/steering-rules/*.md",
        "${HOME}/.claude/PAI/USER/rules/*.md"
      ],
      "trackerDir": "MEMORY/STATE/.injections"
    }
  }
}
```

These are the default values — the hook uses them if no config is provided.

- **`enabled`** — kill switch
- **`includes`** — array of glob patterns for rule file discovery. Users extend by appending paths.
- **`trackerDir`** — directory for injection tracker files. Relative to PAI base dir.

### settings.hooks.json Registration

The same hook file registered under two events:

```json
{
  "SessionStart": [{
    "hooks": [{
      "type": "command",
      "command": "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.hook.ts"
    }]
  }],
  "UserPromptSubmit": [{
    "hooks": [{
      "type": "command",
      "command": "${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.hook.ts"
    }]
  }]
}
```

## Dependencies

- `core/adapters/fs` — `fileExists`, `readFile`, `readJson`, `stat`
- `lib/hook-config` — `readHookConfig`
- `lib/paths` — `getPaiDir`
- `lib/environment` — `isSubagent` (skip for subagents)
- Glob resolution — needs a glob adapter or inline implementation for resolving `includes` patterns

## Not In Scope (Future)

- Splitting existing AISTEERINGRULES.md into individual rule files
- Pre-compact integration / compact-aware injection decisions
- Inference-based semantic matching
- Token budgeting / injection cost tracking
- Other event types beyond SessionStart and UserPromptSubmit
