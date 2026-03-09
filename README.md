# pai-hooks

A portable collection of 37 Claude Code hooks extracted from [PAI](https://github.com/danielmiessler/PAI). Install them into any Claude Code setup with a single command.

## What's included

23 hooks by [@SaintPepsi](https://github.com/SaintPepsi), 14 from the [PAI framework](https://github.com/danielmiessler/PAI).

**Security & Safety**
- `DestructiveDeleteGuard` — confirms before deleting files
- `WorktreeSafetyVerification` — prevents cross-worktree contamination
- `SecurityValidator` — blocks dangerous shell commands and destructive operations *(PAI)*

**Code Quality**
- `CodingStandardsEnforcer` — enforces coding standards on `Write`/`Edit`
- `CodingStandardsAdvisor` — suggests improvements post-`Read`
- `CodeQualityGuard` — blocks low-quality code patterns on `Write`/`Edit`
- `CodeQualityBaseline` — tracks quality scores over time on `Read`
- `TypeStrictness` — hard-blocks `any` types in TypeScript on `Write`/`Edit`
- `BashWriteGuard` — prevents bypassing `Edit`/`Write` via `Bash` sed/echo

**Workflow & Obligations**
- `BranchAwareness` — injects current git branch context at session start
- `GitAutoSync` — auto-commits `~/.claude` on session end
- `DocObligationTracker` — tracks doc changes alongside code on `Write`/`Edit`
- `DocObligationEnforcer` — enforces documentation obligations on `Stop`
- `TestObligationTracker` — tracks test changes alongside code on `Write`/`Edit`/`Bash`
- `TestObligationEnforcer` — enforces test obligations on `Stop`
- `HookExecutePermission` — controls hook execution permissions on `Write`
- `PRDSync` — syncs PRD frontmatter to `work.json` on `Write`/`Edit` *(PAI)*
- `SkillGuard` — validates skill invocations on `PreToolUse` *(PAI)*

**Session Lifecycle**
- `CheckAlgorithmVersion` — validates Algorithm version at session start
- `LastResponseCache` — caches last response for reference on `Stop`
- `SessionQualityReport` — produces quality metrics per session
- `LearningActioner` — spawns agent to analyze session learnings
- `ModeAnalytics` — tracks Algorithm/Native/Minimal mode usage at session end
- `StartupGreeting` — shows PAI banner at session start *(PAI)*
- `LoadContext` — loads PAI context at session start *(PAI)*
- `CheckVersion` — checks PAI version at session start *(PAI)*
- `SessionSummary` — generates session summaries on `Stop` *(PAI)*
- `WorkCompletionLearning` — captures learnings on work completion *(PAI)*
- `VoiceGate` — routes voice notifications on `Bash` *(PAI)*

**Intelligence & Tracking**
- `ArchitectureEscalation` — escalates after N failed fix attempts on `TaskUpdate`
- `AlgorithmTracker` — tracks Algorithm phase transitions on `Bash`/`Task` *(PAI)*
- `AgentExecutionGuard` — controls agent/task spawning on `PreToolUse` *(PAI)*
- `AutoWorkCreation` — auto-creates work entries from prompts on `UserPromptSubmit` *(PAI)*
- `QuestionAnswered` — tracks question/answer patterns on `AskUserQuestion` *(PAI)*
- `RelationshipMemory` — captures relationship notes from sessions at session end *(PAI)*

**Citations**
- `CitationTracker` — tracks citation sources on `WebSearch`/`WebFetch`/`Skill`
- `CitationEnforcement` — enforces citations in written content on `Write`/`Edit`

## Quick start

```bash
git clone https://github.com/SaintPepsi/pai-hooks.git
cd pai-hooks
bun install
bun run install-hooks
```

This merges all hooks into `~/.claude/settings.json` and sets the `SAINTPEPSI_PAI_HOOKS_DIR` env var.

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

Cleanly removes all pai-hooks entries and the env var from `settings.json`, leaving your other hooks untouched.

## How it works

Each hook follows a thin-shim pattern:

```
hooks/*.hook.ts    → Entry point (10-15 lines, imports contract + runs it)
contracts/*.ts     → Business logic (pure functions, dependency-injected)
core/              → Infrastructure (runner, adapters, Result type, error types)
lib/               → Shared utilities (identity, time, notifications)
```

All hooks use the `HookContract` pattern with dependency injection, making them fully testable without filesystem or network access.

### Settings sync

The repo keeps `settings.hooks.json` as the portable hook registry:

- **Pre-commit** (author workflow): `export-hooks.ts` extracts your hooks from `settings.json` and writes `settings.hooks.json` with env var paths
- **Post-merge** (consumer workflow): `import-hooks.ts` merges `settings.hooks.json` back into `settings.json` after pulling updates
- **Install/Uninstall**: `install.ts` and `uninstall.ts` handle first-time setup and clean removal

## Testing

```bash
bun test                # Run all tests
bun run test:coverage   # Run with coverage report (87%+ line coverage)
```

## Architecture

- **Runtime:** Bun (TypeScript)
- **Test framework:** bun:test
- **Git hooks:** Husky
- **Error handling:** Result<T, PaiError> (no try-catch in business logic)
- **I/O:** Adapter pattern (core/adapters/) wrapping Node builtins
- **Dependencies:** Injected via Deps interfaces on every contract

## License

MIT
