## Overview

WikiContextInjector is a PreToolUse hook that injects relevant wiki page summaries when editing or writing files in wiki-covered domains. It maps file paths to domain tags from wiki entity pages and provides lightweight context (200-500 tokens) to improve domain-aware editing.

## Event

PreToolUse

## When It Fires

- Tool call is **Write** or **Edit**
- The target file path contains a path segment matching a wiki entity's domain tag or title
- At least one matching wiki page has a non-empty `## Summary` section

Does **not** fire for Read, Bash, Glob, Grep, or any other tool calls.

## What It Does

1. On first invocation per session, scans `MEMORY/WIKI/entities/` for markdown files with YAML frontmatter containing `domain` tags
2. Builds and caches a domain index keyed by lowercased domain tags and page titles
3. Extracts the target `file_path` from the tool input
4. Matches path segments against the domain index
5. If matched, extracts `## Summary` sections from up to 2 matching wiki pages
6. Returns `continueOk()` with `additionalContext` containing the summaries, or plain `continueOk()` if no match

## Examples

> A Write to `/Users/hogers/Projects/koord/src/agent.ts` matches the `koord` domain tag. The hook injects: "Wiki context for this file's domain: [Wiki: koord] Multi-agent coordination system via Discord with daemon-driven FSM."

> An Edit to `/Users/hogers/random-project/utils.ts` finds no matching domain. The hook returns plain continue with no additional context.

## Dependencies

- `@hooks/core/adapters/fs` — `readDir`, `readFile` for wiki page I/O
- `@hooks/lib/paths` — `getPaiDir` for resolving the wiki directory path
- Wiki entity pages at `MEMORY/WIKI/entities/*.md` with YAML frontmatter containing `domain` and `title` fields
