# cli/bin/

Entry point for the `paih` CLI.

## Files

| File      | Purpose                                                                                                 | Added in |
| --------- | ------------------------------------------------------------------------------------------------------- | -------- |
| `paih.ts` | CLI entry point: argv parsing, command routing, exit code mapping (0=success, 1=user error, 2=internal) | #6       |

## Usage

```
paih <command> [names...] [flags]

Commands: install, uninstall, update, verify, list, catalog, inspect
Flags: --help, --version, --to, --from, --in, --preset, --project, --force, --dry-run, --json, --raw, --groups, --presets, --compiled, --compiled-ts, --fix, --installed
```
