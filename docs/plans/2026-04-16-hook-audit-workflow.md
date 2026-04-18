# Hook Audit Workflow

**Purpose:** Systematically review each hook contract for standards compliance and configurability.

**Created:** 2026-04-16
**Status:** DESIGN

---

## Audit Criteria

Each hook is evaluated against these criteria:

### 1. Configurability (C1-C3)

| ID | Criterion | Check |
|----|-----------|-------|
| C1 | Uses `readHookConfig()` for tunable values | No hardcoded thresholds, paths, or feature flags |
| C2 | Config has sensible defaults | Hook works without explicit config |
| C3 | Config schema documented | hookConfig section in doc.md or README |

### 2. Type Safety (T1-T5)

| ID | Criterion | Check |
|----|-----------|-------|
| T1 | No `as any` casts | Use type guards or proper narrowing |
| T2 | No `as Type` casts without validation | Validate shape before casting |
| T3 | Uses `safeJsonParse` not `JSON.parse` | Import from `core/adapters/json` |
| T4 | Input validation via Effect Schema or guards | No raw field access on `tool_input` |
| T5 | Proper `tool_response` handling | Check for string/object before use |

### 3. Error Handling (E1-E4)

| ID | Criterion | Check |
|----|-----------|-------|
| E1 | Returns `Result<T, ResultError>` | No throwing in business logic |
| E2 | No try-catch outside adapters | Use `tryCatch` wrapper only at boundaries |
| E3 | Silent failures log to stderr | Optional `stderr` param for debugging |
| E4 | Fail-open for non-critical paths | Don't block session on config read errors |

### 4. Architecture (A1-A4)

| ID | Criterion | Check |
|----|-----------|-------|
| A1 | No direct `process.env` | Access via `defaultDeps` only |
| A2 | No raw Node imports | Use `core/adapters/*` |
| A3 | Uses `@hooks/*` path aliases | No relative `../` imports |
| A4 | Deps interface is minimal | Only methods actually used |

### 5. Documentation (D1-D3)

| ID | Criterion | Check |
|----|-----------|-------|
| D1 | doc.md exists with required sections | Overview, Event, When It Fires, What It Does, Examples, Dependencies |
| D2 | IDEA.md exists (project-agnostic) | Problem, Solution, How It Works, Signals |
| D3 | README.md for hook groups | Documents shared module and config |

### 6. Testing (X1-X3)

| ID | Criterion | Check |
|----|-----------|-------|
| X1 | Contract tests exist | `*.contract.test.ts` or `*.test.ts` |
| X2 | Hook shell tests exist | `*.hook.test.ts` using `runHookScript` |
| X3 | No silent test passes | No `if (!result.ok) return` patterns |

---

## Audit Process

### Phase 1: Discovery

```bash
# List all hook contracts
find hooks -name "*.contract.ts" | sort
```

### Phase 2: Per-Hook Audit

For each hook:

1. **Read** the contract file
2. **Score** against each criterion (PASS / FAIL / N/A)
3. **Record** findings in tracking doc
4. **Create issue** for any failures (or fix inline if trivial)
5. **Update** tracking doc with issue/PR links

### Phase 3: Remediation

- Fix issues via AIP batch or manual PRs
- Re-audit after fixes
- Mark as AUDITED when all criteria pass

---

## Tracking Document

Create `docs/audits/hook-standards-audit.md`:

```markdown
# Hook Standards Audit

**Started:** 2026-04-16
**Last Updated:** 2026-04-16

## Summary

| Status | Count |
|--------|-------|
| Audited | 0 |
| In Progress | 0 |
| Pending | 70 |

## Audit Log

### [HookGroupName/HookName]

**Status:** PENDING | IN_PROGRESS | AUDITED
**Audited:** YYYY-MM-DD
**Auditor:** (agent or human)

| Category | ID | Status | Notes |
|----------|-----|--------|-------|
| Config | C1 | | |
| Config | C2 | | |
| Config | C3 | | |
| Types | T1 | | |
| Types | T2 | | |
| Types | T3 | | |
| Types | T4 | | |
| Types | T5 | | |
| Errors | E1 | | |
| Errors | E2 | | |
| Errors | E3 | | |
| Errors | E4 | | |
| Arch | A1 | | |
| Arch | A2 | | |
| Arch | A3 | | |
| Arch | A4 | | |
| Docs | D1 | | |
| Docs | D2 | | |
| Docs | D3 | | |
| Tests | X1 | | |
| Tests | X2 | | |
| Tests | X3 | | |

**Issues:** #NNN, #NNN
**PRs:** #NNN

---
```

---

## Automation Opportunities

### Automated Checks (can grep/AST)

- T1: `grep "as any"` in contracts
- T3: `grep "JSON\.parse"` without safeJsonParse import
- A1: `grep "process\.env"` outside defaultDeps
- A2: `grep 'from "node:'` or `'from "fs"'`
- A3: `grep 'from "\.\.'` for relative imports
- X3: `grep "if (!result.ok) return"` in tests

### Manual Checks (require reading)

- C1-C3: Configuration design decisions
- T2, T4, T5: Validation quality
- E1-E4: Error handling patterns
- D1-D3: Documentation completeness

---

## Execution Plan

### Option A: Sequential (1 hook/session)

Good for thoroughness. Each session:
1. Audit 1 hook completely
2. Fix any findings
3. Update tracking doc
4. Commit

### Option B: Batch by Category

Good for consistency. Per batch:
1. Run automated checks across all hooks
2. Create issues for all failures
3. Fix via AIP pipeline
4. Manual audit for remaining criteria

### Option C: Hybrid

1. Run automated checks first (creates baseline)
2. Batch-fix automated findings via AIP
3. Sequential manual audit for remaining criteria

**Recommended: Option C** — Gets quick wins from automation, then thorough manual review.

---

## Next Steps

1. [ ] Create `docs/audits/hook-standards-audit.md` tracking file
2. [ ] Run automated checks to establish baseline
3. [ ] Create GitHub issues for automated findings
4. [ ] Begin sequential manual audits (5 hooks/day target)
5. [ ] Track progress in audit doc
