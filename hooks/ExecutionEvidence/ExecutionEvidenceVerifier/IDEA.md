# Execution Evidence Verifier

> Catch state-changing commands with missing or thin output and demand proof.

## Problem

When an AI runs a command like `git push` or `curl -X POST`, the command might fail silently, produce no output, or not actually execute. The AI may still claim success based on the command it intended to run rather than what actually happened. Without verification, users trust fabricated outcomes.

## Solution

Classify each shell command by its side-effect risk. Commands that change external state (push, deploy, POST requests, database mutations) are flagged for evidence checking. If the command output is empty or lacks substantive content, inject a reminder into the AI's working context that says: "You ran a state-changing command but showed no evidence. Include the actual output before claiming it worked."

## How It Works

1. After a shell command finishes, check if it matches known state-changing patterns (git push, deploy, curl POST, etc.).
2. If it does, inspect the command output for substantive content — non-empty, containing meaningful data.
3. If evidence is missing, build a contextual reminder specific to the command type and inject it.
4. If the command is read-only or produced solid output, pass through silently with no intervention.

## Signals

- **Input:** The shell command string and its stdout/stderr output
- **Output:** A context reminder injected into the AI's next turn, or silent pass-through

## Context

This is a trust mechanism for AI-assisted development. It does not block commands — it ensures the AI cannot gloss over missing evidence when reporting results to the user.
