# AgentLifecycleStart

## Overview

AgentLifecycleStart is a **SubagentStart** hook that creates a per-agent lifecycle file when a subagent is spawned. It writes a JSON record to `MEMORY/STATE/agents/agent-{session_id}.json` containing the agent's ID, type, start time, and a null `completedAt` field.

This hook works in tandem with AgentLifecycleStop, which updates the file when the agent finishes and performs orphan cleanup. Together they provide a persistent record of all subagent activity across sessions.

## Event

`SubagentStart` — fires when a new subagent is spawned, creating its lifecycle tracking file.

## When It Fires

- A subagent is spawned (any subagent start event)
- The hook accepts all SubagentStart inputs unconditionally

It does **not** fire when:

- No subagent start event occurs (only fires on SubagentStart)
- The hook is not registered in the active hook configuration

## What It Does

1. Ensures the agents directory exists (`MEMORY/STATE/agents/`)
2. Creates an `AgentFileData` record with the session ID, agent type set to "unknown", the current timestamp as `startedAt`, and `completedAt` set to `null`
3. Writes the JSON record to `agent-{session_id}.json` in the agents directory
4. Logs the start event to stderr

```typescript
// Core lifecycle initialization
const data: AgentFileData = {
  agentId: input.session_id,
  agentType: "unknown",
  startedAt: deps.now().toISOString(),
  completedAt: null,
};
deps.writeFile(agentFilePath(deps, input.session_id), JSON.stringify(data));
```

## Examples

### Example 1: Agent spawned successfully

> A background Explore agent is spawned with session ID `ses-abc123`. AgentLifecycleStart creates `MEMORY/STATE/agents/agent-ses-abc123.json` with `startedAt` set to the current time and `completedAt: null`. The hook returns `silent`.

### Example 2: Directory creation failure

> The agents directory does not exist and cannot be created (e.g., permissions issue). AgentLifecycleStart logs the error to stderr and returns `silent` -- it never blocks agent spawning due to lifecycle tracking failures.

## Dependencies

| Dependency                       | Type    | Purpose                                                                    |
| -------------------------------- | ------- | -------------------------------------------------------------------------- |
| `result`                         | core    | `ok()` for Result-based returns                                            |
| `@anthropic-ai/claude-agent-sdk` | SDK     | `SyncHookJSONOutput` union type for execute return                         |
| `AgentLifecycle/shared`          | shared  | `AgentFileData` type, `AgentLifecycleDeps`, `defaultDeps`, `agentFilePath` |
| `paths`                          | lib     | Resolves PAI directory for agent state storage (via shared deps)           |
| `fs`                             | adapter | File operations: writeFile, ensureDir (via shared deps)                    |
