# paih CLI — Master Execution Strategy

**Date:** 2026-03-25
**Status:** Planned
**Parent issue:** [#3](https://github.com/SaintPepsi/pai-hooks/issues/3)
**Design doc:** [2026-03-25-paih-cli-design.md](2026-03-25-paih-cli-design.md)

## Overview

Seven sub-issues (#4-#10) decompose the paih CLI into independently implementable work streams. This document is the master execution plan covering team composition, phasing, dependencies, and parallel execution opportunities for each issue.

## Dependency Graph

```
#4 Schema ──────────→ #5 Generate ─┐
    │                               │
    └──→ #6 CLI Core ──────────────→ #7 Install MVP
                                         │
                                    ┌────┼────┐
                                    ▼    ▼    ▼
                                  #8   #9   #10
                                 List  Comp  Life
                                (parallel after #7)
```

## Execution Waves

| Wave | Issues | Parallelism | Prerequisite |
|------|--------|-------------|-------------|
| **Wave 1** | #4 | Serial | None (issue #2 already complete) |
| **Wave 2** | #5 + #6 | Parallel (both depend only on #4) | #4 merged |
| **Wave 3** | #7 | Serial | #5 + #6 merged |
| **Wave 4** | #8 + #9 + #10 | All three parallel | #7 merged |

## Agent Summary

| Issue | Team Size | Model | Total Agents |
|-------|-----------|-------|-------------|
| #4 Schema | 3 | Opus | 3 |
| #5 Generate | 2 | Opus | 2 |
| #6 CLI Core | 3 | Opus | 3 |
| #7 Install MVP | 4 | Opus | 4 |
| #8 List/Catalog | 2 | Opus | 2 |
| #9 Compiled | 3 | Opus | 3 |
| #10 Lifecycle | 4 | Opus | 4 |
| **Total** | | | **21** |

## Per-Issue Strategy Documents

Each issue has a detailed execution strategy:

1. [Issue #4 — Manifest Schema](2026-03-25-paih-exec-04-manifest-schema.md)
2. [Issue #5 — Generate Manifests](2026-03-25-paih-exec-05-generate-manifests.md)
3. [Issue #6 — CLI Core + Resolver](2026-03-25-paih-exec-06-cli-core-resolver.md)
4. [Issue #7 — Install MVP](2026-03-25-paih-exec-07-install-mvp.md)
5. [Issue #8 — List + Catalog](2026-03-25-paih-exec-08-list-catalog.md)
6. [Issue #9 — Compiled Output](2026-03-25-paih-exec-09-compiled-output.md)
7. [Issue #10 — Lifecycle Commands](2026-03-25-paih-exec-10-lifecycle.md)

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Schema change in #4 cascades to all issues | High | Schema validated against 5 real hooks before any downstream work |
| Settings merge logic has subtle bugs | High | Dedicated settings-engineer agent + QA agent in #7 |
| stdin incompatible with Node in compiled mode | High | Dedicated stdin adapter swap designed in #9 Phase 1 |
| Lockfile positional index is fragile | Medium | Replaced with command-string identity in brainstorm consensus |
| Destructive operations cause data loss | High | --dry-run and modification detection on all destructive commands (#10) |
| Agent context limits on large issues | Medium | Phase boundaries allow context compaction between phases |
