# MergeGate

## Overview

MergeGate is a **PreToolUse** hook that prevents `gh pr merge` from executing when CI checks are not passing or when no approved review exists on the pull request. It enforces the requirement that PRs must have both green CI and an explicit approval before merging, preventing accidental merges of broken or unreviewed code.

The hook uses shared utilities with ApprovalGate for PR number resolution and CI/review status checking. It fails open on gh CLI errors to avoid blocking legitimate merges when GitHub is unreachable.

## Event

`PreToolUse` — fires before Bash commands, detecting `gh pr merge` and checking both CI status and review status before allowing the merge to proceed.

## When It Fires

- The tool is `Bash`
- The command matches the pattern `gh pr merge`
- The PR number is extractable from the command or resolvable from the current branch

It does **not** fire when:

- The tool is not `Bash`
- The command does not contain `gh pr merge`
- The PR number cannot be determined (fails open with a warning)
- CI status or review status cannot be checked (fails open with a warning)

## What It Does

1. Extracts the command from the tool input
2. Checks if the command matches `gh pr merge`
3. Extracts the PR number from the command or resolves it from the current branch
4. Checks CI status via shared `checkCiStatus` helper
5. Checks review status via shared `checkReviewStatus` helper
6. Blocks if CI is failing or pending, listing the problematic checks
7. Blocks if no approving review exists, listing current reviews and noting that COMMENTED reviews do not count
8. If both CI is failing and no approval exists, combines both messages
9. Allows if CI passes and an approved review exists

```typescript
if (ciFailing && noApproval) {
  return ok(block(`${ciMsg}\n\n${reviewMsg}`));
}
if (ciFailing) {
  return ok(block(formatCiBlockMessage(prNumber, allBadChecks)));
}
if (noApproval) {
  return ok(block(formatReviewBlockMessage(prNumber, reviewStatus.all)));
}
return ok(continueOk());
```

## Examples

### Example 1: Merge blocked due to failing CI

> Claude runs `gh pr merge 42 --squash`. MergeGate checks CI and finds `test-unit: FAILURE`. It blocks with: "MERGE BLOCKED: CI checks are not passing on PR #42. Wait for CI to pass before merging."

### Example 2: Merge blocked due to no approved review

> Claude runs `gh pr merge 42` and CI is passing, but only a COMMENTED review exists. MergeGate blocks with: "MERGE BLOCKED: No approving review found on PR #42. A reviewer must explicitly approve via `gh pr review 42 --approve`. COMMENTED reviews do not count as approval."

### Example 3: Both CI and review issues

> Claude runs `gh pr merge 42` with failing CI and no approval. MergeGate blocks with both the CI failure message and the review requirement message combined, ensuring both issues are addressed before retrying.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `shared` | shared | Provides `extractPrNumber`, `resolvePrFromBranch`, `checkCiStatus`, and `checkReviewStatus` |
| `process` | adapter | Executes `gh` CLI commands for CI and review status checks |
