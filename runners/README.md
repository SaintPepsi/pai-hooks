# Runners

Background process wrappers spawned by hook contracts at SessionEnd.

Each runner imports a prompt builder from its contract, runs `claude -p` synchronously, then handles lock/cooldown cleanup deterministically in code (not via prompt instructions).

## Runners

| Runner | Spawned by | Purpose |
|--------|-----------|---------|
| **article-writer-runner** | `ArticleWriter` contract | Runs claude to write blog articles. Auto-clones repo from `hookConfig.articleWriter.repo` to `~/.claude/cache/repos/`. Identity from `settings.json`. |
| **learning-agent-runner** | `LearningActioner` contract | Runs claude to analyze learning signals and create proposals |

## How They Work

1. Contract checks gating conditions (lock, cooldown, substance)
2. Contract spawns runner as a detached `bun` process via `spawnBackground`
3. Runner builds a prompt using the contract's exported builder function
4. Runner logs START to its log file
5. Runner calls `claude -p` synchronously via `spawnSyncSafe` with `--max-turns` cap and `CLAUDECODE` unset in env
6. Runner logs COMPLETE (with exit code) or ERROR (with message)
7. Runner cleans up lock file and writes cooldown file
8. Runner logs CLEANUP confirmation

Both runners use `spawnSyncSafe` which returns `Result` (never throws), so cleanup always executes after the sync call returns.

The lock file persists while the child claude runs, preventing recursive spawning — any SessionEnd hooks in the child session see the lock and skip.

## Log Files

Each runner appends timestamped entries to a log file for diagnostics:

| Runner | Log file | Lock file |
|--------|----------|-----------|
| learning-agent-runner | `MEMORY/LEARNING/PROPOSALS/.analysis-log` | `MEMORY/LEARNING/PROPOSALS/.analyzing` |
| article-writer-runner | `MEMORY/ARTICLES/.writing-log` | `MEMORY/ARTICLES/.writing` |

Log entries use the format `{ISO timestamp} {STATUS} {details}` with statuses: START, COMPLETE, ERROR, CLEANUP.

## Path Resolution

Contracts reference runners via `join(deps.baseDir, "pai-hooks/runners/<name>.ts")` where `baseDir` is `~/.claude`.

## Testing

```bash
bun test runners/
```
