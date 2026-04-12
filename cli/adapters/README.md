# cli/adapters/

Result-wrapped I/O adapters for the `paih` CLI. Pattern matches `core/adapters/` from the hook system.

## Files

| File         | Purpose                                                                                                                                       | Added in |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `fs.ts`      | `readFile`, `writeFile`, `deleteFile`, `fileExists`, `readDir`, `ensureDir`, `removeDir`, `stat`, `chmod` — all return `Result<T, PaihError>` | #6       |
| `process.ts` | `exec`, `cwd` — Result-wrapped shell execution                                                                                                | #6       |
