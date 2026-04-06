# Architecture Escalation Detector

> Track fix attempt counts per problem criterion and escalate when repeated failures indicate an architectural issue.

## Problem

When an AI agent tries to fix a bug or satisfy a requirement, it may attempt the same general approach multiple times. Each retry costs tokens and time. After 3 or 5 failed attempts on the same criterion, the problem is almost certainly not a surface-level bug but a deeper design flaw. The agent has no built-in mechanism to recognize this pattern and change strategy.

## Solution

Maintain a per-session counter for each problem criterion. Every time a criterion transitions back to "in progress" (meaning the previous fix attempt did not resolve it), increment the counter. At 3 failures, inject a warning suggesting the agent reconsider its approach. At 5 failures, inject a strong stop directive recommending structured first-principles analysis and multi-perspective debate instead of another targeted fix.

## How It Works

1. After a task status update, check if a criterion is transitioning to "in progress" status.
2. Load the escalation state file for this session (or create a fresh one).
3. Increment the in-progress counter for the specific criterion ID.
4. If the failed attempt count reaches 3, inject a warning message advising the agent to question its fundamental approach and consider root cause analysis.
5. If the failed attempt count reaches 5, inject a stop message directing the agent to abandon the current strategy entirely and use analytical decomposition techniques.
6. Persist the updated state so counts survive across the session.

## Signals

- **Input:** Task status update events where a criterion moves to "in progress"
- **Output:** Warning message at 3 failed attempts, stop directive at 5 failed attempts, or silent pass-through below threshold
