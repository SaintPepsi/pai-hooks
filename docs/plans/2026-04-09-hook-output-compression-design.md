# Hook Output Compression Design

> **Revised 2026-04-09:** After adversarial review, the fire count tracker and diminishing detail
> were dropped (complexity not justified by marginal savings). Every fire now gets the same
> compressed format with behavioral prefix. Verbose detail preserved in stderr for developer logs.
> See implementation plan for the authoritative spec: `2026-04-09-hook-output-compression-plan.md`

## Problem

Hook feedback injected into Claude's context is excessively verbose. A single HookDocEnforcer
block costs ~400 tokens. Across all enforcement hooks, a typical session burns 5000-8000 tokens
on hook output alone. Most of this is redundant — full absolute paths, per-item detail listings,
inline guidance Claude already knows, and narrative openers.

## Approach: A+C Hybrid

Combine **compression helpers** (Approach A) with **diminishing detail** (Approach C):

- Shared pure functions for path compression, directory summarization, line number formatting
- Per-session fire count tracking for repeated-fire hooks (PreToolUse/PostToolUse)
- First-person behavioral prefixes to replace `pickNarrative()` while preserving Claude compliance

## New Module: `lib/output-compress.ts`

Pure functions, no I/O:

```typescript
compressPath(absPath: string): string
// "/Users/.../src/lib/api/upload.ts" -> "api/upload.ts"

summarizeByDir(files: string[]): string
// ["api/foo.ts", "api/bar.ts", "components/X.svelte"] -> "api/ (2), components/ (1)"

compactLines(lines: number[], max?: number): string
// [5, 12, 18, 23, 45] with max=3 -> "L5,L12,L18 +2 more"

hookLine(name: string, msg: string): string
// "[TypeStrictness] 3 violations..."
```

## Diminishing Detail Tracker

For hooks that fire multiple times per session:

```typescript
getAndIncrementFireCount(stateDir: string, hookName: string, sessionId: string): number
// Returns count BEFORE incrementing (0 on first fire)
```

State file: `MEMORY/STATE/output-compress/fires-{hookName}-{sessionId}.txt`

| Fire # | Detail Level | Example |
|--------|-------------|---------|
| 1st | Category + line numbers | `[TypeStrictness] I need to fix these any types. 3 in upload.ts (L5,L12,L18). Read types before replacing.` |
| 2nd+ | Count + file only | `[TypeStrictness] +2 any in Field.svelte (L3,L9)` |

Hooks that get fire tracking: CodingStandardsEnforcer, TypeStrictness, TypeCheckVerifier,
ArchitectureEscalation, BashWriteGuard.

Hooks that don't need it: HookDocEnforcer, DocObligationEnforcer, TestObligationEnforcer (fire at
Stop, rarely more than 1-2 times), SettingsGuard (rare, user-facing confirmation).

## First-Person Behavioral Prefixes

Replace `pickNarrative()` (~30 tokens of personality) with short first-person directives (~8
tokens) that trick Claude into treating the block as its own commitment:

| Hook | Prefix |
|------|--------|
| HookDocEnforcer | `I need to update docs before finishing.` |
| DocObligationEnforcer | `I need to update docs before finishing.` |
| TestObligationEnforcer | `I need to write and run tests before finishing.` |
| CodingStandardsEnforcer | `I need to fix these violations.` |
| TypeStrictness | `I need to fix these any types.` |
| TypeCheckVerifier | `I have type errors to fix.` |
| ArchitectureEscalation | `I need to rethink my approach.` |
| BashWriteGuard | `I need to use Edit/Write instead.` |

## Per-Hook Before/After

### Obligation Enforcers (HookDocEnforcer, DocObligationEnforcer, TestObligationEnforcer)

Remove: `pickNarrative()`, full file paths, `buildDocSuggestions()` with per-dir suggestions and
required section listings, `buildBlockLimitReview()` verbose markdown.

Before (~400 tokens):
```
I can't wrap up with this many doc-unchecked changes...

Modified files without documentation updates:
  - /Users/ian/repos/project/src/lib/components/FileUpload/useFileUpload.svelte.ts
  - /Users/ian/repos/project/src/lib/components/FileUpload/types.ts
  ...

Create or update documentation in `.../FileUpload/`
Create or update documentation in `.../Field/`

Required sections in `doc.md`:
  - ## Overview
  ...
```

After (~45 tokens):
```
[HookDocEnforcer] I need to update docs before finishing. FileUpload/ (2), Field/ (1), api/ (2)
```

TestObligationEnforcer keeps two categories:
```
[TestObligationEnforcer] I need to write and run tests before finishing. Write: upload.ts, FileUpload.svelte. Run: Field.svelte
```

### CodingStandardsEnforcer

Remove: per-violation content lines, guidance section, full paths.

Before (~700 tokens): narrative + per-line violations + guidance block.

After 1st fire (~55 tokens):
```
[CodingStandardsEnforcer] I need to fix these violations. 5 in upload.ts: raw-import (L3,L7), process-env (L12), try-catch (L15,L20)
```

After 2nd+ fire (~25 tokens):
```
[CodingStandardsEnforcer] +3 violations in Field.svelte: raw-import (L5,L8,L11)
```

### TypeStrictness

Remove: violation content lines, 8-line guidance block, "Common correct fixes" section.

After 1st fire (~40 tokens):
```
[TypeStrictness] I need to fix these any types. 3 in upload.ts (L5,L12,L18). Read types before replacing.
```

After 2nd+ fire (~20 tokens):
```
[TypeStrictness] +2 any in Field.svelte (L3,L9)
```

### TypeCheckVerifier

Remove: per-error message lines, 6-line guidance footer.

After 1st fire (~25 tokens):
```
[TypeCheckVerifier] I have type errors to fix. 3 in upload.ts (L5,L12,L18)
```

After 2nd+ fire (~20 tokens):
```
[TypeCheckVerifier] +2 type errors in Field.svelte (L3,L9)
```

### ArchitectureEscalation

Remove: 10-line narrative with numbered action items.

WARN (~20 tokens):
```
[ArchEscalation] I need to rethink my approach. criterion-123: 3 failures — consider different approach
```

STOP (~25 tokens):
```
[ArchEscalation] I need to rethink my approach. criterion-123: 5 failures — stop retrying, rethink
```

### SettingsGuard

Remove: 4-line AI instruction block.

After (~15 tokens):
```
[SettingsGuard] Confirm: Edit -> settings.json
```

### BashWriteGuard

Remove: command excerpt (200 chars), common ops listing.

After (~15 tokens):
```
[BashWriteGuard] I need to use Edit/Write instead. For .ts file writes
```

## What Gets Removed

1. **Narrative openers** (`pickNarrative()`) — replaced with first-person behavioral prefixes
2. **Inline guidance blocks** — Claude knows these from CLAUDE.md and skills
3. **Full absolute paths** — Claude has session context, compressed to last 2 segments
4. **Per-item detail listings** — replaced with category + line number summaries
5. **Required section listings** — static config Claude can look up if needed

## Token Savings

| Hook | Before (tokens) | After (tokens) | Reduction |
|------|-----------------|----------------|-----------|
| Obligation enforcers (x3) | 300-500 | 35-45 | ~90% |
| CodingStandardsEnforcer | 500-1000 | 25-55 | ~93% |
| TypeStrictness | 300-500 | 20-40 | ~92% |
| TypeCheckVerifier | 100-300 | 20-25 | ~87% |
| ArchitectureEscalation | 200-250 | 20-25 | ~90% |
| SettingsGuard | 200-300 | 15 | ~94% |
| BashWriteGuard | 150-250 | 15 | ~92% |

Session total worst case: ~5000-8000 -> ~400-600 tokens. **~92% reduction.**

## Files Changed

New:
- `lib/output-compress.ts` — shared compression helpers + fire count tracker
- `lib/output-compress.test.ts` — tests for helpers

Modified:
- `hooks/ObligationStateMachines/HookDocEnforcer/HookDocEnforcer.contract.ts`
- `hooks/ObligationStateMachines/HookDocStateMachine.shared.ts` (simplify `buildDocSuggestions`)
- `hooks/ObligationStateMachines/DocObligationEnforcer/DocObligationEnforcer.contract.ts`
- `hooks/ObligationStateMachines/DocObligationStateMachine.shared.ts`
- `hooks/ObligationStateMachines/TestObligationEnforcer/TestObligationEnforcer.contract.ts`
- `hooks/ObligationStateMachines/TestObligationStateMachine.shared.ts`
- `hooks/CodingStandards/CodingStandardsEnforcer/CodingStandardsEnforcer.contract.ts`
- `hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts`
- `hooks/CodingStandards/TypeCheckVerifier/TypeCheckVerifier.contract.ts`
- `hooks/CodingStandards/BashWriteGuard/BashWriteGuard.contract.ts`
- `hooks/ArchitectureEscalation/ArchitectureEscalation/ArchitectureEscalation.contract.ts`
- `hooks/SecurityValidator/SettingsGuard/SettingsGuard.contract.ts`
- `lib/obligation-machine.ts` (compress `buildBlockLimitReview`)
