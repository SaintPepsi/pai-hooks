# Capability-Tier Delegation

> Route sub-agent work to different AI capability tiers based on task complexity.

## Problem

Not all sub-tasks require the same level of reasoning. Simple mechanical work (applying a known pattern across files, running commands, writing boilerplate) costs the same as complex reasoning if sent to a high-capability model. Conversely, sending architectural decisions to a cheaper model produces poor results. Without routing guidance, all work goes to the same tier regardless of complexity.

## Solution

When an execution plan is loaded, inject classification guidance that distinguishes mechanical tasks (delegate to a cheaper, faster model) from reasoning tasks (handle directly with the stronger model). Define clear boundaries: the cheaper tier never makes design decisions, never modifies requirements, and every output is verified by the stronger tier before being accepted.

## How It Works

1. After a plan execution skill loads, detect the specific skill activation event.
2. Inject structured delegation guidance into the agent's context.
3. The guidance classifies each plan step into mechanical (exact edits, pattern application, command execution, boilerplate) or reasoning (architecture, debugging, design, judgment calls).
4. Mechanical steps are dispatched to cheaper sub-agents with exact instructions; independent steps may run in parallel.
5. Reasoning steps are handled directly by the primary agent.

## Signals

- **Input:** Plan execution skill activation event
- **Output:** Injected delegation guidance classifying task types and routing rules, or silent pass-through for other skill activations
