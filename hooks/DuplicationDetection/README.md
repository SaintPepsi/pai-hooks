# DuplicationDetection

Detects duplicated functions across the codebase and warns before writing code that already exists elsewhere.

## Hooks

### DuplicationIndexBuilder (PostToolUse)

Fires after any Write or Edit to a `.ts` file. Scans the project root and builds `.duplication-index.json` — a compact lookup structure of all functions with their body hashes, names, parameter signatures, and fingerprints. Skips rebuild if the index was written within the last 30 minutes.

See [`DuplicationIndexBuilder/README.md`](DuplicationIndexBuilder/README.md) for details.

### DuplicationChecker (PreToolUse)

Fires before any Write or Edit to a `.ts` file. Parses the incoming content, extracts functions, and checks them against the index. If a function matches on 3 or more dimensions (body hash, name frequency, signature + fingerprint similarity), it surfaces an advisory via `additionalContext`. The agent can proceed — this hook never blocks.

## How They Work Together

```
Write/Edit .ts file
       │
       ├─► PreToolUse: DuplicationChecker
       │     reads .duplication-index.json
       │     parses incoming content
       │     emits additionalContext if duplicates found
       │
       └─► PostToolUse: DuplicationIndexBuilder
             scans project root
             writes .duplication-index.json
             (skips if index is fresh)
```

The builder produces the index; the checker reads it. On a first run (no index yet) the checker skips silently and the builder creates the index after the write completes. Subsequent writes benefit from the index immediately.

## File Structure

```
DuplicationDetection/
├── README.md                          — this file
├── shared.ts                          — index types, loading, cache, check logic, formatting
├── parser.ts                          — TypeScript function extraction
├── index-builder-logic.ts             — file scanning and index construction
├── DuplicationIndexBuilder/
│   ├── README.md
│   ├── DuplicationIndexBuilder.contract.ts
│   ├── DuplicationIndexBuilder.hook.ts
│   ├── DuplicationIndexBuilder.test.ts
│   ├── hook.json
│   └── settings.hooks.json
└── DuplicationChecker/
    ├── DuplicationChecker.contract.ts
    ├── DuplicationChecker.hook.ts
    ├── DuplicationChecker.test.ts
    ├── hook.json
    └── settings.hooks.json
```

## Manually Building the Index

To build or rebuild the index outside of a hook run:

```sh
bun Tools/pattern-detector/variants/index-builder.ts build <dir>
```

For example, from the pai-hooks root:

```sh
bun Tools/pattern-detector/variants/index-builder.ts build /Users/hogers/.claude/pai-hooks
```

The index is written to `.duplication-index.json` in the target directory.
