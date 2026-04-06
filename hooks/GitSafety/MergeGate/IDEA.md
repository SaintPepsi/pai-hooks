# Merge Gate

> Block pull request merges when CI is failing or no approved review exists.

## Problem

Merging a pull request with failing CI or without an explicit approval ships broken or unreviewed code. AI assistants may attempt to merge after self-reviewing, skipping the human review requirement. Once merged to the main branch, the damage requires a revert, which adds noise and delays.

## Solution

Intercept merge commands, query both CI status and review status in real time, and block if either requirement isn't met. Require all CI checks to pass (not just be running) and at least one explicit approval (comments don't count). When both conditions fail, report both issues together.

## How It Works

1. When a shell command is about to execute, detect pull request merge commands.
2. Extract the PR number from the command, or resolve it from the current branch.
3. Query the CI system for check status — any failing or pending checks trigger a block.
4. Query the review system for approval status — at least one explicit approval is required.
5. If both CI and review fail, combine both messages into a single block response.
6. If only one fails, block with the specific issue.
7. If status can't be determined, fail open and allow the merge.

## Signals

- **Input:** Shell command string about to be executed
- **Output:** Block (with failing checks and/or missing review details) or pass
