# Agent Preprompt Injector

> Automatically inject coordination instructions into every background agent before it starts working.

## Problem

Background worker agents need coordination context (who they are, what thread they belong to, what their task is) to function within a multi-agent system. If an operator forgets to include these instructions, the agent runs without coordination awareness. Manual inclusion is error-prone and easy to skip.

## Solution

Intercept background agent launches before they execute. Read a template file containing coordination instructions, replace placeholder variables (agent name, thread ID, task description) with actual values, and append the filled template to the agent's prompt. This makes it impossible to spawn a coordinated worker without the right instructions.

## How It Works

1. Before an agent tool executes, check if it is a background launch.
2. Resolve the template file path from configuration or a default location.
3. Read the template and replace placeholder variables with values extracted from the agent invocation (name, thread ID, task description).
4. Append the filled template to the agent's prompt via a separator.
5. If the template is missing or unreadable, allow the agent to proceed without injection.

## Signals

- **Input:** Background agent launch events (agent tool invocations flagged as background)
- **Output:** Modified agent prompt with coordination instructions appended, or unmodified pass-through
