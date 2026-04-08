## Overview

Injects individual steering rule files into context based on event type and keyword matching. Rules are `.md` files with YAML frontmatter declaring when they should fire. Each rule injects at most once per session, tracked via a gitignored JSON file.

Registered for both `SessionStart` and `UserPromptSubmit`. Skips subagent sessions.

## Event

`SessionStart` and `UserPromptSubmit` — fires at session initialization for always-on rules, and on each user prompt for keyword-triggered rules.

## When It Fires

- Every `SessionStart` for rules with empty keywords (always-inject)
- Every `UserPromptSubmit` when a rule's keywords match the prompt text (case-insensitive substring)

It does **not** fire when:

- Running in a subagent session
- Config has `enabled: false`
- No rule files resolve from the configured glob patterns
- No rules match the current event type
- On `UserPromptSubmit`, rules with empty keywords are skipped (must have at least one keyword)
- A rule has already been injected this session (per-session dedup)

## What It Does

1. Reads config from `hookConfig.steeringRuleInjector` (with defaults)
2. Resolves rule files from `includes` glob patterns (supports `${ENV_VAR}` expansion)
3. Parses YAML frontmatter from each file to extract `name`, `events`, and `keywords`
4. Filters rules by current event type
5. For `UserPromptSubmit`: filters by case-insensitive keyword substring match against prompt
6. Checks per-session injection tracker — skips already-injected rules
7. Concatenates matched rule bodies into a single `ContextOutput`
8. Records injected rules to tracker file at `{trackerDir}/injections-{sessionId}.json`

## Examples

> A session starts. SteeringRuleInjector resolves glob patterns and finds rules with `SessionStart` in their events and empty keywords. Those rules inject as context from the first interaction.

> The user submits "let's push to origin". The `git-safety` rule declares keywords `[push, remote, origin]`. "push" matches, so the rule injects. On the next prompt mentioning "push", the tracker prevents re-injection.

> The user submits a prompt about database migrations. No rules declare matching keywords. SteeringRuleInjector returns silent.

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
- `Bun.Glob` — resolves include patterns to file paths
