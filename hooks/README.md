# Hook Shells

Thin entry points that wire contracts to `runHook()`. No business logic lives here.

Each `.hook.ts` file:
1. Imports `runHook` from `@hooks/core/runner`
2. Imports its contract from `@hooks/contracts/`
3. Calls `runHook(Contract)` in `import.meta.main`
4. Catches fatal errors (runner load failures) with `.catch((e) => { stderr; exit(0) })`

The `.catch` handler is a last-resort safety net. The runner itself handles all contract-level
errors internally. This outer catch only fires if the runner module fails to load or throws
synchronously before reaching the pipeline. Errors are logged to stderr before exiting.

Business logic, types, and tests live in `../contracts/`. See the top-level `README.md` for the full hook reference with categories and descriptions.

## All hooks

All 48 hooks are consolidated here. Settings.json references them via `${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/`.

| Hook | Contract | Event |
|------|----------|-------|
| **CronStatusLine group** (`CronStatusLine/`) | | |
| CronCreate | CronStatusLine/CronCreate/CronCreate.contract | PostToolUse |
| CronDelete | CronStatusLine/CronDelete/CronDelete.contract | PostToolUse |
| CronFire | CronStatusLine/CronFire/CronFire.contract | UserPromptSubmit |
| CronPrune | CronStatusLine/CronPrune/CronPrune.contract | SessionStart |
| | | |
| AgentExecutionGuard | AgentExecutionGuard | PreToolUse |
| AgentLifecycleStart | AgentLifecycle | SubagentStart |
| AgentLifecycleStop | AgentLifecycle | SubagentStop |
| AlgorithmTracker | AlgorithmTracker | PostToolUse |
| ArchitectureEscalation | ArchitectureEscalation | PostToolUse |
| ArticleWriter | ArticleWriter | SessionEnd |
| AutoWorkCreation | AutoWorkCreation | UserPromptSubmit |
| BashWriteGuard | BashWriteGuard | PreToolUse |
| BranchAwareness | BranchAwareness | SessionStart |
| CheckAlgorithmVersion | CheckAlgorithmVersion | SessionStart |
| CheckVersion | CheckVersion | SessionStart |
| CitationEnforcement | CitationEnforcement | PostToolUse |
| CitationTracker | CitationTracker | PostToolUse |
| CodeQualityBaseline | CodeQualityBaseline | PostToolUse |
| CodeQualityGuard | CodeQualityGuard | PostToolUse |
| CodingStandardsAdvisor | CodingStandardsAdvisor | PostToolUse |
| CodingStandardsEnforcer | CodingStandardsEnforcer | PreToolUse |
| DestructiveDeleteGuard | DestructiveDeleteGuard | PreToolUse |
| ProtectedBranchGuard | ProtectedBranchGuard | PreToolUse |
| DocObligationEnforcer | DocObligationStateMachine | Stop |
| DocObligationTracker | DocObligationStateMachine | PostToolUse |
| ExecutionEvidenceVerifier | ExecutionEvidenceVerifier | PostToolUse |
| GitAutoSync | GitAutoSync | SessionEnd |
| GitignoreRecommender | GitignoreRecommender | SessionStart |
| HookExecutePermission | HookExecutePermission | PostToolUse |
| LastResponseCache | LastResponseCache | Stop |
| LearningActioner | LearningActioner | SessionEnd |
| LoadContext | LoadContext | SessionStart |
| MapleBranding | MapleBranding | PreToolUse |
| ModeAnalytics | ModeAnalytics | SessionEnd |
| PRDSync | PRDSync | PostToolUse |
| PreCompactStatePersist | PreCompactStatePersist | PreCompact |
| QuestionAnswered | QuestionAnswered | PostToolUse |
| RatingCapture | RatingCapture | UserPromptSubmit |
| RelationshipMemory | RelationshipMemory | SessionEnd |
| SecurityValidator | SecurityValidator | PreToolUse |
| SessionQualityReport | SessionQualityReport | SessionEnd |
| SessionSummary | SessionSummary | SessionEnd |
| SkillGuard | SkillGuard | PreToolUse |
| SonnetDelegation | SonnetDelegation | PostToolUse |
| StartupGreeting | StartupGreeting | SessionStart |
| StopOrchestrator | StopOrchestrator | Stop |
| TestObligationEnforcer | TestObligationStateMachine | Stop |
| TestObligationTracker | TestObligationStateMachine | PostToolUse |
| TypeCheckVerifier | TypeCheckVerifier | PostToolUse |
| TypeStrictness | TypeStrictness | PreToolUse |
| UpdateCounts | UpdateCounts | SessionEnd |
| VoiceGate | VoiceGate | PreToolUse |
| WorkCompletionLearning | WorkCompletionLearning | SessionEnd |
| WorktreeSafetyVerification | WorktreeSafetyVerification | PostToolUse |
| | | |
| **KoordDaemon group** (`KoordDaemon/`) | | |
| SessionIdRegister | KoordDaemon/SessionIdRegister | SessionStart |
| AgentPrepromptInjector | KoordDaemon/AgentPrepromptInjector | PreToolUse |
| AgentSpawnTracker | KoordDaemon/AgentSpawnTracker | PostToolUse |
| AgentCompleteTracker | KoordDaemon/AgentCompleteTracker | PostToolUse |

## Registration

Hooks are registered in `~/.claude/settings.json` under the appropriate event (`PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `Stop`, `UserPromptSubmit`, `PreCompact`). Each entry specifies a `matcher` (tool name) and the hook command path using `${SAINTPEPSI_PAI_HOOKS_DIR}`.

## Testing

Hook shims are thin wrappers with no logic beyond `runHook(Contract)`. They do not have their own test files. All business logic and test coverage lives in the contract files (`../contracts/*.test.ts`). The runner itself is tested in `../core/runner.test.ts` and `../core/runner.coverage.test.ts`.

## Coding Standards

All hook and contract files follow the standards in `CLAUDE.md`:
- `@hooks/` path aliases (no relative imports)
- No raw Node builtins — use `core/adapters/` or `process.env.HOME` in defaultDeps
- No `process.env` outside `defaultDeps` object literals
- `import type` for type-only imports
- Result pipelines (no try-catch in business logic)
- Every `.catch` logs the error to stderr before discarding
