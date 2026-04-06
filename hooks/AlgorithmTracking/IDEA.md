# Algorithm Tracking

> Track which phase of a structured problem-solving workflow the session is in, and validate version compatibility.

## Problem

Structured workflows (e.g., Observe-Think-Plan-Build-Verify-Learn) move through distinct phases. Without tracking, the system cannot report progress, detect rework cycles, or correlate criteria and agents to the phase that created them. Additionally, the workflow definition can evolve upstream, and running an outdated version without awareness leads to subtle behavioral mismatches.

## Solution

Monitor session activity for signals that indicate phase transitions, criteria creation, criteria status changes, and agent spawns. Maintain a persistent state object that records the current phase, phase history, success criteria, and spawned agents. Separately, check at session start whether the local workflow version is still current compared to the upstream source.

## How It Works

1. When a command matches a known phase-transition pattern, update the session state to the new phase and record the transition in phase history.
2. When a task is created with a criteria-style identifier, add it to the session's criteria list and infer effort level from criteria count.
3. When a task's status changes, update the corresponding criterion's status in session state.
4. When a sub-agent is spawned, record its name, type, and task in session state.
5. At session start, compare the local workflow version against the upstream version and write a state file indicating whether an update is available.

## Signals

- **Input:** Command executions (for phase detection), task creation/updates (for criteria), agent spawn events, session start (for version check)
- **Output:** Persistent session state with phase, criteria, and agents; version-update availability flag

## Context

This is useful for any system that follows a structured multi-phase methodology and wants observability into where it is in the process, how many iterations it has gone through, and whether its methodology definition is up to date.
