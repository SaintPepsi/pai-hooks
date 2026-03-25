# test-fixtures/manifests/

Synthetic test fixtures for the manifest validator unit tests (`cli/core/validator.test.ts`).

Each fixture is a pair: a minimal contract file (`*-contract.ts`) and a manifest (`*-hook.json`).

## Fixtures

| Prefix | Tests | Contract imports | Manifest declares |
|--------|-------|-----------------|-------------------|
| `valid` | No diagnostics when deps match | `core/result`, `adapters/fs` | Same |
| `missing-dep` | MANIFEST_MISSING_DEP detection | `core/result`, `lib/paths` | `core/result` only (missing `lib/paths`) |
| `ghost-dep` | MANIFEST_GHOST_DEP detection | `core/result` only | `core/result` + `lib/identity` (ghost) |
| `type-only` | Type-only imports excluded from missing | `import type` from `core/error` | Does not declare `core/error` |
| `shared-missing` | MANIFEST_SHARED_MISSING detection | `core/result` | Declares `shared: ["nonexistent.shared.ts"]` |

## Contract files

The `*-contract.ts` files are minimal TypeScript with just enough `import` statements to exercise the validator's regex parser. They are NOT real hook contracts and are excluded from `tsconfig.json` via the `test-fixtures` exclude.
