# Doc Commit Guard — Design

## Goal

Block commits when any hook is missing `doc.md` or `IDEA.md`. Two enforcement points:

1. **Claude Code PreToolUse hook** (`DocCommitGuard`) — blocks `git commit` Bash commands
2. **Git pre-commit gate** (`pre-commit-gate.ts`) — updated to also check `IDEA.md`

## Change 1: DocCommitGuard (new Claude Code hook)

- **Location:** `hooks/CodingStandards/DocCommitGuard/`
- **Event:** `PreToolUse` (Bash)
- **Accepts:** Bash commands containing `git commit` (excluding `--amend` edge cases — still needs docs)
- **Execute:** Scans `hooks/*/*/hook.json` directories. For each, checks `doc.md` and `IDEA.md` exist. Blocks with list of missing files if any are absent.
- **Pattern:** Follows `BashWriteGuard` — same group, same deps pattern (`fileExists`, `scanHookJsons`)

## Change 2: pre-commit-gate.ts update

- Add `"missing-idea"` issue type to `GateIssue`
- Check for `IDEA.md` alongside `doc.md` in each hook directory
- Update `formatReport` to include IDEA.md errors

## What's NOT changing

- `HookDocEnforcer` (Stop event) stays as-is — it still blocks session end for session-modified hooks
- The obligation state machine is unaffected
- HTML rendering gate stays doc.md-only (IDEA.md doesn't render to HTML)
