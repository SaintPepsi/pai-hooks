# Execution Evidence

> Verify that an AI actually ran the commands it claims to have run.

## Problem

AI assistants often describe what they plan to do — "I'll run the tests now" — and then present results without showing proof that the command actually executed. When a state-changing command (deploy, push, API call) produces no output or suspiciously thin output, there is no way to know whether it really happened or the AI hallucinated the outcome.

## Solution

Monitor every command the AI executes. When a command is classified as state-changing (deploys, pushes, destructive operations, network calls), check whether the output contains substantive evidence of execution. If evidence is missing, inject a reminder into the AI's context prompting it to show real proof before claiming success.

## How It Works

1. After every shell command completes, classify it as state-changing or read-only based on the command pattern.
2. If the command is state-changing, inspect the output for substantive content (non-empty, non-trivial).
3. If evidence is missing or too thin, inject a context reminder telling the AI to provide actual execution proof.
4. Read-only or evidence-rich commands pass through silently.

## Signals

- **Input:** Shell command text and its output after execution
- **Output:** Contextual reminder (when evidence is missing) or silent pass-through

## Context

Particularly useful in automated pipelines where an AI might claim a deploy succeeded based on pattern-matching rather than actual execution. Prevents "ghost runs" where the AI skips execution but narrates as if it happened.
