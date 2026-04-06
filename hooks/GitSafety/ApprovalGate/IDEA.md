# Approval Gate

> Block pull request approvals when CI checks are failing.

## Problem

Approving a pull request while CI is red creates a false signal that the code is ready to merge. AI assistants and rushed reviewers may approve based on a code read alone, skipping verification that automated checks actually pass. Once approved, the PR can be merged immediately, shipping broken code.

## Solution

Intercept pull request approval commands, query the CI status of the target PR in real time, and block the approval if any checks are failing. Warn if checks are still running. When CI is green, inject a verification reminder to confirm local testing was done.

## How It Works

1. When a shell command is about to execute, detect pull request approval commands.
2. Extract the PR number from the command, or resolve it from the current branch.
3. Query the CI system for the PR's check status.
4. If any checks are failing, block the approval and list the failing checks.
5. If checks are still pending, allow but warn that CI hasn't finished.
6. If all checks pass, allow and inject a reminder to verify local testing was also done.
7. If CI status can't be determined, fail open and allow the approval.

## Signals

- **Input:** Shell command string about to be executed
- **Output:** Block (with failing check details), warn (CI pending), advisory (verification reminder), or pass
