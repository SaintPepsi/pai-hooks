# Documentation Obligation Enforcer

> Block session end if code was changed without updating related documentation.

## Problem

Code changes frequently land without corresponding documentation updates. The documentation drifts out of sync, misleading future readers. By the time anyone notices, the original author has lost context on what changed and why.

## Solution

At session end, check whether any code files were modified without their related documentation being updated. If unfulfilled documentation obligations remain, block the session and list exactly which files need docs. After a configurable number of blocks, release the session and write a review log of what was skipped.

## How It Works

1. When the session is ending, check the pending obligations list (maintained by the companion tracker).
2. If no pending items exist, pass silently.
3. If pending items exist, check the block count for this session.
4. If under the block limit, block the session with a message listing the files that need documentation and suggest where to write it.
5. If the block limit is reached, write a review log, clear the pending list, and release the session.

## Signals

- **Input:** Session end attempt, plus pending obligation state from the companion tracker
- **Output:** Block with list of undocumented files and suggestions, or silent release
