# SteeringRuleInjector

## Overview

SteeringRuleInjector is a **SessionStart** and **UserPromptSubmit** hook that injects contextual steering rules into the session based on event type and keyword matching. It discovers rule files from a `steering-rules/` directory, parses their YAML frontmatter for event and keyword metadata, and injects matching rules as context.

On SessionStart, rules matching that event are always injected. On UserPromptSubmit, rules are injected only if the user's prompt contains one of the rule's declared keywords.

## Event

`SessionStart` and `UserPromptSubmit` — fires at session initialization to inject baseline rules, and on each user prompt to inject keyword-triggered rules.

## When It Fires

- Every session start for rules that declare `SessionStart` in their events
- Every user prompt submission, matching rules whose keywords appear in the prompt text

It does **not** fire when:

- No rule files exist in the `steering-rules/` directory
- No rules match the current event type
- On UserPromptSubmit, no keywords from any rule match the prompt

## What It Does

1. Discovers all `.md` files in the `steering-rules/` directory
2. Parses YAML frontmatter from each file to extract `name`, `events`, and `keywords`
3. Filters rules by the current event type
4. For UserPromptSubmit events, further filters by keyword presence in the prompt
5. Injects matching rule content as context output

## Examples

### Example 1: Session start injects baseline rules

> A session starts. SteeringRuleInjector scans `steering-rules/` and finds rules with `SessionStart` in their events list. Those rules are injected as context, giving the agent behavioral guidance from the start.

### Example 2: Keyword-triggered rule on prompt

> The user submits a prompt containing the word "concise". SteeringRuleInjector matches the `minimize-output-tokens` rule (which declares `concise` as a keyword) and injects its content: "Minimize Output Tokens. Output tokens cost 5x input tokens..."

### Example 3: No matching keywords

> The user submits a prompt about database migrations. No steering rules declare matching keywords. SteeringRuleInjector returns silent — no rules are injected.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `fs` | adapter | Reads steering rule files from the `steering-rules/` directory |
| `result` | core | Provides `ok` and `Result` type for error handling |
| `path` | node | Resolves file paths for rule discovery |
