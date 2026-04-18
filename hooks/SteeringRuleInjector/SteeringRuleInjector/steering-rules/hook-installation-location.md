---
name: hook-installation-location
events: [PreToolUse]
keywords: [hook, install, settings.json, PreToolUse, PostToolUse, SessionStart]
---

When installing a new hook to settings.json, add it to ~/.claude/settings.json under the appropriate event in hooks.{EventName}.

Hook entry format:
```json
{
  "matcher": "ToolName|OtherTool",
  "hooks": [{
    "type": "command",
    "command": "bun ${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/Group/HookName/HookName.hook.ts"
  }]
}
```

For hooks without a matcher (fire on all tools), omit the matcher field.
The SAINTPEPSI_PAI_HOOKS_DIR env var points to the pai-hooks repository.

Reference: ~/.claude/settings.json hooks section (lines 83-667)
