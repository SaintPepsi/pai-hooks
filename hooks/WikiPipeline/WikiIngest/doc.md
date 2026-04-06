## Overview

WikiIngest is a SessionEnd hook that automatically processes session transcripts through a three-stage knowledge pipeline: Filter, Extract, and Seed. It converts raw session conversations into structured wiki pages containing entities, decisions, and concepts discovered during the session.

## Event

**SessionEnd** — fires after every Claude Code session ends, giving the hook access to the full session transcript.

## When It Fires

- Fires on every session end (accepts all inputs)
- Gates prevent unnecessary processing:
  - Sessions smaller than 5KB are skipped (too little content)
  - Sessions that only touched wiki files (MEMORY/WIKI/) are skipped to prevent circular self-reference
  - Sessions that have already been extracted are skipped (dedup by session ID)

## What It Does

1. **Locate transcript** — finds the session JSONL file via `input.transcript_path` or by searching the projects directory
2. **Size gate** — checks file size; skips sessions under 5KB as they lack substance
3. **Wiki-only guard** — quick-scans for file paths in the transcript; skips if all paths are under MEMORY/WIKI/
4. **Dedup check** — looks for an existing extraction JSON in `.pipeline/extractions/haiku/`
5. **Filter** — runs `filter.ts` via shell to classify the session and produce a compressed digest
6. **Extract** — runs `extract.ts` via shell, which calls Claude Haiku to extract entities, decisions, and concepts from the digest
7. **Seed** — if the extraction contains new entities or concepts, runs `seed.ts` to create wiki pages from templates
8. **Audit trail** — appends a JSONL entry to `.pipeline/audit.jsonl` with session ID, classification, cost, and pages created
9. **Operation log** — appends a human-readable entry to `MEMORY/WIKI/log.md` with format `## [YYYY-MM-DD] ingest | session {short-id} — {details}`
10. **Milestone counter** — logs a message every 50 extractions

## Examples

> A developer works on a new feature involving TypeScript hooks and discusses architectural decisions. At session end, WikiIngest filters the transcript down to key messages, extracts "TypeScript" as a technology entity and "Hook Contract Pattern" as a concept, then creates wiki pages for each.

> A short greeting session (2KB) ends. WikiIngest sees the file is below the 5KB threshold and immediately returns silent with no processing.

> A session that only edited wiki entity pages ends. WikiIngest detects all file paths contain MEMORY/WIKI/ and skips to prevent circular ingestion.

```
Pipeline flow:
  Session JSONL (50KB) -> Filter -> Digest (2KB) -> Extract -> Extraction JSON -> Seed -> Wiki Pages
  
Audit entry (audit.jsonl):
  {"session_id":"abc123","timestamp":"2026-04-06T15:00:00","classification":"standard","extractionCost":0.001,"pagesCreated":2}

Log entry (log.md):
  ## [2026-04-06] ingest | session abc12345 — standard, 2 pages, $0.0010
```

## Dependencies

- **Pipeline tools**: `~/.claude/MEMORY/WIKI/.pipeline/tools/filter.ts`, `extract.ts`, `seed.ts` — called via `bun` shell exec
- **Claude Haiku**: extraction step uses Claude CLI which calls Haiku for structured knowledge extraction
- **Wiki templates**: `~/.claude/MEMORY/WIKI/.pipeline/templates/` — entity and concept page templates used by seed
- **Core adapters**: `@hooks/core/adapters/fs` for file operations, `@hooks/core/adapters/process` for shell exec
