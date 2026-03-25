# Smoke Test — Verify Installed Hooks

Manual procedure to verify that hooks installed by `paih install` work correctly
in a Claude Code session.

## Prerequisites

- `bun` installed and on PATH
- `paih` CLI available (via `bun run cli/bin/paih.ts` or linked)
- A built pai-hooks source repo at a known path

## Steps

### 1. Create a test project directory

```bash
mkdir -p /tmp/paih-smoke/.claude
echo '{}' > /tmp/paih-smoke/.claude/settings.json
```

### 2. Run `paih install` targeting the test directory

```bash
paih install <hook-name> --to /tmp/paih-smoke
```

For example, to install the TypeStrictness hook:

```bash
paih install TypeStrictness --to /tmp/paih-smoke
```

### 3. Verify files were copied

```bash
ls -R /tmp/paih-smoke/.claude/hooks/
```

Expected: hook `.ts` files under `.claude/hooks/<Group>/<Hook>/` and core deps
under `.claude/hooks/_core/`.

### 4. Verify settings.json was updated

```bash
cat /tmp/paih-smoke/.claude/settings.json | jq .
```

Expected: a `hooks` key with an entry for the installed hook's event type
(e.g., `PreToolUse`) containing the hook command string.

### 5. Verify paih.lock.json was created

```bash
cat /tmp/paih-smoke/.claude/hooks/paih.lock.json | jq .
```

Expected: `lockfileVersion: 1`, a `hooks` array with one entry per installed
hook, and `fileHashes` for each hook's files.

### 6. Verify the hook fires in a Claude Code session

```bash
cd /tmp/paih-smoke
claude
```

In the Claude Code session, trigger the hook's event (e.g., for a `PreToolUse`
hook, use a tool that matches its matcher). Confirm the hook executes without
errors by checking Claude Code's hook output.

## Cleanup

```bash
rm -rf /tmp/paih-smoke
```
