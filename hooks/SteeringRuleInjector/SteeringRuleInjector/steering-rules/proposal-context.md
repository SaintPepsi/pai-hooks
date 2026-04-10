---
name: proposal-context
events: [UserPromptSubmit]
keywords: [proposal, proposals, add a proposal, create a proposal, write a proposal, new proposal]
---

When working with PAI improvement proposals, follow these rules:

**Location:** `MEMORY/LEARNING/PROPOSALS/pending/` — all new proposals go here.

**File naming:** `{category}_{slug}.md` where category is one of: `hook`, `project`, `rule`, `analysis`, `article`. Example: `hook_my-new-hook.md`, `project_some-initiative.md`.

**Categories:** hook (new/changed hooks), project (multi-session initiatives), rule (steering rules), analysis (investigations/audits), article (writeups/blog posts).

**Required frontmatter:**

```yaml
---
id: PROP-YYYYMMDD-N
category: hook | project | rule | analysis | article
priority: low | medium | high
source_learnings:
  - Where the idea came from
confidence:
  agent_score: 50-100
  human_score: null
  calibration_delta: null
---
```

**Required body sections:** `# Title`, `## Idea` or `## What Was Learned`, `## Proposed Change`, `## Rationale`.

**After creating:** Add a one-line entry to `MEMORY.md` under `## Pending Proposals` following the existing format: `- [Title](path) — one-line description (date)`.

**Statuses:** pending (new), applied (implemented), deferred (parked), rejected (declined). Only `pending/` proposals are active.
