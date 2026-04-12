# GitignoreRecommender

## Overview

GitignoreRecommender is a **SessionStart** hook that checks whether the current project has `respectGitignore` enabled in its Claude Code settings. If the setting is missing, the hook injects `additionalContext` suggesting the agent offer to enable it. This helps prevent accidental reading of sensitive gitignored files like `.env` and credentials.

The hook checks both `.claude/settings.json` and `.claude/settings.local.json` for the setting. It skips when running in the PAI root directory (`~/.claude`), which manages its own settings independently.

## Event

`SessionStart` — fires when a new Claude Code session begins, checking if `respectGitignore` is configured for the current project.

## When It Fires

- Every session start (accepts always returns true)
- The current working directory is not the PAI root (`~/.claude`)
- Neither `.claude/settings.json` nor `.claude/settings.local.json` has `respectGitignore: true`

It does **not** fire when:

- The current directory is the PAI root (`~/.claude`)
- `.claude/settings.json` already has `respectGitignore: true`
- `.claude/settings.local.json` already has `respectGitignore: true`

## What It Does

1. Gets the current working directory
2. Checks if the directory is the PAI root; if so, returns `continue` (skip)
3. Reads `.claude/settings.json` and checks for `respectGitignore: true`
4. If found, returns `continue` (no recommendation needed)
5. Reads `.claude/settings.local.json` and checks for `respectGitignore: true`
6. If found, returns `continue` (no recommendation needed)
7. If neither file has the setting, injects a recommendation as `additionalContext` suggesting the agent offer to add it

```typescript
// Check both settings files for respectGitignore
const settingsPath = join(projectDir, ".claude", "settings.json");
if (fileHasRespectGitignore(settingsPath, deps)) {
  return ok({ continue: true });
}

const localSettingsPath = join(projectDir, ".claude", "settings.local.json");
if (fileHasRespectGitignore(localSettingsPath, deps)) {
  return ok({ continue: true });
}

// Neither file has it — inject recommendation via hookSpecificOutput
// (SessionStart is a hookSpecific event; additionalContext lives under
// hookSpecificOutput, not at the top level)
return ok({
  continue: true,
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: RECOMMENDATION_CONTEXT,
  },
});
```

## Examples

### Example 1: Setting missing, recommendation injected

> A session starts in a project that has no `respectGitignore` in either settings file. GitignoreRecommender injects context asking the agent to offer: "This project doesn't have respectGitignore enabled in .claude/settings.local.json. Would you like me to add it?" If the user approves, the agent writes `{"respectGitignore": true}` to the local settings file.

### Example 2: Setting already present

> A session starts in a project where `.claude/settings.local.json` contains `{"respectGitignore": true}`. GitignoreRecommender detects the setting and returns `continue` with no additional context. No recommendation is shown.

## Dependencies

| Dependency                       | Type    | Purpose                                                                                                                                                                                                                                      |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fs`                             | adapter | Provides `fileExists` and `readFile` for reading settings files                                                                                                                                                                              |
| `error`                          | core    | Provides `fileReadFailed` for JSON parse error wrapping                                                                                                                                                                                      |
| `result`                         | core    | Provides `ok`, `Result`, and `tryCatch` for error handling                                                                                                                                                                                   |
| `@anthropic-ai/claude-agent-sdk` | sdk     | Provides `SyncHookJSONOutput` — the contract output shape (migrated from `@hooks/core/types/hook-outputs` in the SDK Type Foundation refactor). `additionalContext` now lives under `hookSpecificOutput` per the SessionStart discriminator. |
