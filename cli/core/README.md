# cli/core/

Core logic for the `paih` CLI. Business logic modules that power CLI commands.

## Files

### `validator.ts`

Bidirectional manifest validator. Compares declared deps in `hook.json` against actual imports parsed from the contract file.

**Signature:**
```typescript
validate(contractPath: string, manifestPath: string, deps?: ValidatorDeps): Result<ValidationReport, PaiError>
```

**Diagnostic codes:**

| Code | Meaning | Direction |
|------|---------|-----------|
| `MANIFEST_MISSING_DEP` | Contract runtime-imports a module not declared in manifest | actual → declared |
| `MANIFEST_GHOST_DEP` | Manifest declares a module not imported by contract (not even type-only) | declared → actual |
| `MANIFEST_SHARED_MISSING` | Manifest lists a shared file that doesn't exist on disk | declared → filesystem |

**Import parsing:**

- Regex-based (no AST). Handles single-line and multi-line `import` statements.
- Two-set parsing: `runtime` (value imports) and `all` (including `import type`).
- `runtime` set drives MISSING_DEP detection. `all` set drives GHOST_DEP detection.
- This means: type-only imports don't trigger missing-dep, but do prevent false ghost-dep.
- Only `@hooks/core/*`, `@hooks/lib/*`, and `@hooks/core/adapters/*` are tracked. Sibling hook imports (`@hooks/hooks/*`) are ignored.

**Shared file resolution:** Shared files are resolved relative to the **group** directory (parent of the hook directory where `hook.json` lives).

**DI pattern:** `ValidatorDeps` interface with `readFile`, `fileExists`, `stderr`. Fully testable via mock deps.

### `validator.test.ts`

Unit tests with synthetic fixtures from `test-fixtures/manifests/`. 9 tests covering valid, missing dep, ghost dep, type-only, shared missing, sibling ignored, multi-line, and error cases.

### `validator.integration.test.ts`

Integration tests running the validator against 5 real hook contracts and their hand-written `hook.json` manifests.
