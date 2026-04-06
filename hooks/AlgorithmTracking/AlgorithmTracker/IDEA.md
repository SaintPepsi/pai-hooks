# Algorithm Tracker

> Detect phase transitions in a structured workflow by analyzing commands and task activity.

## Problem

A structured problem-solving workflow moves through phases (Observe, Think, Plan, Build, Verify, Learn), but nothing inherently records which phase the session is in. Without tracking, there is no progress visibility, no way to correlate work items to the phase that produced them, and no detection of rework cycles when the workflow loops back to an earlier phase.

## Solution

Observe four categories of session activity and update a persistent state object accordingly: (1) detect phase transitions from command patterns, (2) track success criteria from task creation, (3) update criteria status from task updates, and (4) record agent spawns. When a transition back to an early phase is detected after prior completion, flag it as a rework iteration.

## How It Works

1. After a command executes, check if it contains a known phase-announcement pattern (e.g., "entering the observe phase").
2. If a phase transition is detected, update the session state to the new phase and append it to phase history.
3. If the transition is from a completed/late phase back to the beginning, increment the rework counter and notify.
4. After a task is created, parse its identifier for a criteria pattern and add it to the session's criteria list.
5. After a task's status changes, update the matching criterion's status (pending, in-progress, completed, failed).
6. After an agent is spawned, record its name, type, and assigned task in session state.
7. When criteria count crosses thresholds (12, 20, 40), automatically infer and update the session's effort level.

## Signals

- **Input:** Completed commands, task creation events, task status updates, agent spawn events
- **Output:** Persistent session state tracking current phase, phase history, criteria, agents, effort level, and rework count
