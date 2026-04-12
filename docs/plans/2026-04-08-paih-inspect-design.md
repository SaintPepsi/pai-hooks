# Design: `paih inspect`

## Problem

Checking hook state requires manually navigating to temp directories, finding the right project hash, and opening JSON files. There's no quick way to see what a hook knows about a given project.

## Solution

Add a `paih inspect <hookName>` command that surfaces hook state with a summary view by default and raw dump on request. Each hook owns its own inspector logic (colocated in the hook directory).

## Usage

```
paih inspect <hookName> [--project <dir>] [--raw] [--json]
```

- `<hookName>` — required (e.g. `DuplicationChecker`)
- `--project <dir>` — project directory (defaults to pwd)
- `--raw` — dump full state file contents
- `--json` — output as JSON

## Default Output (DuplicationChecker)

```
DuplicationChecker — state for /Users/ian/my-project

  State file:  /tmp/pai/duplication/a1b2c3d4/main/index.json
  Built at:    2026-04-08 14:32:01
  Branch:      main
  Files:       28
  Functions:   142
  Patterns:    3 (1 tier-1, 2 tier-2)

  Hash groups:   45
  Name groups:   98
  Sig groups:    67
```

Always shows the full state file path.

With `--raw`: prints the full `index.json` to stdout.

## Architecture

### Files

| File                                                         | Purpose                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| `cli/commands/inspect.ts`                                    | Command handler — resolves project path, dispatches to hook inspector |
| `hooks/DuplicationDetection/DuplicationChecker/inspector.ts` | Reads duplication index, formats summary or raw output                |
| `cli/bin/paih.ts`                                            | Wire inspect into router, usage text, KNOWN_COMMANDS                  |
| `cli/commands/status.ts`                                     | **Delete** — unused stub                                              |

### Flow

1. User runs `paih inspect DuplicationChecker --project ~/my-project`
2. `inspect.ts` resolves project dir (flag or pwd)
3. Looks up hook name in a registry of inspectable hooks
4. Calls the hook's `inspector.ts` with project path and flags
5. Inspector uses `getArtifactsDir`/`projectHash`/`getCurrentBranch` from shared.ts to find state
6. Returns formatted summary or raw dump

### Inspector Interface

```typescript
interface InspectResult {
  statePath: string; // always present
  summary: string; // formatted summary text
  raw: string; // full file contents
  json: Record<string, unknown>; // structured data for --json
}

type Inspector = (projectDir: string) => Result<InspectResult, PaihError>;
```

### Error Cases

- Unknown hook name → `"Unknown hook: X. Inspectable hooks: DuplicationChecker"`
- No state file found → `"No state found for DuplicationChecker at <expected-path>"`

## Scope

DuplicationChecker only. Other hooks can add `inspector.ts` files later.

## Cleanup

- Delete `cli/commands/status.ts` (unused stub, never wired into router)
