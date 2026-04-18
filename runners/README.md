# Runners

Background process wrapper spawned by hook contracts via `lib/spawn-agent.ts`.

## Runner

| Runner           | Spawned by                              | Purpose                                                                                                                                                                                                                |
| ---------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **agent-runner** | `spawnAgent()` via `lib/spawn-agent.ts` | Generic runner for any background agent. Receives config as JSON arg, runs `claude -p` synchronously, captures session ID from JSON output, logs JSONL events. BUN_TEST guard prevents accidental token burn in tests. |

All hook-specific agent spawning is handled by thin wrapper functions that call `spawnAgent()`:

| Wrapper              | Hook             | Location                                                        |
| -------------------- | ---------------- | --------------------------------------------------------------- |
| `runHardening()`     | SettingsRevert   | `hooks/SecurityValidator/run-hardening.ts`                      |
| `runLearningAgent()` | LearningActioner | `hooks/LearningFeedback/LearningActioner/run-learning-agent.ts` |
| `runArticleWriter()` | ArticleWriter    | `hooks/WorkLifecycle/ArticleWriter/run-article-writer.ts`       |

## How It Works

1. Contract checks gating conditions (lock, cooldown, substance, credit)
2. Contract calls its `run*()` wrapper function
3. Wrapper builds a prompt and calls `spawnAgent()` with hook-specific config
4. `spawnAgent()` checks lock, writes lock, logs "spawned" event, spawns `agent-runner.ts` as a detached process
5. `agent-runner.ts` runs `claude -p` synchronously with `--output-format json`
6. `agent-runner.ts` forwards any non-empty stderr from `claude` to `deps.stderr` (auth failures, rate limits, model errors)
7. `agent-runner.ts` captures session ID from JSON output
8. `agent-runner.ts` logs "completed" or "failed" event as JSONL
9. `agent-runner.ts` removes lock file in finally block

## Log Files

Each wrapper configures its own log and lock paths via `SpawnAgentConfig`:

| Wrapper              | Log file                                   | Lock file                              |
| -------------------- | ------------------------------------------ | -------------------------------------- |
| `runHardening()`     | `MEMORY/SECURITY/hardening-log.jsonl`      | `/tmp/pai-hardening-agent.lock`        |
| `runLearningAgent()` | `MEMORY/LEARNING/learning-agent-log.jsonl` | `MEMORY/LEARNING/PROPOSALS/.analyzing` |
| `runArticleWriter()` | `MEMORY/ARTICLES/article-writer-log.jsonl` | `MEMORY/ARTICLES/.writing`             |

All logs use structured JSONL: `{"ts":"...","event":"completed","source":"...","exitCode":0,"session":"...","resumed":"false"}`.

## Session Resumption

`agent-runner` supports session resumption via `sessionStatePath` in `RunnerConfig`. When set:

1. Before spawning, reads the state file for a previous session ID
2. If found, passes `--resume <session-id>` to reuse cached system prompt
3. If resume fails, falls back to a fresh session automatically
4. After success, writes the new session ID to the state file for next run

This reduces token cost on repeated runs by leveraging Claude's prompt cache.

## Safe Parsing

`agent-runner.ts` uses `safeJsonParse` from `core/adapters/json.ts` for all JSON parsing:

- **Session ID extraction** (line ~135): parses Claude's JSON output; logs to stderr and continues with empty session ID on failure
- **Config argument** (line ~185): parses the config JSON argument; exits with error on failure

This replaces bare `JSON.parse` calls that could throw on malformed input.

## Testing

```bash
bun test runners/
```
