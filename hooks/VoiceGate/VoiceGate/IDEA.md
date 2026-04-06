# Voice Gate Filter

> Block sub-agent voice requests so only the primary session can use text-to-speech.

## Problem

When an AI system delegates work to sub-agents, each sub-agent may independently try to send voice notifications to the user. This results in overlapping speech, duplicate announcements, and a confusing audio experience. There is no built-in mechanism to restrict TTS access by agent hierarchy.

## Solution

Intercept outgoing requests to the TTS service by matching the service endpoint in shell commands. Before the command executes, check the agent's identity — is it the primary session or a spawned sub-agent? Primary sessions pass through; sub-agents are blocked with a clear explanation.

## How It Works

1. Match shell commands that contain the voice service endpoint (e.g., a localhost TTS server).
2. Check the current execution environment for sub-agent indicators.
3. If the caller is not a sub-agent, allow the command through.
4. If the caller is a sub-agent, block the command and return a reason explaining that voice access is primary-session only.

## Signals

- **Input:** Shell commands containing the TTS service endpoint
- **Output:** Block with explanation (sub-agents) or silent pass-through (primary session)
