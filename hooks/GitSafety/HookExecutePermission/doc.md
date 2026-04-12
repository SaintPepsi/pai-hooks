# HookExecutePermission

## Overview

HookExecutePermission is a **PostToolUse** hook that automatically sets the execute permission bit on `.hook.ts` files after they are written to the hooks directory. This prevents the recurring issue where newly created hooks lack the `+x` permission and fail silently at runtime.

The hook is a simple quality-of-life automation that eliminates a common source of confusion when developing new hooks.

## Event

`PostToolUse` — fires after a Write tool operation, automatically running `chmod +x` on the written file if it is a `.hook.ts` file inside the hooks directory.

## When It Fires

- The tool used is `Write`
- The written file path contains `/hooks/` and ends with `.hook.ts`

It does **not** fire when:

- The tool is anything other than `Write` (e.g., Edit, Bash)
- The file is not a `.hook.ts` file
- The file is not in a `/hooks/` directory
- The file path is missing from the tool input

## What It Does

1. Checks if the written file is a hook file (path contains `/hooks/` and ends with `.hook.ts`)
2. Runs `chmod +x` on the file path
3. Logs success or failure to stderr
4. Always returns `continue` — never blocks, even if chmod fails

```typescript
const result = deps.execSync(`chmod +x "${filePath}"`);
if (!result.ok) {
  deps.stderr(`[HookExecutePermission] chmod failed: ${result.error.message}`);
} else {
  deps.stderr(`[HookExecutePermission] Set +x on ${filePath}`);
}
return ok({ type: "continue", continue: true });
```

## Examples

### Example 1: New hook file gets execute permission

> You create a new hook file at `hooks/MyGroup/MyHook/MyHook.hook.ts` using the Write tool. HookExecutePermission detects the write, runs `chmod +x` on the file, and logs: "Set +x on hooks/MyGroup/MyHook/MyHook.hook.ts". The hook is immediately executable without manual intervention.

### Example 2: Non-hook file is ignored

> You write a new contract file at `hooks/MyGroup/MyHook/MyHook.contract.ts`. HookExecutePermission's `accepts` returns false because the file does not end with `.hook.ts`, so no chmod is performed.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `process` | adapter | Executes `chmod +x` to set the execute permission bit |
| `@anthropic-ai/claude-agent-sdk` | SDK | `SyncHookJSONOutput` return type; PostToolUse continue (R1 shape, post-SDK-refactor 1D) |
