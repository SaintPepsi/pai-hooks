# Test Obligation Enforcer

> Block session end if code was changed without writing or running tests.

## Problem

Code changes that ship without test coverage introduce silent regressions. Developers and AI assistants often modify code and forget to write new tests or run existing ones. The gap between "code works when I tried it" and "code is verified by tests" is where bugs hide.

## Solution

At session end, check whether any code files were modified without their tests being written or run. Distinguish between files that have no test file at all (need tests written) and files that have tests but were not run this session. After a configurable number of blocks, release the session and write a review log.

## How It Works

1. When the session is ending, check the pending obligations list (maintained by the companion tracker).
2. If no pending items exist, pass silently.
3. For each pending file, check whether a corresponding test file exists.
4. Separate files into "needs tests written" and "needs existing tests run."
5. Block the session with a categorized list showing what action each file needs.
6. After the block limit is reached, write a review log and release the session.

## Signals

- **Input:** Session end attempt, plus pending obligation state from the companion tracker
- **Output:** Block with categorized list of untested files, or silent release
