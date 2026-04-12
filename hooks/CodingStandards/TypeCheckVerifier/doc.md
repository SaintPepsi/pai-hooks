# TypeCheckVerifier

## Overview

TypeCheckVerifier is a **PostToolUse** hook that runs the project's TypeScript type checker after Edit or Write operations on `.ts`, `.tsx`, or `.svelte` files. It discovers the appropriate type-check command (svelte-check, tsc, vue-tsc, etc.) by walking up the directory tree, runs it with a 10-second timeout, and injects any type errors for the edited file as advisory context.

This hook never blocks. It is debounced per file (60 seconds) to avoid running the type checker repeatedly on rapid successive edits. All executions are logged to the signal logger for pattern analysis.

## Event

`PostToolUse` — fires after Edit or Write operations on TypeScript/Svelte files and reports any type errors found by the project's type checker.

## When It Fires

- An Edit or Write tool has just completed on a `.ts`, `.tsx`, or `.svelte` file
- The file has not been type-checked in the last 60 seconds (debounce)
- A type-check command can be discovered in the project

It does **not** fire when:

- The tool is not Edit or Write
- The target file is not a TypeScript or Svelte file
- The file was already checked within the last 60 seconds (debounced)
- No type checker is found (no `check`/`typecheck` script in `package.json`, no `tsconfig.json`)

## What It Does

1. Extracts the file path from the tool input
2. Discovers the project's type-check command by walking up the directory tree:
   - First looks for a `check` script in `package.json` (covers svelte-check, astro check, etc.)
   - Then looks for a `typecheck` script in `package.json`
   - Falls back to `npx tsc --noEmit` if a `tsconfig.json` exists
3. Runs the discovered command with a 10-second timeout
4. Marks the file as checked (starts the 60-second debounce timer)
5. Parses the output for errors specific to the edited file (handles both tsc and svelte-check output formats)
6. If errors are found, formats an advisory with line numbers and error messages, injected via `hookSpecificOutput.additionalContext` (R2 PostToolUse channel)
7. Logs the outcome (clean, errors, or timeout) to the signal logger

```typescript
// Core type-check flow
const typeCheck = discoverTypeCheck(filePath, deps);
const result = deps.execWithTimeout(
  typeCheck.cmd,
  typeCheck.args,
  typeCheck.cwd,
  10_000,
);
markChecked(filePath);

const errors = parseTypeErrors(combinedOutput, filePath);
if (errors.length > 0) {
  return ok({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: formatAdvisory(errors, filePath),
    },
  });
}
```

## Examples

### Example 1: Type error detected after edit

> The model edits `src/api.ts` and introduces a type mismatch. TypeCheckVerifier runs `npx tsc --noEmit`, parses the output, and finds "Argument of type 'string' is not assignable to parameter of type 'number'" on line 42. It injects the error as advisory context so the model can fix it immediately.

### Example 2: Type checker times out

> The model edits a file in a large project where `tsc --noEmit` takes more than 10 seconds. TypeCheckVerifier logs a timeout event to the signal logger and returns `continue` silently -- it never blocks the workflow due to slow type checking.

### Example 3: Debounced repeat edit

> The model edits `src/utils.ts` twice within 30 seconds. The first edit triggers a full type check. The second edit is skipped because the 60-second debounce timer has not expired.

## Dependencies

| Dependency                       | Type      | Purpose                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `result`                         | core      | `ok()` for Result-based returns                                                                                                                                                                                                                                                                                     |
| `fs`                             | adapter   | `fileExists`, `readFile` for project discovery                                                                                                                                                                                                                                                                      |
| `process`                        | adapter   | `spawnSyncSafe` for running type-check commands                                                                                                                                                                                                                                                                     |
| `signal-logger`                  | lib       | Logs execution outcomes to JSONL for analysis                                                                                                                                                                                                                                                                       |
| `svelte-utils`                   | lib       | `isSvelteFile` for Svelte file detection                                                                                                                                                                                                                                                                            |
| `@anthropic-ai/claude-agent-sdk` | SDK types | `SyncHookJSONOutput` return type; `hookSpecificOutput.additionalContext` with `hookEventName: "PostToolUse"` is the PostToolUse-compatible advisory channel (post-SDK-refactor, fixes a bug where the legacy top-level `additionalContext` from `continueOk(advisory)` was silently dropped for PostToolUse events) |
