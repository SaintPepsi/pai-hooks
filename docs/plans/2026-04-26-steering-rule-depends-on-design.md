# Steering Rule `depends-on` Field — Design

**Date:** 2026-04-26
**Status:** Design — awaiting approval before implementation
**Owner:** Ian / Maple

## Problem

`SteeringRuleInjector` fires Stop-event rules based on naive substring matching against the previous assistant message. Conversational filler — "optional", "want me to", "good to go", "defer" — triggers implementation-context rules during brainstorming, scoping, and clarifying turns where no code work is happening.

Demonstrated live in this session: while brainstorming the fix for this very bug, the Stop hook injected both `fix-all-discovered-bugs-not-just-some` and `always-proper-fix`. Neither was relevant — no bugs had been discovered, no quick-fix-vs-proper-fix was being offered. The injector has no notion of *whether the agent did real work this turn*.

False positives don't just clutter — they train the agent to ignore steering output, eroding the value of legitimate firings.

## Solution

Add an optional `depends-on` field to steering rule frontmatter:

```yaml
---
name: fix-all-discovered-bugs-not-just-some
events: [Stop]
keywords: [lower priority, want me to, good to go, defer, optional, ...]
depends-on: [Tool(Write), Tool(Edit), Tool(NotebookEdit), Tool(Bash)]
---
```

- Optional. Absent `depends-on` preserves current behavior (always eligible).
- Bracket array, matches `events`/`keywords` convention.
- Items look like `Tool(Name)` where `Name` matches Claude Code's transcript tool names verbatim (`Write`, `Edit`, `NotebookEdit`, `Bash`, etc.).
- OR semantics: rule fires if ANY listed tool was used this turn.
- Frontmatter key is `depends-on` (kebab); TypeScript field is `dependsOn` (camel). The parser does the conversion.

## How It Works

### Helper

```typescript
transcriptHasToolCall(transcriptPath: string | undefined, toolNames: string[]): boolean
```

- Returns `false` if `transcriptPath` is undefined.
- Walks the JSONL backwards from EOF.
- Returns `true` on first encounter of an assistant `tool_use` block whose `name` is in `toolNames`.
- Stops at the most recent real user message; returns `false` if reached without a hit.

Added as a dep on `SteeringRuleInjectorDeps`. defaultDeps wires it to the JSONL scanner. Tests stub with a plain function.

### Boundary rule

A "real user message" is `entry.type === "user"` AND content is a string OR first content block is `type === "text"`. Synthetic `tool_result` user entries are skipped.

Empirical from a live transcript: 26 of 35 user lines were synthetic `tool_result` entries; only 9 were actual user prompts. The boundary scan must filter.

### Gate

In `SteeringRuleInjector.contract.ts execute()`, after the existing event/keyword filters and before pushing to `bodiesToInject`:

```typescript
if (
  eventType === "Stop" &&
  rule.dependsOn &&
  !deps.transcriptHasToolCall(getTranscriptPath(input, deps.stderr), rule.dependsOn)
) continue;
```

The `eventType === "Stop"` check is semantic, not defensive: tool-usage ("did the agent use tool X this turn") is only defined for Stop events. On `PreToolUse` a tool is about to happen; on `PostToolUse` one just happened; on `SessionStart`/`SubagentStart` there is no turn yet. For non-Stop events `depends-on` is silently ignored — a rule like `always-proper-fix` that fires on both `Stop` and `PreToolUse` keeps its `PreToolUse` arm regardless of `depends-on`.

`rule.dependsOn` is `string[]` — tool names extracted from `Tool(X)` items by the parser. The parser ignores `depends-on` items that don't match the `Tool(X)` shape.

### Validator

`SteeringRuleValidator.contract.ts validateSteeringRule()` adds:
- `depends-on` is optional. If absent, no error.
- If present, must be bracket array form: `depends-on: [...]`. YAML list form blocks with the same helpful message pattern as `events`/`keywords`.

The validator does NOT enforce item shape — that mirrors the parser's "ignore unknown" stance and avoids future drift when new dependency types are added.

## Default for the rule that started this

`fix-all-discovered-bugs-not-just-some.md` and `always-proper-fix.md` get:

```yaml
depends-on: [Tool(Write), Tool(Edit), Tool(NotebookEdit), Tool(Bash)]
```

Fires only on turns where the agent actually wrote/edited files or ran shell commands. Brainstorming, scoping, code-reading, and research turns no longer trigger them.

## Rules to audit in follow-up sweep

Implementation-context candidates needing the same gate:

- `fix-at-the-source`
- `check-for-regressions-after-fixes`
- `coding-standards-are-not-optional-changes`
- `commit-and-push-when-finished-never-merge-without-approval`
- `dogfood-every-task`
- `every-project-must-have-a-type-checking-gate`
- `demonstrate-features-end-to-end-before-claiming-done`
- `error-recovery-protocol`

Should remain ungated (fire conversationally):

- `always-include-clickable-links-when-referencing-external-resources`
- `ground-claims-in-source-material`
- `give-equal-analytical-depth-to-all-presented-options`
- `admit-uncertainty-rather-than-fabricate`
- `dont-modify-user-content-without-asking`

Full audit deferred to a separate PR.

## Testing

- `SteeringRuleInjector.contract.test.ts`:
  - parser extracts `depends-on`, handles missing/empty/malformed-item
  - gate skips rule when helper returns false
  - gate allows rule when helper returns true
  - gate is no-op when `dependsOn` is absent
- `SteeringRuleValidator.test.ts`:
  - valid `depends-on` bracket arrays pass
  - YAML list form blocks with helpful message
  - missing `depends-on` still passes
- New helper tests:
  - returns false on undefined path
  - returns false when no listed tool appears before boundary
  - returns true when a listed tool appears before boundary
  - synthetic `tool_result` user entries don't terminate the scan

## Migration

1. Parser + validator — add `depends-on` support. No behavior change yet.
2. Gate logic — add `transcriptHasToolCall` dep + the one-line gate.
3. Add `depends-on` to `fix-all-discovered-bugs-not-just-some` and `always-proper-fix`.
4. Separate PR: audit sweep for the other 8 implementation-context rules.

After step 3, the live false-positive that started this design is gone — verifiable by running another brainstorming session.
