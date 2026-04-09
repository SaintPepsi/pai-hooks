# Design: Shared Agent Spawning + Settings Hardening Loop

**Date:** 2026-04-09
**Status:** Approved

## Problem

SettingsRevert catches settings.json bypass commands and reverts them, but the same bypass works every time. SecurityValidator's `extractWriteTargets()` pattern-matches known write vectors, but novel methods slip through. There's no feedback loop — caught bypasses don't strengthen defenses.

Additionally, two existing hooks (ArticleWriter at `hooks/WorkLifecycle/ArticleWriter/ArticleWriter.contract.ts`, LearningActioner at `hooks/LearningFeedback/LearningActioner/LearningActioner.contract.ts`) duplicate the same agent-spawning boilerplate: lock file management, `spawnBackground()` calls, runner scripts with cleanup. No shared abstraction exists.

## Solution

A shared `spawnAgent()` function in `lib/spawn-agent.ts` that any hook can import to spawn a background Claude agent. SettingsRevert uses it to spawn a hardening agent that auto-adds `blocked` patterns to `patterns.yaml` when a bypass is caught.

## Components

### 1. `lib/spawn-agent.ts`

Shared function with this interface:

```typescript
interface SpawnAgentConfig {
  prompt: string;
  lockPath: string;          // prevents concurrent runs
  model?: string;            // default: "opus"
  maxTurns?: number;         // default: 5
  timeout?: number;          // default: 5 min (300_000 ms)
  cwd?: string;              // working directory for claude
  logPath: string;           // JSONL traceability log
  source: string;            // which hook spawned this
  reason: string;            // why it was spawned
}
```

Behavior:
1. Check lock file -- if exists and not stale, return early
2. Write lock file with `{ ts, source, reason, pid }`
3. Append `spawned` entry to `logPath`
4. Call `spawnBackground("bun", ["runners/agent-runner.ts", configJson])` (using `spawnBackground` from `core/adapters/process.ts`)
5. Return `Result<void, ResultError>`

Injected via deps so hooks can stub it in tests.

### 2. `runners/agent-runner.ts`

Generic runner that replaces per-hook runner scripts:

1. Receives config via CLI arg (JSON string)
2. Runs `claude -p "{prompt}" --max-turns N --model M`
3. Appends `completed` or `failed` entry to `logPath` in `finally` block
4. Removes lock file in `finally` block
5. Supports `--dry-run` flag: validates config, logs `dry-run` entry, exercises lock lifecycle, skips `claude` call

**Hard safety guard:** If `BUN_TEST=1` env var is present (set automatically by Bun's test runner — see [Bun test runner docs](https://bun.sh/docs/cli/test)) and `--dry-run` is not set, the runner throws immediately before invoking `claude`. This prevents accidental token burn in tests.

### 3. SettingsRevert integration

After `compareAndRevert()` (in `hooks/SecurityValidator/SettingsRevert/SettingsRevert.contract.ts`) reverts a change, call:

```typescript
spawnAgent({
  prompt: buildHardeningPrompt(command),
  lockPath: "/tmp/pai-hardening-agent.lock",
  logPath: join(deps.baseDir, "MEMORY/SECURITY/hardening-log.jsonl"),
  source: "SettingsRevert",
  reason: `bypass: ${command.slice(0, 200)}`,
});
```

The hardening prompt instructs the agent to:
1. Read `~/.claude/PAI/USER/PAISECURITYSYSTEM/patterns.yaml`
2. Add a `blocked` entry under `bash.blocked` that catches this command
3. Keep the pattern specific enough to avoid false positives
4. Use `reason: "Auto-hardened: {description} (caught {date})"` for traceability
5. Run `bun test` on SecurityValidator to verify no regressions
6. Commit with a message referencing the bypass command

## Defaults

- Model: opus
- Max turns: 5
- Timeout: 5 minutes (300,000 ms)

## Traceability

Three layers, no new tooling needed:

| Layer | File | What |
|-------|------|------|
| Revert event | `MEMORY/SECURITY/settings-audit.jsonl` | Original bypass detection (already exists) |
| Agent lifecycle | `MEMORY/SECURITY/hardening-log.jsonl` | `spawned` / `completed` / `failed` / `dry-run` entries |
| Pattern change | `git log` on `patterns.yaml` | What was added, with bypass command in commit message |

Log entry format:
```json
{"ts": "...", "event": "spawned", "source": "SettingsRevert", "reason": "bypass: jq ...", "lock": "/tmp/..."}
{"ts": "...", "event": "completed", "source": "SettingsRevert", "exitCode": 0, "duration_ms": 45000}
```

## Testing

- **Unit tests for `spawnAgent()`**: Stub `spawnBackground` in deps. Assert lock checks, log writes, correct CLI args. Zero cost.
- **Unit tests for `agent-runner.ts`**: Stub `execSyncSafe`. Test cleanup logic (lock removal, log append in finally). Zero cost.
- **Unit tests for `buildHardeningPrompt()`**: Pure function, assert output for given inputs. Zero cost.
- **Dry-run tests**: Call runner with `--dry-run`. Full flow including lock lifecycle, zero tokens.
- **NEVER spawn real claude in tests.** The `BUN_TEST` guard in the runner makes this impossible.

## Non-goals

- Modifying `extractWriteTargets()` source code automatically (manual review only)
- Queue/deferred processing -- spawns immediately on revert
- KoordDaemon integration
- Migration of existing runners (ArticleWriter, LearningActioner) -- future work
