# WikiReadTracker

## Problem

A knowledge wiki is only valuable if it gets read. Without tracking which pages are accessed, there is no way to measure wiki adoption, identify high-value pages, or detect stale content that nobody references. Read frequency data is the foundation for wiki health metrics.

## Solution

A lightweight post-read hook that appends a structured metric record every time a wiki page is read. The tracker fires only on wiki paths, uses a fast string check for filtering, and writes newline-delimited JSON for easy downstream processing. It never blocks the read operation — errors are logged silently.

## How It Works

1. After every Read tool call completes, the hook checks whether the file path contains the wiki directory marker
2. If the path matches, it builds a metric record with the session ID, full file path, and ISO 8601 timestamp
3. The record is appended as a single JSON line to a metrics file in the wiki pipeline directory
4. The hook returns immediately with no additional context — it is purely observational

## Signals

- **Input:** PostToolUse event with tool name (Read) and file path
- **Output:** Continue (always) — no context injection, no blocking
- **Side effect:** One JSON line appended to `.pipeline/metrics.jsonl` per wiki read
- **No-op:** Non-Read tools, Read calls to paths outside the wiki directory
