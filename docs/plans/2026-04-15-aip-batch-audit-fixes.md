# Autonomous Issue Pipeline — Audit Fixes Batch

**Batch ID:** 2026-04-15-audit-fixes
**Started:** 2026-04-15T10:00:00Z
**Status:** IN_PROGRESS

## Configuration

| Setting | Value |
|---------|-------|
| Max parallel issues | 5 |
| Max retries per issue | 3 |
| Auto-merge approved | true |
| Red team intensity | hostile |

## Queue

### Pending
- [ ] #157 — fix(agent-runner): unguarded JSON.parse in critical paths
- [ ] #158 — fix(UpdateCounts): unguarded JSON.parse on settings.json
- [ ] #159 — fix(WikiIngest): unguarded JSON.parse and insufficient validation
- [ ] #160 — refactor(hook-inputs): define discriminated union for tool_input
- [ ] #161 — fix(AgentCompleteTracker): tool_response vs tool_output schema mismatch
- [ ] #162 — fix(RelationshipMemory): insufficient validation before TranscriptEntry cast
- [ ] #163 — refactor(hook-config): typed return paths and failure logging
- [ ] #164 — refactor(test-helpers): type runHookScript input parameter
- [ ] #165 — refactor(json): safeJsonParse should return Result<unknown>
- [ ] #166 — fix(narrative-reader): add object type guard after JSON.parse
- [ ] #167 — fix(LoadContext.proposals.test): remove as any casts
- [ ] #168 — fix(yaml): log YAML parse errors instead of silent null
- [ ] #169 — fix(regex): log invalid regex patterns instead of silent false
- [ ] #170 — fix(log): surface ensureDir failures to stderr
- [ ] #171 — fix(hook-config): distinguish failure modes in readRaw
- [ ] #172 — fix(SteeringRuleInjector): log fallback events instead of silent defaults
- [ ] #173 — fix(LearningActioner): log cache read failures instead of silent zero
- [ ] #174 — fix: fail explicitly when HOME is unset instead of using / fallback
- [ ] #175 — fix(RatingCapture): log JSONL parse errors for debugging
- [ ] #176 — test: fix if (!result.ok) return pattern that silently passes on errors
- [ ] #177 — test: fix conditional stdout guards that skip assertions
- [ ] #178 — test: replace typeof result.ok assertions with actual behavior checks
- [ ] #179 — test: add value assertions to type-only checks
- [ ] #180 — fix(runner): log warning on event type fallback
- [ ] #181 — refactor(hook-inputs): type tool_response properly
- [ ] #182 — test: add behavioral assertions to no-op hook tests

### In Progress

### Completed

### Parked

---

## Issue Records

### #157 — fix(agent-runner): unguarded JSON.parse in critical paths

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #158 — fix(UpdateCounts): unguarded JSON.parse on settings.json

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #159 — fix(WikiIngest): unguarded JSON.parse and insufficient validation

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #160 — refactor(hook-inputs): define discriminated union for tool_input

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #161 — fix(AgentCompleteTracker): tool_response vs tool_output schema mismatch

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #162 — fix(RelationshipMemory): insufficient validation before TranscriptEntry cast

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #163 — refactor(hook-config): typed return paths and failure logging

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #164 — refactor(test-helpers): type runHookScript input parameter

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #165 — refactor(json): safeJsonParse should return Result<unknown>

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #166 — fix(narrative-reader): add object type guard after JSON.parse

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #167 — fix(LoadContext.proposals.test): remove as any casts

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #168 — fix(yaml): log YAML parse errors instead of silent null

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #169 — fix(regex): log invalid regex patterns instead of silent false

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #170 — fix(log): surface ensureDir failures to stderr

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #171 — fix(hook-config): distinguish failure modes in readRaw

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #172 — fix(SteeringRuleInjector): log fallback events instead of silent defaults

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #173 — fix(LearningActioner): log cache read failures instead of silent zero

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #174 — fix: fail explicitly when HOME is unset instead of using / fallback

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #175 — fix(RatingCapture): log JSONL parse errors for debugging

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #176 — test: fix if (!result.ok) return pattern that silently passes on errors

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #177 — test: fix conditional stdout guards that skip assertions

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #178 — test: replace typeof result.ok assertions with actual behavior checks

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #179 — test: add value assertions to type-only checks

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #180 — fix(runner): log warning on event type fallback

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #181 — refactor(hook-inputs): type tool_response properly

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

### #182 — test: add behavioral assertions to no-op hook tests

**Phase:** queued
**Worktree:** N/A
**Branch:** N/A
**Retry count:** 0

#### Scoping Artifact
<!-- Pending -->

#### Implementation
<!-- Pending -->

#### Review Findings
<!-- Pending -->

#### Fix Attempts
<!-- Pending -->

#### Sign-off
- [ ] Reviewer: pending
- [ ] RedTeam: pending

---

## Batch Summary

<!-- To be filled at completion -->
