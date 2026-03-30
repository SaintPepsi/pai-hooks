# DuplicationIndexBuilder

Builds the duplication index on SessionStart (eager pre-warming) and PostToolUse (after `.ts` file writes).

## What It Does

Scans the project root for all `.ts` files, extracts function signatures using the parser
([`parser.ts`](../parser.ts)), and writes `.duplication-index.json` to the project's `.claude/` directory.
The index contains body hashes, name groups, and signature groups used by DuplicationChecker
([`DuplicationChecker/DuplicationChecker.contract.ts`](../DuplicationChecker/DuplicationChecker.contract.ts))
to identify duplicates.

## When It Fires

- Event: `SessionStart` — builds the index eagerly using CWD as the project anchor
- Event: `PostToolUse` — rebuilds after `Write` or `Edit` to any `.ts` file (`.d.ts` excluded)
- Skips rebuild if the existing index is less than 30 minutes old

## Hook Shell Routing

The hook shell (`DuplicationIndexBuilder.hook.ts`) reads stdin once and routes by event type:
- **SessionStart** (no `tool_name` in input): uses `runHookWith` to bypass the runner's tool_name validation
- **PostToolUse** (`tool_name` present): uses standard `runHook` with `stdinOverride`

## Silent Notification Hook

This hook returns `continue: true` with no `additionalContext`. It never blocks the agent
and produces no visible output. Diagnostic messages go to stderr only.

## Contract

[`DuplicationIndexBuilder.contract.ts`](DuplicationIndexBuilder.contract.ts)
