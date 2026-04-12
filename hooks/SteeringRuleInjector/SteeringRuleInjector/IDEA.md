# Steering Rule Injection

> Inject behavioral steering rules into AI sessions based on event type and keyword matching.

## Problem

AI coding assistants benefit from behavioral nudges — short directives like "minimize output tokens" or "prefer functional style" — but hard-coding these into system prompts is inflexible. Different rules matter at different times: some should always be active, others only when the conversation touches a relevant topic. There is no mechanism to dynamically select and inject rules based on context.

## Solution

Store steering rules as individual markdown files with YAML frontmatter declaring when they apply (which events, which keywords). At session start, inject all session-scoped rules. On each user prompt, scan for keyword matches and inject only the relevant rules. Rules are discovered via filesystem glob, so adding a new rule is just adding a file — no code changes needed.

## How It Works

1. Each steering rule is a markdown file with YAML frontmatter containing `name`, `events` (which hook events trigger it), and `keywords` (terms that activate it on keyword-matched events).
2. On `SessionStart`, all rules declaring `SessionStart` with empty keywords inject automatically — always-on session-level rules.
3. On `UserPromptSubmit`, rules declaring that event are checked against the prompt text; rules whose keywords appear in the text inject as context.
4. On `PreToolUse` and `PostToolUse`, rules are matched against the tool name, file path, and skill; matching rules inject as `additionalContext` before or after the tool runs.
5. On `SubagentStart`, rules with `SubagentStart` and empty keywords inject automatically, surfacing role and permission rules at the start of every subagent session.
6. On `Stop`, rules are matched against the last assistant message; a match blocks the response with the rule body as the reason, forcing a retry.
7. Rules already injected this session are skipped — each rule injects at most once per session via a per-session tracker file.

## Signals

- **Input:** Hook event type; prompt text (UserPromptSubmit), tool name, file path, and skill (PreToolUse/PostToolUse), last assistant message (Stop); steering rule files on disk
- **Output:** Context injection with the body of all matching rules for context events (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, SubagentStart); block decision with rule body as reason for Stop events; silent if no rules match
