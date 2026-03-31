# pai-hooks

All Claude Code hooks for [@SaintPepsi](https://github.com/SaintPepsi)'s PAI setup. Install them into any Claude Code setup with a single command.

> **Note:** All hooks are custom-built. None originate from the [PAI upstream](https://github.com/danielmiessler/Personal_AI_Infrastructure) — the upstream provides the Algorithm, Skills, and context system but no hooks. Some hooks implement PAI Algorithm concepts (PRD tracking, Algorithm phase detection), others are general development aids.

## What's included

### PAI Algorithm

Hooks that implement or support the PAI Algorithm workflow.

| Hook                    | Event            | Description                                                   |
| ----------------------- | ---------------- | ------------------------------------------------------------- |
| `AlgorithmTracker`      | PostToolUse      | Detects Algorithm phase transitions from tool calls           |
| `PRDSync`               | PostToolUse      | Syncs PRD frontmatter and criteria to work.json for dashboard |
| `AutoWorkCreation`      | UserPromptSubmit | Creates MEMORY/WORK directories for new tasks                 |
| `LoadContext`           | SessionStart     | Loads PAI context files at session start                      |
| `StartupGreeting`       | SessionStart     | Displays PAI banner and system status                         |
| `CheckVersion`          | SessionStart     | Checks for Claude Code updates                                |
| `CheckAlgorithmVersion` | SessionStart     | Validates Algorithm version at session start                  |
| `SkillGuard`            | PreToolUse       | Validates Skill tool invocations                              |
| `VoiceGate`             | PreToolUse       | Controls voice notification routing                           |

### Session Management

Hooks that manage session lifecycle, learning, and state persistence.

| Hook                     | Event            | Description                                       |
| ------------------------ | ---------------- | ------------------------------------------------- |
| `SessionSummary`         | SessionEnd       | Generates session summary on end                  |
| `SessionQualityReport`   | SessionEnd       | Produces quality metrics per session              |
| `RatingCapture`          | UserPromptSubmit | Captures user ratings (1-10) for learning signals |
| `RelationshipMemory`     | SessionEnd       | Persists relationship context to memory           |
| `WorkCompletionLearning` | SessionEnd       | Extracts learning signals from completed work     |
| `LearningActioner`       | SessionEnd       | Spawns agent to analyze session learnings         |
| `ModeAnalytics`          | SessionEnd       | Tracks Algorithm/Native/Minimal mode usage        |
| `ArticleWriter`          | SessionEnd       | Generates article drafts from session content     |
| `UpdateCounts`           | SessionEnd       | Updates hook/file/signal counters for dashboard   |
| `QuestionAnswered`       | PostToolUse      | Tracks AskUserQuestion responses                  |
| `PreCompactStatePersist` | PreCompact       | Persists state before context compaction          |
| `LastResponseCache`      | Stop             | Caches last response for reference                |
| `StopOrchestrator`       | Stop             | Coordinates Stop event hooks                      |

### Security & Safety

Hooks that protect against destructive or unauthorized actions.

| Hook                         | Event       | Description                                            |
| ---------------------------- | ----------- | ------------------------------------------------------ |
| `SecurityValidator`          | PreToolUse  | Blocks writes to protected files (settings.json, etc.) |
| `DestructiveDeleteGuard`     | PreToolUse  | Confirms before recursive deletes or mass file removal |
| `BashWriteGuard`             | PreToolUse  | Prevents bypassing Edit/Write via Bash sed/echo        |
| `AgentExecutionGuard`        | PreToolUse  | Controls agent spawning permissions                    |
| `WorktreeSafetyVerification` | PostToolUse | Prevents cross-worktree contamination                  |
| `HookExecutePermission`      | PostToolUse | Controls hook execution permissions on Write           |

### Code Quality

Hooks that enforce coding standards and track quality metrics.

| Hook                      | Event        | Description                               |
| ------------------------- | ------------ | ----------------------------------------- |
| `TypeStrictness`          | PreToolUse   | Hard-blocks `any` types in TypeScript     |
| `CodingStandardsEnforcer` | PreToolUse   | Enforces coding standards on Write/Edit   |
| `CodingStandardsAdvisor`  | PostToolUse  | Suggests improvements post-Read           |
| `CodeQualityGuard`        | PostToolUse  | Blocks low-quality code patterns          |
| `CodeQualityBaseline`     | PostToolUse  | Tracks quality scores over time           |
| `MapleBranding`           | PreToolUse   | Enforces Maple identity in external comms |
| `GitignoreRecommender`    | SessionStart | Suggests .gitignore improvements          |

### Workflow & Obligations

Hooks that enforce development workflow practices.

| Hook                     | Event        | Description                                 |
| ------------------------ | ------------ | ------------------------------------------- |
| `BranchAwareness`        | SessionStart | Injects current git branch context          |
| `GitAutoSync`            | SessionEnd   | Auto-commits ~/.claude on session end       |
| `DocObligationTracker`   | PostToolUse  | Tracks doc changes alongside code           |
| `DocObligationEnforcer`  | Stop         | Enforces documentation obligations          |
| `TestObligationTracker`  | PostToolUse  | Tracks test changes alongside code          |
| `TestObligationEnforcer` | Stop         | Enforces test obligations                   |
| `ArchitectureEscalation` | PostToolUse  | Escalates after N failed fix attempts       |
| `SonnetDelegation`       | PostToolUse  | Routes sub-agent work to appropriate models |

### Citations

Hooks that track and enforce source attribution.

| Hook                  | Event       | Description                                 |
| --------------------- | ----------- | ------------------------------------------- |
| `CitationTracker`     | PostToolUse | Tracks citation sources from research tools |
| `CitationEnforcement` | PostToolUse | Enforces citations in written content       |

## Quick start

```bash
git clone https://github.com/SaintPepsi/pai-hooks.git
cd pai-hooks
bun install
bun run install-hooks
```

This merges all hooks into `settings.json` (located via `$PAI_DIR`, defaulting to `~/.claude`) and adds `export SAINTPEPSI_PAI_HOOKS_DIR="$PAI_DIR/pai-hooks"` to your `~/.zshrc` in a managed block. Requires `$PAI_DIR` to be set in your shell (e.g., via PAI's own zshrc block). The installer guarantees the managed block is placed after `# PAI-END` so that `$PAI_DIR` is always defined before `$SAINTPEPSI_PAI_HOOKS_DIR` — even on re-install if the block was previously misplaced.

If you already have hooks with the same name from another source (e.g., a PAI install), the installer detects the conflict and asks whether to keep existing, replace, or keep both. Use `--replace`, `--keep`, or `--both` to skip the prompt:

```bash
bun run install-hooks --replace   # replace conflicting hooks with pai-hooks versions
bun run install-hooks --keep      # keep your existing hooks, skip conflicting ones
bun run install-hooks --both      # install both (both fire on the same event)
```

## Uninstall

```bash
bun run uninstall-hooks
```

Cleanly removes all pai-hooks entries from `settings.json`, removes the managed block from `~/.zshrc`, and cleans up any legacy env var from `settings.json`. Leaves your other hooks untouched.

## How it works

Each hook follows a thin-shim pattern:

```
hooks/*.hook.ts    → Entry point (10-15 lines, imports contract + runs it)
contracts/*.ts     → Business logic (pure functions, dependency-injected)
core/              → Infrastructure (runner, adapters, Result type, error types)
lib/               → Shared utilities (identity, time, notifications)
```

All hooks use the `HookContract` pattern with dependency injection, making them fully testable without filesystem or network access.

### Structured logging

Every hook execution is logged to `MEMORY/STATE/logs/hook-log-YYYY-MM-DD.jsonl` via the runner. Each entry includes hook name, event, status (ok/error/skipped), duration, session ID, and error details. Query with:

```bash
# All errors today
jq 'select(.status == "error")' ~/.claude/MEMORY/STATE/logs/hook-log-$(date +%Y-%m-%d).jsonl

# Slow hooks (>1s)
jq 'select(.duration_ms > 1000)' ~/.claude/MEMORY/STATE/logs/hook-log-*.jsonl

# Errors by hook name
jq -s 'map(select(.status == "error")) | group_by(.hook) | map({hook: .[0].hook, count: length})' ~/.claude/MEMORY/STATE/logs/hook-log-*.jsonl
```

### Settings sync

The repo keeps `settings.hooks.json` as the portable hook registry:

- **Pre-commit** (author workflow): `export-hooks.ts` extracts your hooks from `settings.json` and writes `settings.hooks.json` with env var paths
- **Post-merge** (consumer workflow): `import-hooks.ts` merges `settings.hooks.json` back into `settings.json` after pulling updates
- **Install/Uninstall**: `install.ts` and `uninstall.ts` handle first-time setup and clean removal

## Hook Documentation

Every hook can have a `doc.md` file that gets rendered into a styled HTML documentation site using the [Agent HTML Design Framework](scripts/docs/agent-html-design-framework.html).

### Writing docs

Create `hooks/{Group}/{Hook}/doc.md` with these sections:

```markdown
## Overview

One-paragraph summary of what this hook does.

## Event

Which event triggers it and why.

## When It Fires

- Condition A
- Condition B

## What It Does

1. Step one
2. Step two

## Examples

### Example 1: Happy path

> User does X
> Hook responds with Y

## Dependencies

| Dep | Type    | Purpose  |
| --- | ------- | -------- |
| fs  | adapter | File I/O |
```

Bullet lists render as reason boxes, numbered lists as flow steps, code blocks as macOS-style code windows, blockquotes as conversation panels, and tables as styled data tables.

### Generating & checking

```bash
bun run docs:render    # Generate HTML site to docs/
bun run docs:check     # Verify all hooks have valid doc.md
```

The **HookDocEnforcer** hook automatically blocks session end if you modify hook source files without updating their `doc.md`. Configure via `hookConfig.hookDocEnforcer` in `settings.json`:

```json
{
  "hookConfig": {
    "hookDocEnforcer": {
      "enabled": true,
      "blocking": true,
      "requiredSections": [
        "## Overview",
        "## Event",
        "## When It Fires",
        "## What It Does",
        "## Examples",
        "## Dependencies"
      ]
    }
  }
}
```

## Testing

```bash
bun test                # Run all tests
bun run test:coverage   # Run with coverage report (90%+ line coverage)
```

1300+ tests across 60+ files with 2200+ expect() calls.

## Architecture

- **Runtime:** Bun (TypeScript)
- **Test framework:** bun:test
- **Git hooks:** Husky
- **Error handling:** Result<T, PaiError> (no try-catch in business logic)
- **I/O:** Adapter pattern (core/adapters/) wrapping Node builtins
- **Dependencies:** Injected via Deps interfaces on every contract

## License

MIT
