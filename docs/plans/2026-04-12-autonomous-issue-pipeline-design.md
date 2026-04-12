# Autonomous Issue Pipeline (AIP) — Design Document

**Date:** 2026-04-12
**Status:** Approved
**Scope:** Reusable system for autonomous batch processing of GitHub issues with adversarial review and anti-rationalization

## Problem

Processing GitHub issues requires significant orchestration:
- Scoping requires reading code and understanding context
- Implementation requires isolation to avoid conflicts
- Review requires independence to catch real issues
- Agents tend to rationalize away review findings ("I think it's ok")

The existing issues-processing-team demonstrated throughput (23 issues in 50min) but had 0% QA denial rate, suggesting insufficient adversarial pressure.

## Principle

**Fresh agents cannot rationalize.** When a reviewer finds an issue, the implementing agent is never contacted again. A completely fresh "Fixer" agent receives only the facts of what's broken, not the reasoning. It cannot argue against reasoning it never sees.

## Architecture Overview

| Component | Type | Purpose |
|-----------|------|---------|
| **Maple** | Orchestrator (primary session) | Spawns agents, routes work, merges PRs, updates PRD |
| **Scoper** | Subagent | Reads issue + code, produces scoping artifact |
| **Implementer** | Subagent (worktree) | Implements based on scoping, commits, pushes |
| **Reviewer** | Subagent | Reviews implementation against issue requirements |
| **RedTeam** | Subagent | Actively tries to break/exploit the implementation |
| **Fixer** | Subagent (fresh) | Fixes findings without access to original implementation reasoning |
| **PRD** | File | `docs/plans/YYYY-MM-DD-aip-batch-{name}.md` — full state + audit trail |

**Key invariants:**
1. Implementer and Fixer are NEVER the same agent instance
2. Fixer never sees Reviewer/RedTeam reasoning — only the finding facts
3. PRD is updated after every phase transition
4. Worktrees isolate parallel implementations
5. Maple merges worktrees sequentially after approval

## Agent Roles and Prompts

### Scoper

**Purpose:** Read the issue and relevant code, produce a scoping artifact.

**Prompt template:**
```
SCOPE REQUEST — Issue #{number}

Issue: {url}
Title: {title}
Body:
{issue body}

Read every file you reference. Produce a scoping document with these sections:

## Files
- `path/to/file.ts` (lines X-Y) — what changes here

## Changes
- file.ts: specific change description

## Do NOT Change
- Files or areas that must not be touched

## Acceptance Criteria
- [ ] Criterion with `verification command` → expected output

## Test Commands
bun test {relevant path}
npx tsc --noEmit

Rules:
- Read files before referencing them
- Be specific about line numbers and changes
- Do NOT implement — only scope
```

**Output:** Scoping artifact (markdown) stored in PRD

### Implementer

**Purpose:** Implement the scoped changes in an isolated worktree.

**Prompt template:**
```
IMPLEMENT — Issue #{number}

Issue: {url}
Branch: {type}/issue-{number}-{slug}

SCOPING DOC:
{scoping artifact}

RULES:
1. Work in your worktree — do not touch main
2. Follow the scoping doc precisely
3. Run `bun test` and `npx tsc --noEmit` before committing
4. Commit with: `{type}: description (#{number})\n\nCo-Authored-By: Maple <ianhogers@hotmail.com>`
5. Push and create PR as draft
6. Report: branch name, commit SHAs, PR URL

Do NOT:
- Change files not listed in scoping doc
- Add features not in scope
- Skip tests
```

**Output:** Branch with commits, draft PR

### Reviewer

**Purpose:** Review implementation against issue requirements.

**Prompt template:**
```
REVIEW — Issue #{number}

Issue: {url}
Title: {title}
Body:
{issue body}

Branch: {branch}
PR: {pr_url}

Review the implementation. For each finding, report:
- Severity: critical | major | minor
- Finding: factual description of what's wrong
- Evidence: command output, line reference, or test case

You are reviewing for:
1. Does it satisfy the issue requirements?
2. Are there bugs or edge cases?
3. Do tests pass? Type check pass?
4. Any regressions introduced?

Output format:
## Findings
| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| R1 | major | Missing null check | Line 45: `foo.bar` when foo can be undefined |

## Verdict
APPROVE (no findings) or NEEDS_FIXES (has findings)

Be thorough. Do not rubber-stamp.
```

**Output:** Findings table + verdict

### RedTeam

**Purpose:** Actively try to break the implementation.

**Prompt template:**
```
RED TEAM — Issue #{number}

Branch: {branch}
PR: {pr_url}

Your job is to BREAK this implementation. You are hostile.

Try:
1. Edge cases the implementation doesn't handle
2. Malformed inputs that crash it
3. Security vulnerabilities (injection, path traversal, etc.)
4. Race conditions or state corruption
5. Resource exhaustion
6. Unexpected interactions with other code

For each exploit found:
- Severity: critical | major | minor
- Finding: what breaks
- Reproduction: exact steps or test case to trigger

Output format:
## Exploits Found
| ID | Severity | Finding | Reproduction |
|----|----------|---------|--------------|
| X1 | critical | Null input crashes | `echo '{}' | bun run hook` |

## Verdict
SECURE (no exploits) or VULNERABLE (has exploits)

Be creative. Be adversarial. Find the flaws.
```

**Output:** Exploits table + verdict

### Fixer

**Purpose:** Fix findings without knowing original implementation reasoning.

**Prompt template:**
```
FIX REQUEST — Issue #{number}

Issue: {url}
Branch: {branch}

SCOPING DOC:
{scoping artifact}

FINDINGS TO FIX:
| ID | Severity | Finding | Evidence/Reproduction |
|----|----------|---------|----------------------|
{findings table — facts only, no reviewer reasoning}

Fix each finding. For each:
1. Read the relevant code
2. Understand what's broken (from the finding facts)
3. Implement the fix
4. Add/update tests to cover the case
5. Verify with `bun test` and `npx tsc --noEmit`

Commit each fix separately:
`fix(scope): address {finding ID} (#{number})`

Report: which findings addressed, commit SHAs, any findings you could not fix and why.

You have NOT seen the original implementation reasoning. Fix based on the facts.
```

**Output:** Fix commits, status per finding

## Anti-Rationalization Mechanisms

### 1. Agent Isolation

The Implementer agent is terminated after implementation. It never receives review feedback. A fresh Fixer agent handles all fixes.

**Why it works:** The Fixer has no memory of implementation decisions. It cannot think "I considered this and decided X was ok" because it never made those decisions.

### 2. Facts-Only Findings

Reviewer and RedTeam provide:
- What is broken (fact)
- Evidence (command output, line number, reproduction)

They do NOT provide:
- Why they think it's a problem
- Suggested fixes
- Reasoning about design decisions

**Why it works:** The Fixer cannot argue against reasoning it never sees. It just has to fix the failing case.

### 3. Hard Gate Enforcement

Findings are mandatory fix items. The pipeline cannot advance until:
- Reviewer verdict is APPROVE
- RedTeam verdict is SECURE

No self-assessment. No "I think it's fine." The reviewer agents make the call.

### 4. Explicit Sign-off

After fixes, the SAME Reviewer and RedTeam agents (via SendMessage) verify their findings are addressed. They must explicitly clear each finding.

**Why it works:** The agent that found the issue decides if it's fixed. The Fixer cannot declare victory.

## Pipeline Flow

```
                                    ┌─────────────┐
                                    │   GitHub    │
                                    │   Issues    │
                                    └──────┬──────┘
                                           │
                                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                         MAPLE (Orchestrator)                      │
│                                                                   │
│  ┌─────────┐   ┌─────────────┐   ┌──────────┬──────────┐         │
│  │ Scoper  │──►│ Implementer │──►│ Reviewer │ RedTeam  │         │
│  │ Agent   │   │ (worktree)  │   │  Agent   │  Agent   │         │
│  └─────────┘   └─────────────┘   └────┬─────┴────┬─────┘         │
│                                       │          │                │
│                                       ▼          ▼                │
│                               ┌───────────────────────┐           │
│                               │   Findings Merged     │           │
│                               └───────────┬───────────┘           │
│                                           │                       │
│                          ┌────────────────┴────────────────┐      │
│                          │                                 │      │
│                          ▼                                 ▼      │
│                   No findings?                      Has findings? │
│                          │                                 │      │
│                          ▼                                 ▼      │
│                   ┌──────────┐                      ┌──────────┐  │
│                   │  MERGE   │                      │  Fixer   │  │
│                   │   PR     │                      │  Agent   │  │
│                   └──────────┘                      └────┬─────┘  │
│                                                          │        │
│                                                          ▼        │
│                                              Re-review (same      │
│                                              Reviewer + RedTeam)  │
│                                                          │        │
│                                              Loop until cleared   │
│                                              or max retries       │
└──────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │     PRD     │
                                    │  (updated)  │
                                    └─────────────┘
```

### Parallel Execution

Maple can run multiple issues through the pipeline simultaneously:

```
Issue #127: ████████░░░░░░░░ reviewing
Issue #128: ██████░░░░░░░░░░ implementing  
Issue #129: ████░░░░░░░░░░░░ scoping
Issue #130: ░░░░░░░░░░░░░░░░ queued
```

Each Implementer works in its own worktree. No conflicts during parallel work. Maple merges approved worktrees sequentially.

## State Transitions

```
queued → scoping → implementing → reviewing → [fixing → re-reviewing]* → merging → completed
                                     │
                                     └──► parked (after max retries)
```

| Phase | Entry Condition | Exit Condition | PRD Update |
|-------|-----------------|----------------|------------|
| queued | Issue added to batch | Scoper spawned | Add to Pending list |
| scoping | Scoper spawned | Scoping artifact received | Store artifact |
| implementing | Scoping complete | Branch + PR created | Store branch, commits, PR |
| reviewing | Implementation complete | Reviewer + RedTeam verdicts | Store findings |
| fixing | Has findings | Fixer completes | Store fix attempts |
| re-reviewing | Fixes applied | Reviewers clear findings | Update finding status |
| merging | All findings cleared | PR merged | Move to Completed |
| parked | Max retries exceeded | Manual intervention | Move to Parked with reason |

## Failure Handling

| Failure Type | Action |
|--------------|--------|
| Scoper fails to produce artifact | Retry once, then park |
| Implementer tests fail | Retry up to 3 times, then park |
| Reviewer/RedTeam disagree | Require both to approve (AND, not OR) |
| Fixer cannot address finding | Log inability, retry with different approach, park after 3 |
| Merge conflict | Maple resolves manually, or park if complex |
| Agent timeout | Retry once, then park |
| Worktree corruption | Recreate worktree, re-implement from scoping |

**Park policy:** After 3 fix attempts on the same set of findings, move issue to Parked with detailed reason. Continue with other issues. Report all parked issues at batch end.

## Resume After Compaction

When Maple resumes (after compaction or new session):

1. **Read PRD:** Parse the batch PRD file
2. **Reconstruct state:** 
   - Issues in "Pending" → add to queue
   - Issues in "In Progress" → check phase, resume from there
   - Check for running agents via worktree existence
3. **Resume agents:**
   - If worktree exists with uncommitted changes → agent may be mid-work, wait or restart
   - If worktree has commits not in PR → push and continue
   - If PR exists → check review status
4. **Continue pipeline:** Process from current state

**PRD is the source of truth.** If agent state is ambiguous, read from PRD.

## Batch PRD Template

```markdown
# Autonomous Issue Pipeline — {Batch Name}

**Batch ID:** {YYYY-MM-DD}-{name}
**Started:** {ISO timestamp}
**Status:** IN_PROGRESS | COMPLETED | PAUSED

## Configuration

| Setting | Value |
|---------|-------|
| Max parallel issues | 3 |
| Max retries per issue | 3 |
| Auto-merge approved | true |
| Red team intensity | hostile |

## Queue

### Pending
- [ ] #{number} — {title}

### In Progress  
- [~] #{number} — {title} → phase: `{phase}`

### Completed
- [x] #{number} — {title} (#{pr_number})

### Parked
- [!] #{number} — {title} — reason: "{reason}"

---

## Issue Records

### #{number} — {title}

**Phase:** {phase}
**Worktree:** {path}
**Branch:** {branch}
**Retry count:** {n}

#### Scoping Artifact
{full scoping doc}

#### Implementation
- **Agent:** {agent_id}
- **Commits:** {sha list}
- **PR:** #{pr_number} ({status})

#### Review Findings
| ID | Source | Severity | Finding | Status |
|----|--------|----------|---------|--------|

#### Fix Attempts
{numbered list of fix attempts with agent, addressed findings, commits, result}

#### Sign-off
- [ ] Reviewer: {status}
- [ ] RedTeam: {status}

---
```

## Usage

### Starting a batch

```
/aip start --name "backlog-cleanup" --issues 127,128,129,130,131,132
```

Or with filters:
```
/aip start --name "bugs" --label bug --limit 10
```

### Resuming after compaction

```
/aip resume docs/plans/2026-04-12-aip-batch-backlog-cleanup.md
```

### Checking status

```
/aip status
```

### Pausing

```
/aip pause
```

## Open Questions

1. **Worktree cleanup:** When to delete worktrees? After merge? After batch complete?
2. **Parallel limit:** Start with 3 parallel issues. Adjust based on experience.
3. **RedTeam intensity:** "hostile" vs "thorough" — may need calibration to avoid false positives.
4. **Cross-issue dependencies:** If issue B depends on issue A's changes, detect and sequence them.
