# AlgorithmTracker

## Overview

AlgorithmTracker is a **sync PostToolUse** hook that consolidates four algorithm state tracking responsibilities into a single hook. It monitors Bash commands for voice notification curls that signal phase transitions, TaskCreate events for ISC criteria creation, TaskUpdate events for criteria status changes, and Task tool events for agent spawns. All state is persisted via the `algorithm-state` library.

The hook also handles rework detection (re-entering OBSERVE from a completed state) and effort level inference based on criteria count.

## Event

`PostToolUse` — fires after Bash, TaskCreate, TaskUpdate, or Task tool use, tracking algorithm phase transitions, criteria changes, and agent spawns.

## When It Fires

- The `tool_name` is one of: `"Bash"`, `"TaskCreate"`, `"TaskUpdate"`, or `"Task"`
- A valid `session_id` is present in the input
- For Bash: the command contains a voice notification curl to `localhost:8888/notify` with a phase message
- For TaskCreate: the tool input or result contains ISC criterion patterns (e.g., `ISC-C1:`, `ISC-A1:`)
- For TaskUpdate: the input includes `taskId` and `status` fields
- For Task: any Task tool invocation (agent spawn)

It does **not** fire when:

- The tool is not one of the four tracked tool types
- No `session_id` is present in the input
- For Bash: the command does not target `localhost:8888/notify` or contains no recognizable phase message

## What It Does

1. **Phase tracking (Bash):** Detects voice curl commands matching phase patterns (OBSERVE, THINK, PLAN, BUILD, EXECUTE, VERIFY, LEARN). On detection, ensures the session is active, transitions to the new phase, and handles rework detection
2. **Criteria tracking (TaskCreate):** Parses ISC criterion patterns from task subjects and results. Adds criteria to state with type (criterion vs anti-criterion), status, and phase context. Infers effort level from criteria count (12+ = Extended, 20+ = Advanced, 40+ = Deep)
3. **Criteria updates (TaskUpdate):** Maps task status changes (pending, in_progress, completed, deleted) to criterion status updates
4. **Agent tracking (Task):** Records spawned agents with name, type, and task description

```typescript
// Phase detection from voice notification curls
const { phase, isAlgorithmEntry } = detectPhaseFromBash(tool_input.command);
if (phase) {
  ensureSessionActive(session_id, deps);
  deps.phaseTransition(session_id, phase);
}

// Criteria from TaskCreate
if (criterion) {
  deps.criteriaAdd(session_id, {
    id: criterion.id,
    description: criterion.description,
    type: criterion.id.startsWith("A") ? "anti-criterion" : "criterion",
    status: "pending",
    createdInPhase: state?.currentPhase || "OBSERVE",
  });
}
```

## Examples

### Example 1: Phase transition detected

> Claude executes a Bash curl to `localhost:8888/notify` with `"message": "Entering the Build phase"`. AlgorithmTracker detects the BUILD phase, transitions the algorithm state, and logs the transition.

### Example 2: ISC criteria created

> Claude creates a task with subject `ISC-C1: All API endpoints return proper error codes`. AlgorithmTracker parses the criterion ID and description, adds it to the algorithm state as a "criterion" with status "pending", and infers the effort level if the criteria count crosses a threshold.

### Example 3: Rework detection

> A session in COMPLETE phase with existing criteria receives a new OBSERVE phase transition. AlgorithmTracker detects this as rework, reactivates the session, increments the rework counter, and sends a voice notification announcing the rework iteration.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result wrapping |
| `algorithm-state` | lib | `readState`, `writeState`, `phaseTransition`, `criteriaAdd`, `criteriaUpdate`, `agentAdd`, `effortLevelUpdate` |
| `fs` | adapter | `fileExists`, `readJson` for state and session name access |
