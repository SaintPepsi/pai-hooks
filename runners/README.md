# Runners

Background process wrappers spawned by hook contracts at SessionEnd.

Each runner imports a prompt builder from its contract, runs `claude -p` synchronously, then handles lock/cooldown cleanup deterministically in code (not via prompt instructions).

## Runners

| Runner | Spawned by | Purpose |
|--------|-----------|---------|
| **article-writer-runner** | `ArticleWriter` contract | Runs claude to write Maple's Corner blog articles in the ianhogers.dev repo |
| **learning-agent-runner** | `LearningActioner` contract | Runs claude to analyze learning signals and create proposals |

## How They Work

1. Contract checks gating conditions (lock, cooldown, substance)
2. Contract spawns runner as a detached `bun` process via `spawnBackground`
3. Runner builds a prompt using the contract's exported builder function
4. Runner calls `claude -p` synchronously with `--max-turns` cap
5. Runner cleans up lock file and writes cooldown file after exit (success or failure)

The lock file persists while the child claude runs, preventing recursive spawning — any SessionEnd hooks in the child session see the lock and skip.

## Path Resolution

Contracts reference runners via `join(deps.baseDir, "pai-hooks/runners/<name>.ts")` where `baseDir` is `~/.claude`.

## Testing

```bash
bun test runners/
```
