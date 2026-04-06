# Architecture Escalation

> Detect when repeated fix attempts fail and escalate to deeper analysis instead of looping forever.

## Problem

AI agents solving problems often get stuck in loops: they try a fix, it fails, they try a similar fix, it fails again, and they keep going. Each attempt costs time and tokens but the approach is fundamentally wrong. The agent lacks the meta-awareness to recognize that repeated failure on the same problem signals an architectural issue, not a simple bug.

## Solution

Track fix attempt counts per problem. When attempts cross a warning threshold, inject advice to reconsider the approach. When attempts cross a higher stop threshold, inject a strong directive to abandon the current strategy and escalate to deeper analytical techniques. Separately, route sub-agent work to appropriate capability tiers so simple tasks go to cheaper models and complex tasks go to stronger ones.

## How It Works

1. Each time a problem criterion transitions back to "in progress" (meaning the previous attempt failed), increment a counter for that criterion.
2. At the warning threshold (3 failed attempts), inject a message advising the agent to question its fundamental approach.
3. At the stop threshold (5 failed attempts), inject a strong directive to stop retrying and use structured analytical techniques instead.
4. When execution plans are loaded, inject guidance on which sub-tasks to delegate to cheaper models versus handle directly.

## Signals

- **Input:** Task status transitions (criterion moving back to in-progress), execution plan loading events
- **Output:** Warning or stop messages injected into context, delegation guidance for sub-agent routing
