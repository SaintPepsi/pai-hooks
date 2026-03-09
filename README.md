# pai-hooks

A portable collection of 40 Claude Code hooks extracted from [PAI](https://github.com/danielmiessler/PAI). Install them into any Claude Code setup with a single command.

## What's included

**Security & Safety**
- `SecurityValidator` — blocks dangerous shell commands and destructive operations
- `DestructiveDeleteGuard` — confirms before deleting files
- `WorktreeSafetyVerification` — prevents cross-worktree contamination

**Code Quality**
- `CodingStandardsEnforcer` — enforces coding standards on Write/Edit
- `CodingStandardsAdvisor` — suggests improvements post-read
- `CodeQualityGuard` — blocks low-quality code patterns on Write/Edit
- `CodeQualityBaseline` — tracks quality scores over time on Read
- `TypeStrictness` — hard-blocks `any` types in TypeScript on Write/Edit
- `BashWriteGuard` — prevents bypassing Edit/Write via Bash sed/echo

**Workflow & Obligations**
- `BranchAwareness` — injects current git branch context at session start
- `GitAutoSync` — auto-commits ~/.claude on session end
- `DocObligationTracker` — tracks doc changes alongside code on Write/Edit
- `DocObligationEnforcer` — enforces documentation obligations on Stop
- `TestObligationTracker` — tracks test changes alongside code on Write/Edit/Bash
- `TestObligationEnforcer` — enforces test obligations on Stop
- `SkillGuard` — validates skill invocations on PreToolUse
- `HookExecutePermission` — controls hook execution permissions on Write
- `PRDSync` — syncs PRD frontmatter to work.json on Write/Edit

**Session Lifecycle**
- `StartupGreeting` — shows PAI banner at session start
- `LoadContext` — loads PAI context at session start
- `CheckVersion` — checks PAI version at session start
- `CheckAlgorithmVersion` — validates Algorithm version at session start
- `StopOrchestrator` — orchestrates stop-event hooks
- `SessionSummary` — generates session summaries on stop
- `SessionQualityReport` — produces quality metrics per session
- `LastResponseCache` — caches last response for reference on Stop
- `WorkCompletionLearning` — captures learnings on work completion
- `LearningActioner` — spawns agent to analyze session learnings
- `IntegrityCheck` — validates system integrity at session end
- `UpdateCounts` — updates signal/workflow counts at session end
- `GitAutoSync` — auto-commits ~/.claude at session end
- `ModeAnalytics` — tracks Algorithm/Native/Minimal mode usage at session end

**Intelligence & Tracking**
- `AlgorithmTracker` — tracks Algorithm phase transitions on Bash/Task
- `ArchitectureEscalation` — escalates after N failed fix attempts on TaskUpdate
- `AgentExecutionGuard` — controls agent/task spawning on PreToolUse
- `AutoWorkCreation` — auto-creates work entries from prompts on UserPromptSubmit
- `QuestionAnswered` — tracks question/answer patterns on AskUserQuestion
- `RelationshipMemory` — captures relationship notes from sessions at session end
- `VoiceGate` — routes voice notifications on Bash

**Citations**
- `CitationTracker` — tracks citation sources on WebSearch/WebFetch/Skill
- `CitationEnforcement` — enforces citations in written content on Write/Edit

### Origin

15 hooks come from the original [PAI framework](https://github.com/danielmiessler/PAI): `AgentExecutionGuard`, `AlgorithmTracker`, `AutoWorkCreation`, `CheckVersion`, `IntegrityCheck`, `LoadContext`, `QuestionAnswered`, `RelationshipMemory`, `SecurityValidator`, `SessionSummary`, `SkillGuard`, `StartupGreeting`, `StopOrchestrator`, `UpdateCounts`, `VoiceGate`, and `WorkCompletionLearning`.

The remaining 28 were built on top of PAI by [@SaintPepsi](https://github.com/SaintPepsi): `ArchitectureEscalation`, `BashWriteGuard`, `BranchAwareness`, `CheckAlgorithmVersion`, `CitationEnforcement`, `CitationTracker`, `CodeQualityBaseline`, `CodeQualityGuard`, `CodingStandardsAdvisor`, `CodingStandardsEnforcer`, `DestructiveDeleteGuard`, `DocObligationEnforcer`, `DocObligationTracker`, `GitAutoSync`, `HookExecutePermission`, `LastResponseCache`, `LearningActioner`, `ModeAnalytics`, `PRDSync`, `SessionQualityReport`, `TestObligationEnforcer`, `TestObligationTracker`, `TypeStrictness`, and `WorktreeSafetyVerification`.

3 hooks (`ArticleWriter`, `RatingCapture`, `SessionAutoName`) are PAI-specific and excluded from this repo but referenced in `settings.hooks.json` for completeness.

## Quick start

```bash
git clone https://github.com/SaintPepsi/pai-hooks.git
cd pai-hooks
bun install
bun run install-hooks
```

This merges all hooks into `~/.claude/settings.json` and sets the `SAINTPEPSI_PAI_HOOKS_DIR` environment variable.

If you already have hooks with the same name from another source (e.g., a PAI install), the installer detects the conflict and asks whether to keep existing, replace, or keep both. Use `--replace`, `--keep`, or `--both` flags to skip the prompt:

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
