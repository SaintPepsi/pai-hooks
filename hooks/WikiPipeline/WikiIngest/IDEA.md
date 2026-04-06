## Problem

AI assistants generate valuable knowledge during work sessions: architectural decisions, entity relationships, design patterns, trade-off analyses. This knowledge lives only in raw session transcripts and is never surfaced again. Each session is an isolated conversation that contributes nothing to a persistent knowledge base.

## Solution

An automatic post-session hook that runs a three-stage knowledge pipeline (Filter, Extract, Seed) to convert session transcripts into structured wiki pages. The hook fires at session end, processes the transcript through classification and LLM-based extraction, and creates wiki entries for discovered entities and concepts.

## How It Works

1. **Gate checks** prevent unnecessary processing: skip sessions that are too small (under 5KB), skip sessions that only touched wiki files (prevents circular self-reference), skip sessions already processed (dedup by session ID)
2. **Filter stage** classifies the session by size tier (quick-scan, standard, deep), scores messages by wiki-relevance using decision-language patterns, and produces a compressed digest keeping only high-value content
3. **Extract stage** sends the digest to a fast LLM (Haiku) with a structured extraction prompt, producing typed entities (projects, technologies, people, concepts), decisions with rationale, and concept definitions
4. **Seed stage** reads the extraction output and creates wiki pages from templates for any entities or concepts that do not already have pages, then updates the wiki index
5. **Audit trail** records every run with session ID, classification tier, extraction cost, and pages created for pipeline observability

## Signals

**Input:**
- Session ID and transcript path from the SessionEnd hook event
- Raw session JSONL file (varies from 1KB to 500KB+)

**Output:**
- Silent hook output (no visible effect on session end)
- Digest file in `.pipeline/digests/` (compressed session summary)
- Extraction JSON in `.pipeline/extractions/haiku/` (structured entities, decisions, concepts)
- Wiki pages in `entities/` and `concepts/` directories (created from templates)
- Audit JSONL line in `.pipeline/audit.jsonl` (run metadata)
