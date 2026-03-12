# Hook Shells

Thin entry points that wire contracts to `runHook()`. No business logic lives here.

Each `.hook.ts` file:
1. Imports `runHook` from `@hooks/core/runner`
2. Imports its contract from `@hooks/contracts/`
3. Calls `runHook(Contract)` in `import.meta.main`

Business logic, types, and tests live in `../contracts/`. See `../contracts/README.md` for the full contract reference.

## Registration

Hooks are registered in `~/.claude/settings.json` under the appropriate event (`PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `Stop`, `UserPromptSubmit`). Each entry specifies a `matcher` (tool name) and the hook command path using `${SAINTPEPSI_PAI_HOOKS_DIR}`.
