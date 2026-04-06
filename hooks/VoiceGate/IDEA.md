# Voice Gate

> Control which AI sessions can use text-to-speech, preventing sub-agents from speaking aloud.

## Problem

In multi-agent AI systems, a primary agent may spawn sub-agents to handle parallel tasks. If all agents have access to text-to-speech, the user hears overlapping or redundant voice notifications from every sub-agent, creating noise and confusion.

## Solution

Intercept any request to a voice/TTS service before it executes. Check whether the requesting agent is the primary session or a sub-agent. Allow primary sessions through; block sub-agents silently. This ensures only one agent — the one the user is directly interacting with — can speak.

## How It Works

1. Before any command that targets the voice/TTS service endpoint, intercept the request.
2. Determine whether the current session is a primary agent or a sub-agent.
3. If primary, allow the request through unchanged.
4. If sub-agent, block the request with an explanation that voice is restricted to the primary session.

## Signals

- **Input:** Shell commands targeting a voice/TTS service endpoint
- **Output:** Block (for sub-agents) or silent pass-through (for primary sessions)
