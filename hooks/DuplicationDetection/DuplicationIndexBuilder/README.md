# DuplicationIndexBuilder

PostToolUse hook that builds the duplication index after any `.ts` file write.

## What It Does

Scans the project root for all `.ts` files, extracts function signatures using the parser
([`parser.ts`](../parser.ts)), and writes `.duplication-index.json` to the project root.
The index contains body hashes, name groups, and signature groups used by DuplicationChecker
([`DuplicationChecker/DuplicationChecker.contract.ts`](../DuplicationChecker/DuplicationChecker.contract.ts))
to identify duplicates.

## When It Fires

- Event: `PostToolUse`
- Tool filter: `Write` or `Edit` to any `.ts` file (`.d.ts` excluded)
- Skips rebuild if the existing index is less than 30 minutes old

## Silent Notification Hook

This hook returns `continue: true` with no `additionalContext`. It never blocks the agent
and produces no visible output. Diagnostic messages go to stderr only.

## Contract

[`DuplicationIndexBuilder.contract.ts`](DuplicationIndexBuilder.contract.ts)
