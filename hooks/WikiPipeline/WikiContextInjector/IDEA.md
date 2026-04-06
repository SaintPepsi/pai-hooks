# WikiContextInjector

## Problem

When an AI assistant edits files in a project, it lacks domain-specific knowledge that exists in a separate wiki. Without this context, it may make decisions that contradict established patterns, architecture choices, or project history documented elsewhere.

## Solution

A pre-write hook that intercepts file edit/write operations, maps the target file's path to a knowledge domain, and injects relevant wiki page summaries into the assistant's context before the write proceeds. The injection is lightweight (200-500 tokens) and only fires when a matching wiki page exists.

## How It Works

1. On first invocation, scan the wiki entities directory and parse YAML frontmatter for `domain` tags and `title` fields
2. Build a domain index keyed by lowercased domain tags and titles, cached for the session
3. When a Write or Edit tool call arrives, extract the target file path
4. Match path segments against the domain index (e.g., `/Projects/koord/src/...` matches domain `koord`)
5. If matched, extract the `## Summary` section from up to 2 matching wiki pages
6. Inject the summaries as additional context alongside the tool call

## Signals

- **Input:** Tool call event with tool name (Write/Edit) and file path
- **Output:** Continue with optional additional context string containing wiki summaries
- **No-op:** Tool calls to non-matching domains, non-Write/Edit tools, or empty wiki
