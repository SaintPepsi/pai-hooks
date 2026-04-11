## Overview

Injects individual steering rule files into context based on event type and keyword matching. Rules are `.md` files with YAML frontmatter declaring when they should fire. Each rule injects at most once per session, tracked via a gitignored JSON file.

Registered for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`, and `Stop`. Skips subagent sessions (except on `SubagentStart` itself).

## Event

- `SessionStart` — always-inject rules with empty keywords fire at session initialization
- `UserPromptSubmit` — keyword-matched against prompt text; rules with matching keywords inject as context
- `PreToolUse` — keyword-matched against `tool_name` and `file_path`; returns `SyncHookJSONOutput` with `hookSpecificOutput.additionalContext` and `hookEventName: "PreToolUse"`
- `PostToolUse` — keyword-matched against `tool_name` and `file_path`; returns `SyncHookJSONOutput` with `hookSpecificOutput.additionalContext` and `hookEventName: "PostToolUse"`
- `SubagentStart` — always-inject rules with empty keywords fire when a subagent is spawned
- `Stop` — keyword-matched against `last_assistant_message`; blocks with matched rule as reason (Stop hooks cannot inject context)

## When It Fires

- Every `SessionStart` for rules with empty keywords (always-inject)
- Every `UserPromptSubmit` when a rule's keywords match the prompt text (case-insensitive substring)
- Every `PreToolUse` when rule keywords match `tool_name` or file path (case-insensitive substring)
- Every `PostToolUse` when rule keywords match `tool_name` or file path (case-insensitive substring)
- Every `SubagentStart` for rules with empty keywords (always-inject)
- Every `Stop` when rule keywords match `last_assistant_message` text (case-insensitive substring)

It does **not** fire when:

- Config has `enabled: false`
- No rule files resolve from the configured glob patterns
- No rules match the current event type
- On `UserPromptSubmit`/`Stop`, rules with empty keywords are skipped (must have at least one keyword)
- On `PreToolUse`/`PostToolUse`, rules with empty keywords are skipped (must have at least one keyword)
- A rule has already been injected this session (per-session dedup)

## What It Does

1. Reads config from `hookConfig.steeringRuleInjector` (with defaults)
2. Resolves rule files from `includes` glob patterns (supports `${ENV_VAR}` expansion)
3. Parses YAML frontmatter from each file to extract `name`, `events`, and `keywords`
4. Filters rules by current event type
5. Filters by keyword match — prompt text for `UserPromptSubmit`; `tool_name` + `file_path` + `skill` for `PreToolUse`/`PostToolUse`; `last_assistant_message` for `Stop`; empty keywords pass through for `SessionStart` and `SubagentStart`
6. Checks per-session injection tracker — skips already-injected rules
7. Concatenates matched rule bodies into output — `SyncHookJSONOutput` with `hookSpecificOutput.additionalContext` for context-injecting events; `{ decision: "block", reason }` for `Stop` events (Stop hooks cannot inject context)
8. Records injected rules to tracker file at `{trackerDir}/injections-{sessionId}.json`

## Examples

> A session starts. SteeringRuleInjector resolves glob patterns and finds rules with `SessionStart` in their events and empty keywords. Those rules inject as context from the first interaction.

> The user submits "let's push to origin". The `git-safety` rule declares keywords `[push, remote, origin]`. "push" matches, so the rule injects. On the next prompt mentioning "push", the tracker prevents re-injection.

> The user submits a prompt about database migrations. No rules declare matching keywords. SteeringRuleInjector returns silent.

> A `PreToolUse` event fires with `tool_name: Edit` and `file_path: src/styles/theme.css`. The `browser-mandatory` rule declares keywords `[.css, styles]`. ".css" matches the file path, so the rule injects as `additionalContext` before the tool runs.

> A `SubagentStart` event fires when spawning a new agent. Rules with `SubagentStart` in their events and empty keywords inject automatically, surfacing least-privilege and role-boundary rules at the start of every subagent session.

> Claude finishes a response containing "here's a quick fix". The `Stop` event fires with `last_assistant_message` containing that text. The `always-proper-fix` rule declares keywords `[quick fix, workaround]`. "quick fix" matches, so the hook blocks with the rule as the reason, forcing Claude to retry without presenting shortcuts.

### Rule File Format

```markdown
---
name: minimize-output-tokens
events: [UserPromptSubmit]
keywords: [tokens, output, cost, verbose, concise, brief]
---

Rule content injected as context...
```

### Configuration

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

## Dependencies

- `lib/hook-config` — reads `hookConfig.steeringRuleInjector` from settings.json
- `lib/environment` — `isSubagent()` to skip subagent sessions
- `lib/paths` — `getPaiDir()` for tracker file location
- `core/adapters/fs` — `readFile`, `readJson`, `writeJson`, `fileExists` for rule and tracker I/O
- `core/types/hook-input-schema` — Effect Schema for discriminated input parsing (replaces field-sniffing)
- `Bun.Glob` — resolves include patterns to file paths
- `Bun.Glob` — resolves include patterns to file paths
