# cli/commands/

Command implementations for the `paih` CLI. Each file exports a single function matching the command name.

## Commands

| Command | File | Purpose | Added in |
|---------|------|---------|----------|
| `install` | `install.ts` | Install hooks to target project (source, --compiled, --compiled-ts modes). Supports --preset flag. Compiles from source entry point for path alias resolution | #7, #9, #13, #14 |
| `uninstall` | `uninstall.ts` | Remove hooks with modification detection, shared.ts ref-counting | #10 |
| `update` | `update.ts` | Re-install hooks whose source changed (hash-based detection) | #10 |
| `verify` | `verify.ts` | Source-mode manifest validation + installed-mode drift detection. Reports FILE_UNREADABLE when hash verification fails to read a file | #10 |
| `list` | `list.ts` | Show installed hooks and status (ok/MISSING) from lockfile | #8 |
| `catalog` | `catalog.ts` | Show available hooks, groups, presets from manifests | #8 |

## Routing

Commands are routed from `cli/bin/paih.ts` via a switch statement. Each command receives `ParsedArgs` and `CliDeps`.
