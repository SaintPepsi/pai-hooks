## Overview

SteeringRuleValidator is a PreToolUse hook that blocks Write/Edit operations to steering rule files when the frontmatter format is invalid. It ensures steering rules use bracket array syntax which the SteeringRuleInjector parser requires.

## Event

**PreToolUse** — fires before Write and Edit tool operations complete.

## When It Fires

- Write or Edit targeting a file matching `/steering-rules/*.md`
- Content contains YAML frontmatter markers (`---`)

## What It Does

1. **Path check** — extracts file path from tool input, skips if not a steering rule file
2. **Content extraction** — gets content from Write or new_string from Edit
3. **Frontmatter validation** — checks for required fields in correct format:
   - `name: rule-name` (required)
   - `events: [Event1, Event2]` (bracket array, not YAML list)
   - `keywords: [word1, word2]` (bracket array, not YAML list)
   - `depends-on: [Tool(Write), Tool(Edit)]` (optional; if present, must be bracket array — item shape is NOT enforced; the parser handles that)
4. **Block or allow** — returns block decision with detailed error if invalid

## Examples

> Claude attempts to write a steering rule using YAML list format for events. The hook blocks with an error explaining the required bracket syntax, preventing a rule that would silently fail to load.

```markdown
# Invalid format (blocked):
---
name: my-rule
events:
  - SessionStart
keywords:
  - example
---

# Valid format (allowed):
---
name: my-rule
events: [SessionStart]
keywords: [example]
depends-on: [Tool(Write), Tool(Edit)]
---
```

## Dependencies

- **SteeringRuleInjector parser** — `hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract.ts:86` defines the parseFrontmatter function that only handles bracket array syntax
- **lib/tool-input** — getFilePath for extracting file path from tool input
- **lib/narrative-reader** — pickNarrative for varied blocking messages
