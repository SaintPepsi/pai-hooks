# Skill Invocation Guard

> Block skill calls that are known false positives from keyword pattern matching.

## Problem

When an AI has dozens of registered skills, each with keyword triggers, some skills get activated by prompts that have nothing to do with them. A skill triggered by the word "key" fires whenever the user mentions "key findings." Skills listed earlier in the registry are disproportionately selected due to position bias in pattern matching.

## Solution

Intercept every skill invocation before it executes. Compare the target skill name against a curated blocklist of skills that are known to produce false-positive triggers. If matched, block the call and return an explanation so the AI can self-correct. Legitimate invocations (where the user explicitly names the skill) are unaffected because the blocklist only targets ambiguous triggers.

## How It Works

1. Before the skill invocation tool runs, extract the skill name from the input parameters.
2. Normalize the skill name (lowercase, trimmed).
3. Check against the blocklist of known false-positive skills.
4. If blocked, return an explanation identifying the position-bias pattern and the correct trigger conditions.
5. If not blocked, pass through silently.

## Signals

- **Input:** Skill invocation tool call with skill name and parameters
- **Output:** Block with diagnostic explanation, or silent pass-through
