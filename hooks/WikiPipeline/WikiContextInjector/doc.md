## Overview

WikiContextInjector is a PreToolUse hook that injects relevant wiki page summaries when editing or writing files in wiki-covered domains. It maps file paths to domain tags from wiki entity pages and slugified titles from concept pages, providing lightweight context (200-500 tokens) to improve domain-aware editing. Includes per-file dedup to prevent duplicate injection and metrics tracking for injection events.

## Event

PreToolUse

## When It Fires

- Tool call is **Write** or **Edit**
- The target file path contains a path segment matching a wiki page's domain tag or title
- At least one matching wiki page has a non-empty `## Summary` or `## Definition` section
- The same file path has not already been injected this session (dedup)

Does **not** fire for Read, Bash, Glob, Grep, or any other tool calls.

## What It Does

1. On first invocation per session, scans both `MEMORY/WIKI/entities/` and `MEMORY/WIKI/concepts/` for markdown files with YAML frontmatter
2. Entity pages are indexed by their `domain` tags; concept pages (which lack domain fields) are indexed by their slugified title (e.g., "Design-first methodology" becomes "design-first-methodology")
3. Builds and caches a domain index keyed by lowercased domain tags and page titles
4. Extracts the target `file_path` from the tool input
5. Checks dedup set — skips if this file path was already injected this session
6. Matches path segments against the domain index
7. If matched, extracts `## Summary` (entity pages) or `## Definition` (concept pages) sections from up to 2 matching wiki pages
8. Records an injection metric to `MEMORY/WIKI/.pipeline/metrics.jsonl` with type, session ID, file path, matched pages, and timestamp
9. Returns `{ continue: true, hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } }` with the summaries, or plain `{ continue: true }` if no match

## Examples

> A Write to `/Users/hogers/Projects/koord/src/agent.ts` matches the `koord` domain tag. The hook injects: "Wiki context for this file's domain: [Wiki: koord] Multi-agent coordination system via Discord with daemon-driven FSM."

> An Edit to `/Users/hogers/Projects/design-first-methodology/notes.md` matches the concept page title. The hook injects the `## Definition` content from the concept page.

> A second Edit to the same file in the same session is skipped (dedup). No additional context injected, no metric recorded.

> An Edit to `/Users/hogers/random-project/utils.ts` finds no matching domain. The hook returns plain continue with no additional context.

## Dependencies

- `@hooks/core/adapters/fs` — `readDir`, `readFile` for wiki page I/O; `appendFile` for metrics
- `@hooks/lib/paths` — `getPaiDir` for resolving the wiki directory path
- Wiki entity pages at `MEMORY/WIKI/entities/*.md` with YAML frontmatter containing `domain` and `title` fields
- Wiki concept pages at `MEMORY/WIKI/concepts/*.md` with YAML frontmatter containing `title` field and `## Definition` sections
- Shared metrics file at `MEMORY/WIKI/.pipeline/metrics.jsonl` (also used by WikiReadTracker)

## History

> **2026-04-11 — SDK Type Foundation (1X):** The context injection at `WikiContextInjector.contract.ts:288` was using `continueOk(contextText)` which routed `additionalContext` at the top level of the hook output. Claude Code's SDK silently dropped this field on PreToolUse events. Wiki context was being built correctly (metrics even recorded the injection) but never reached the model. 7th instance of the same bug class found in this refactor, after 1A PreCompactStatePersist, 1C CodingStandardsAdvisor/TypeCheckVerifier/TypeStrictness, 1E-1 CitationEnforcement, and 1B SettingsRevert. The fix routes context through `hookSpecificOutput.additionalContext` with `hookEventName: "PreToolUse"`, matching the SDK contract. Behaviour change: the model now actually receives wiki summaries for files in covered domains.
