# Steering Rule Injection

> Inject behavioral steering rules into AI sessions based on event type and keyword matching.

## Problem

AI coding assistants benefit from behavioral nudges — short directives like "minimize output tokens" or "prefer functional style" — but hard-coding these into system prompts is inflexible. Different rules matter at different times: some should always be active, others only when the conversation touches a relevant topic. There is no mechanism to dynamically select and inject rules based on context.

## Solution

Store steering rules as individual markdown files with YAML frontmatter declaring when they apply (which events, which keywords). At session start, inject all session-scoped rules. On each user prompt, scan for keyword matches and inject only the relevant rules. Rules are discovered via filesystem glob, so adding a new rule is just adding a file — no code changes needed.

## How It Works

1. Each steering rule is a markdown file with YAML frontmatter containing `name`, `events` (which hook events trigger it), and `keywords` (terms that activate it on prompt events).
2. At session start, all rules declaring `SessionStart` in their events are injected as context.
3. On each user prompt, the hook scans for rules declaring `UserPromptSubmit` and checks if any of their keywords appear in the prompt text.
4. Matching rules have their markdown body (everything after the frontmatter) injected as context.
5. Rules that do not match are silently skipped — zero cost when not triggered.

## Signals

- **Input:** Hook event type, user prompt text (for UserPromptSubmit), steering rule files on disk
- **Output:** Context injection containing the body of all matching steering rules, or silent if no rules match
