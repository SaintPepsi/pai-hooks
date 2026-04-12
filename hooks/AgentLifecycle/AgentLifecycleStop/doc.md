# AgentLifecycleStop

## Overview

AgentLifecycleStop is a **SubagentStop** hook that marks an agent as complete and performs opportunistic orphan cleanup. When a subagent finishes, this hook updates the agent's lifecycle file with a `completedAt` timestamp and then scans for orphaned agent files (agents that started more than 30 minutes ago but never completed).

This hook is the counterpart to AgentLifecycleStart. Together they maintain per-agent JSON files in `MEMORY/STATE/agents/` that track the lifecycle of every spawned subagent. AgentLifecycleStop includes crash recovery logic to handle corrupt or missing agent files gracefully.

## Event

`SubagentStop` — fires when a subagent finishes execution, updating its lifecycle record and cleaning up stale orphans.

## When It Fires

- A subagent completes execution (any subagent stop event)
- The hook accepts all SubagentStop inputs unconditionally

It does **not** fire when:

- No subagent stop event occurs (only fires on SubagentStop)
- The hook is not registered in the active hook configuration

## What It Does

1. Ensures the agents directory exists (`MEMORY/STATE/agents/`)
2. Resolves the agent file path using the session ID (`agent-{session_id}.json`)
3. Attempts to read the existing agent file:
   - If the file exists and parses correctly, updates `completedAt` with the current timestamp
   - If the file is corrupt (parse failure), performs crash recovery with a fresh data record
   - If the file is missing, performs crash recovery with a fresh data record
4. Writes the updated agent data back to the file
5. Runs opportunistic orphan cleanup: scans all agent files and removes any that have no `completedAt` and were started more than 30 minutes ago

```typescript
// Core lifecycle flow
const filePath = agentFilePath(deps, input.session_id);
data.completedAt = nowIso;
deps.writeFile(filePath, JSON.stringify(data));

// Opportunistic orphan cleanup
cleanupOrphans(deps, input.session_id);
```

## Examples

### Example 1: Normal agent completion

> A background CodeReview agent finishes its work. AgentLifecycleStop reads `agent-abc123.json`, sets `completedAt` to the current time, writes the file back, and then checks for orphans. No orphans are found, so cleanup is a no-op.

### Example 2: Crash recovery on corrupt file

> A previous session crashed, leaving a corrupt `agent-xyz789.json`. When a new subagent stops, AgentLifecycleStop detects the parse failure, logs a crash recovery message to stderr, and creates a fresh record with both `startedAt` and `completedAt` set to now.

### Example 3: Orphan cleanup

> During the orphan scan, AgentLifecycleStop finds `agent-old456.json` with no `completedAt` and a `startedAt` more than 30 minutes ago. It removes the orphaned file and logs the cleanup.

## Dependencies

| Dependency                       | Type    | Purpose                                                                                      |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `result`                         | core    | `ok()` and `tryCatch` for Result-based returns                                               |
| `error`                          | core    | `jsonParseFailed` error constructor                                                          |
| `@anthropic-ai/claude-agent-sdk` | SDK     | `SyncHookJSONOutput` union type for execute return                                           |
| `AgentLifecycle/shared`          | shared  | `AgentFileData` type, `AgentLifecycleDeps`, `defaultDeps`, `agentFilePath`, `cleanupOrphans` |
| `paths`                          | lib     | Resolves PAI directory for agent state storage (via shared deps)                             |
| `fs`                             | adapter | File operations: read, write, exists, ensureDir, readDir, removeFile (via shared deps)       |
