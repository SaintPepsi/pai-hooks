# Hook Contracts

Pure business logic for PAI hooks. Each contract implements one of two typed interfaces from `core/contract.ts`:

- **`SyncHookContract<I, O, D>`** — `execute()` returns `Result<O, PaiError>`. Used by most hooks.
- **`AsyncHookContract<I, O, D>`** — `execute()` returns `Promise<Result<O, PaiError>>`. Used by hooks that perform async I/O (network calls, inference).

The runner accepts `HookContract<I, O, D>` (a union of both) and normalizes via `await Promise.resolve()`.

### Async Contracts

Six contracts use `AsyncHookContract`: CheckAlgorithmVersion, CheckVersion, LoadContext, RatingCapture, SessionAutoName, StopOrchestrator. All others use `SyncHookContract`.

## Contracts

| Contract | Event | Purpose |
|----------|-------|---------|
| **AgentTracker** | PreToolUse + PostToolUse | Tracks active sub-agent count per Claude session. PreToolUse increments, PostToolUse decrements a per-PID state file (`MEMORY/STATE/active-agents-{pid}.json`). Tracks session high-water mark (`maxCount`). Clamps count to 0 on decrement. Used by the statusline to display `★cli+agents/maxCli+maxAgents`. |
| **ArticleWriter** | SessionEnd | Spawns background agent to write blog articles. Gates: `articleWriter.repo` configured in `settings.json`, lock file (no concurrent), substance (PRD with 4+ checked ISC criteria). Repo auto-cloned to `~/.claude/cache/repos/`. Identity (DA name, principal name) from `settings.json`. |
| **BranchAwareness** | PostToolUse | Tracks git branch context |
| **CheckVersion** | SessionStart | Notifies if Claude Code update available |
| **CitationEnforcement** | PostToolUse | Ensures sources are cited after research |
| **CodingStandardsEnforcer** | PreToolUse | Blocks Edit/Write on .ts/.tsx/.svelte files with coding standard violations (including export default). For .svelte files, extracts `<script lang="ts">` block before scanning. |
| **DestructiveDeleteGuard** | PreToolUse | Blocks destructive delete patterns in Bash/Edit/Write: `rm -r`, `find -delete`, `python rmtree`, `node/bun rmSync`, `rsync --delete`, `git clean -d`, `ruby rm_rf`, `perl rmtree` (skips .md/.mdx). Allows plain `rm` of individual files, including paths with hyphens. |
| **ProtectedBranchGuard** | PreToolUse | Blocks `git commit`, `git push`, `git merge` on protected branches (main/master). Exempts `~/.claude` directory for GitAutoSync. Allows read-only git commands (status, log, diff). Fails open if branch cannot be determined. |
| **ExecutionEvidenceVerifier** | PostToolUse | Injects context reminder when state-changing Bash commands (git push, deploy, curl POST, etc.) produce thin/absent output. Never blocks — nudges the agent to show actual execution evidence. Classification logic in `lib/execution-classification.ts`. |
| **SecurityValidator** | PreToolUse | Validates Bash commands and file paths against YAML security patterns |
| **SonnetDelegation** | PostToolUse | Injects Sonnet subagent delegation guidance when executing-plans skill loads |
| **CodingStandardsAdvisor** | PostToolUse | Warns about violations when .ts/.tsx/.svelte files are Read. For .svelte files, extracts `<script lang="ts">` block before scanning. |
| **CodeQualityGuard** | PostToolUse | SOLID quality scoring for .ts/.tsx/.svelte and other source files (suppresses `type-import-ratio` and `options-object-width` for test files). For .svelte files, extracts `<script lang="ts">` block before scoring. |
| **CodeQualityBaseline** | PostToolUse | Stores quality baselines on Read for later delta comparison. Supports .svelte files via script block extraction. |
| **TypeCheckVerifier** | PostToolUse | Advisory type-checking after Edit/Write on .ts/.tsx/.svelte files. Discovers project type-check command (svelte-check, tsc --noEmit), runs it with 10s timeout, injects errors for the edited file as context. Debounced per file (60s). Never blocks. |
| **DocObligationStateMachine** | PostToolUse + Stop | Tracks code edits, blocks stop until docs updated |
| **GitAutoSync** | SessionEnd | Auto-commits and pushes ~/.claude on session end (debounced, with key file backup from `pai-hooks/hooks/`). Detects stale `index.lock` files (older than 2 minutes) and removes them to prevent permanent sync block. Respects active locks (recent) to avoid racing with active sessions. Cleans up stale index.lock if a git operation fails and leaves one behind. Timeouts: 15s git add, 20s git commit. |
| **HookExecutePermission** | PostToolUse | Auto-chmod on new hook files |
| **LoadContext** | SessionStart | Loads PAI context at session start |
| **MapleBranding** | PreToolUse | Blocks `gh` commands (pr/issue create/comment/edit/review, gh api) containing the default "Generated with Claude Code" footer. Instructs replacement with the Maple pixel-art sign-off (16x16 native resolution `<img>` tag). |
| **PRDSync** | PostToolUse | Syncs PRD.md frontmatter and criteria counts to `MEMORY/STATE/work.json` when Write/Edit targets `MEMORY/WORK/**/PRD.md`. Also updates the session state file (`current-work-{session_id}.json`) to point to the PRD's parent directory, so downstream consumers (ArticleWriter, etc.) can find the correct PRD even when the Algorithm creates one in a different directory than AutoWorkCreation's initial session dir. |
| **SessionAutoName** | UserPromptSubmit | AI-generates session titles |
| **SkillGuard** | PreToolUse | Validates skill invocations |
| **TestObligationStateMachine** | PostToolUse + Stop | Tracks code edits, blocks stop until tests run. Supports Node.js (.test./.spec./__tests__/), PHP/Laravel (*Test.php, tests/Feature/, tests/Unit/), Python, Go, Rust test conventions. |

## State Machine Pattern

`TestObligationStateMachine` and `DocObligationStateMachine` use the same two-contract pattern:

1. **Tracker** (PostToolUse): Monitors Edit/Write tool calls. Adds code files to a session-scoped pending list. Clears files when the obligation is satisfied (tests run / docs written).
2. **Enforcer** (Stop): Checks pending list when the agent tries to stop. Returns `BlockOutput` to prevent stopping if obligations remain. Tracks block count per session — after 2 blocks on the same files, writes a review doc and releases the session to prevent infinite loops.

State files are session-scoped: `{type}-pending-{session_id}.json` for pending lists, `{type}-block-count-{session_id}.txt` for block counters. Review docs written to `review-{session_id}.md` on block limit. Corrupt or empty state files are auto-recovered (reset to empty, logged to stderr).

## Auto-Generated File Exclusions

Both `CodingStandardsEnforcer` and `CodingStandardsAdvisor` skip auto-generated directories where code cannot conform to PAI coding standards. Managed via `isAutoGeneratedFile()` in `lib/coding-standards-checks.ts`.

Currently excluded:
- `module_bindings/` — SpacetimeDB auto-generated bindings

## Testing

Each contract has a co-located `.test.ts` file. Tests mock the `Deps` interface, never the filesystem directly.

```bash
bun test hooks/contracts/
```
