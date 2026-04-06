# Test Obligation Tracker

> Track which code files changed and whether their tests were written or run.

## Problem

To enforce test obligations, the system needs to track two things: which code files were modified, and whether tests covering those files were subsequently run. Without tracking both the code changes and the test executions, enforcement cannot determine which obligations are fulfilled.

## Solution

Watch every file write and command execution. When a non-test code file is written, add it to a pending obligations list. When a test command is executed, determine which source files it covers and remove those from the pending list. A full test suite run clears all pending items. Configurable exclude patterns allow skipping files that do not need tests.

## How It Works

1. On each file write, if the file is a non-test code file (and not excluded), add it to the pending list.
2. On each command execution, check if it is a test command (e.g., test runner invocation).
3. If a targeted test run, extract which source files are covered and remove matching pending entries.
4. If a full test suite run, clear all pending entries.
5. If all pending items are cleared, remove the state file entirely.

## Signals

- **Input:** File paths on write/edit operations, and command strings on shell executions
- **Output:** Updated pending obligations list in session state (consumed by the companion enforcer)
