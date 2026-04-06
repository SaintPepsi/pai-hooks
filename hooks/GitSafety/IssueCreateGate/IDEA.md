# Issue Create Gate

> Block direct issue creation to enforce workflow pipeline compliance.

## Problem

When a project has a structured workflow for issue creation — one that automatically sets milestones, assigns project board placement, and wires parent/child relationships — bypassing it with direct CLI or API calls creates orphaned issues. These issues have no milestone, no board placement, and no relationships, causing them to fall through the cracks and pollute the backlog.

## Solution

Intercept shell commands that would create issues directly via CLI or API, and block them unconditionally. Direct the author to use the designated issue creation workflow that handles all the metadata wiring automatically.

## How It Works

1. When a shell command is about to execute, detect issue creation commands (both CLI and API calls targeting issue endpoints).
2. Block the command with an explanation of what metadata would be missing.
3. Direct the author to the designated issue creation tool that handles milestones, board placement, and relationships.

## Signals

- **Input:** Shell command string about to be executed
- **Output:** Block (with explanation of the correct workflow) or pass
