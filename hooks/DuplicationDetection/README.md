# DuplicationDetection

Detects duplicated functions across the codebase and warns before writing code that already exists elsewhere.

## Hooks

### DuplicationIndexBuilder (PostToolUse)

Fires after any Write or Edit to a `.ts` file. Scans the project root and builds `index.json` — a compact lookup structure of all functions with their body hashes, names, parameter signatures, and fingerprints. Skips rebuild if the index was written within the last 30 minutes.

See [`DuplicationIndexBuilder/README.md`](DuplicationIndexBuilder/README.md) for details.

### DuplicationChecker (PreToolUse)

Fires before any Write or Edit to a `.ts` file. Parses the incoming content, extracts functions, and checks them against the index. Tiered response: 2-3/4 signal matches are logged silently, 4/4 matches or hash matches block the operation (configurable via `hookConfig.duplicationChecker.blocking`).

**Derivation detection**: when body hash matches but type signatures differ, the checker emits an advisory warning ("possible derivation issue") instead of blocking. This identifies functions with identical implementations but different type contracts — a different class than duplication.

**Pattern detection**: the checker also detects recurring codebase patterns — functions whose name and signature appear across many files (e.g., `makeDeps` in 65 files). Patterns are auto-detected from the index at build time with configurable thresholds (`patternThreshold`, `requireSigMatch`, `sigMatchPercent`). When a new function matches a pattern, the checker injects an advisory via `additionalContext` suggesting consolidation. This is always advisory-only — it never blocks.

Every check (clean or with findings) is logged to `/tmp/pai/duplication/{hash}/{branch}/checker.jsonl` as JSONL for later inspection.

## How They Work Together

```
Write/Edit .ts file
       │
       ├─► PreToolUse: DuplicationChecker
       │     reads /tmp/pai/duplication/{hash}/{branch}/index.json
       │     parses incoming content
       │     emits additionalContext if duplicates found
       │     logs check to /tmp/pai/duplication/{hash}/{branch}/checker.jsonl
       │
       └─► PostToolUse: DuplicationIndexBuilder
             scans project root
             writes /tmp/pai/duplication/{hash}/{branch}/index.json
             (skips if index is fresh)
```

The builder produces the index; the checker reads it. On a first run (no index yet) the checker skips silently and the builder creates the index after the write completes. Subsequent writes benefit from the index immediately.

### Branch Awareness

Each branch gets its own artifact directory: `/tmp/pai/duplication/{hash}/{branch}/`. Switching branches means the builder and checker automatically use a separate index and log. No rebuild needed when switching back — the previous branch's index persists.

### Monorepo Behavior

SessionStart pre-warming uses CWD to find the project root. In monorepos, CWD is typically the repo root. The builder scans from the nearest project marker (`.git`, `package.json`, `composer.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`).

For monorepos without a root `package.json`, the first PostToolUse event on a subproject file builds the index for that subproject. Each subproject gets its own index scoped to its root.

## File Structure

```
DuplicationDetection/
├── README.md                          — this file
├── shared.ts                          — index types, loading, cache, check logic, formatting, PROJECT_MARKERS, getArtifactsDir, getCurrentBranch
├── parser.ts                          — TypeScript function extraction (serializeType for actual type names)
├── parser.test.ts                     — Parser tests including serializeType coverage
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
bun Tools/pattern-detector/variants/index-builder.ts build /path/to/your/project
```

The CLI writes `index.json` to the target directory. The hooks write to `/tmp/pai/duplication/{hash}/{branch}/index.json`.

## Inspecting the Log

Every DuplicationChecker invocation logs a JSONL entry to `/tmp/pai/duplication/{hash}/{branch}/checker.jsonl`:

```sh
# View all entries (replace {hash} with your project hash)
cat /tmp/pai/duplication/{hash}/{branch}/checker.jsonl | jq .

# View only findings (non-empty matches)
cat /tmp/pai/duplication/{hash}/{branch}/checker.jsonl | jq 'select(.matches | length > 0)'

# Count findings per file
cat /tmp/pai/duplication/{hash}/{branch}/checker.jsonl | jq -r 'select(.matches | length > 0) | .file' | sort | uniq -c | sort -rn
```

Both the index and the log live in `/tmp/pai/duplication/{project-hash}/{branch}/`, outside the project tree. No gitignore entries needed.
