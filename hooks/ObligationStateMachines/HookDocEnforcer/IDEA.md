# Hook Documentation Enforcer

> Block session end if automation source files were changed without updating their documentation.

## Problem

Automation rules and plugins (hooks, extensions, middleware) have their own documentation that describes behavior, triggers, and configuration. When the source code of these automations changes but the docs do not, users encounter behavior that does not match what the documentation says.

## Solution

At session end, check whether any automation source files were modified without their local documentation being updated. Configurable watch patterns define which files count as source, and a configurable doc filename defines what counts as documentation. Supports both blocking and advisory (non-blocking) modes.

## How It Works

1. When the session is ending, check the pending obligations list (maintained by the companion tracker).
2. If no pending items exist or the feature is disabled, pass silently.
3. If in non-blocking mode, log a warning and pass silently.
4. If in blocking mode, block the session with a message listing the source files that need documentation updates and suggest what to add.
5. After the block limit is reached, release the session.

## Signals

- **Input:** Session end attempt, plus pending obligation state and configuration settings
- **Output:** Block with list of undocumented source changes, advisory warning, or silent pass
