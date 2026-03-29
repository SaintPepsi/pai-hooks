# Adapters

Boundary layer wrapping Node builtins in `Result<T, PaiError>`. These are the **only** files in the hook system where try-catch is permitted (via `tryCatch`/`tryCatchAsync` from `core/result.ts`).

Contracts never import Node builtins directly — all I/O goes through these adapters.

## Files

| Adapter | Wraps | Key exports |
|---------|-------|-------------|
| `fs.ts` | `fs` (readFileSync, writeFileSync, etc.) | `readFile`, `writeFile`, `writeFileExclusive`, `readJson`, `writeJson`, `fileExists`, `stat`, `ensureDir`, `removeFile`, `copyFile`, `readDir`, `appendFile`, `symlink`, `lstat` |
| `process.ts` | `child_process` (execSync, spawnSync, spawn) | `exec`, `execSyncSafe`, `spawnSyncSafe`, `spawnBackground`, `shellForPlatform`, `getEnv` |
| `stdin.ts` | `process.stdin` | `readStdin(timeoutMs)` — reads stdin with timeout, returns `Result<string, PaiError>` |
| `log.ts` | `fs.appendFileSync` | `appendHookLog(entry)` — structured JSON logging for hook execution |
| `fetch.ts` | `globalThis.fetch` | `fetchJson`, `fetchText` — HTTP requests with timeout, returns `Result<T, PaiError>` |

## Pattern

Every adapter function returns `Result<T, PaiError>` instead of throwing. The `tryCatch` wrapper from `core/result.ts` converts exceptions at the boundary:

```typescript
export function readFile(path: string): Result<string, PaiError> {
  if (!existsSync(path)) return { ok: false, error: fileNotFound(path) };
  return tryCatch(
    () => readFileSync(path, "utf-8"),
    (e) => fileReadFailed(path, e),
  );
}
```

## Testing

Tests mock the `Deps` interface in contracts, never the adapters directly. Adapter tests (`*.test.ts`) use real filesystem operations in temp directories.

## Platform Awareness

`process.ts` provides `shellForPlatform(platform?)` which returns the correct shell command array for the current OS: `["cmd.exe", "/c"]` on `win32`, `["sh", "-c"]` on POSIX systems. The `exec()` function accepts an optional `platform` parameter in its opts for testability. `getEnv(key)` wraps `process.env` access for dependency injection.

## Type Safety

`readDir` uses TypeScript overloads: call with `{ withFileTypes: true }` to get `Result<Dirent[], PaiError>`, or without options to get `Result<string[], PaiError>`. `spawnSyncSafe` accepts `BufferEncoding` for encoding and typed stdio options.
