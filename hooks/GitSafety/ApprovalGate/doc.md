# ApprovalGate

## Overview

ApprovalGate is a **PreToolUse** hook that prevents `gh pr review --approve` from executing when CI checks are failing on the target pull request. It ensures that PRs are only approved when CI is green, preventing rubber-stamp approvals of broken code.

When CI is passing, the hook still injects a verification reminder prompting Claude to confirm that local tests were run, acceptance criteria were verified with evidence, and a proper delegated review was performed.

## Event

`PreToolUse` — fires before Bash commands, detecting `gh pr review --approve` and checking CI status via the GitHub CLI before allowing or blocking the approval.

## When It Fires

- The tool is `Bash`
- The command matches the pattern `gh pr review ... --approve`
- The PR number is extractable from the command or resolvable from the current branch

It does **not** fire when:

- The tool is not `Bash`
- The command does not contain `gh pr review --approve`
- The PR number cannot be determined (fails open with a warning)
- CI status cannot be checked (fails open with a warning)

## What It Does

1. Extracts the command from the tool input
2. Checks if the command matches `gh pr review ... --approve`
3. Extracts the PR number from the command or resolves it from the current branch via `gh`
4. Checks CI status for the PR via shared `checkCiStatus` helper
5. If CI is failing: blocks with a message listing the failing checks
6. If CI is pending: allows but injects a warning suggesting to wait for CI completion
7. If CI is passing: allows and injects a verification reminder checklist

```typescript
if (ciStatus.failing.length > 0) {
  return ok(block(formatCiBlockMessage(prNumber, ciStatus.failing)));
}
if (ciStatus.pending.length > 0) {
  return ok(continueOk(formatPendingWarning(prNumber)));
}
return ok(continueOk(formatVerificationReminder(prNumber)));
```

## Examples

### Example 1: Approval blocked due to failing CI

> Claude runs `gh pr review 42 --approve`. ApprovalGate checks CI status for PR #42 and finds two failing checks (`test-unit: FAILURE`, `lint: FAILURE`). It blocks the approval with: "APPROVAL BLOCKED: CI checks are failing on PR #42. You cannot approve a PR with failing CI. Fix the issues first."

### Example 2: CI passing with verification reminder

> Claude runs `gh pr review 42 --approve` and CI is all green. ApprovalGate allows the approval but injects: "Before approving PR #42, confirm: You ran `bun test` and `tsc --noEmit` locally, you verified each acceptance criterion with evidence, you spawned a delegated reviewer agent."

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `shared` | shared | Provides `extractPrNumber`, `resolvePrFromBranch`, and `checkCiStatus` helpers |
| `process` | adapter | Executes `gh` CLI commands to check CI status |
| `@anthropic-ai/claude-agent-sdk` | SDK | `SyncHookJSONOutput` return type; PreToolUse block/advisory via `hookSpecificOutput` (R1+R2+R4 shapes, post-SDK-refactor 1D) |
