# cli/types/

Type definitions for the `paih` CLI selective hook installer.

## Files

| File              | Purpose                                                               | Added in |
| ----------------- | --------------------------------------------------------------------- | -------- |
| `manifest.ts`     | `HookManifest`, `GroupManifest`, `PresetConfig` interfaces            | #4       |
| `resolved.ts`     | `HookDef` (resolved hook + file paths), `ResolvedHooks`               | #6       |
| `deps.ts`         | `CliDeps` interface (fs, process, chmod) + `InMemoryDeps` test double | #6       |
| `default-deps.ts` | `makeDefaultDeps()` factory wiring real filesystem adapters           | #7       |
| `lockfile.ts`     | `Lockfile`, `LockfileHookEntry`, `OutputMode`, `createLockfile()`     | #7       |
