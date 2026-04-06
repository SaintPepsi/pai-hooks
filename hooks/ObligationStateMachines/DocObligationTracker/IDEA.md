# Documentation Obligation Tracker

> Track which code files changed and whether their documentation was updated.

## Problem

To enforce documentation obligations, the system needs to know two things: which code files were modified, and whether the corresponding documentation was subsequently updated. Without tracking both sides, enforcement cannot determine which obligations are fulfilled.

## Solution

Watch every file write. When a code file (non-test, non-doc) is written, add it to a pending obligations list. When a documentation file is written, check whether it relates to any pending code file and remove those entries. Configurable exclude patterns allow skipping files that do not need documentation.

## How It Works

1. On each file write, determine whether the file is a code file or a documentation file.
2. If it is a code file (excluding tests and configured exclusion patterns), add it to the pending list.
3. If it is a documentation file, check the pending list for related code files and remove any matches.
4. If all pending items are cleared, remove the state file entirely.

## Signals

- **Input:** File path on every file write or edit operation
- **Output:** Updated pending obligations list in session state (consumed by the companion enforcer)
