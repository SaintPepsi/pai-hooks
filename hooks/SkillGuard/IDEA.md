# Skill Guard

> Prevent the AI from invoking skills that were triggered by false pattern matches.

## Problem

AI systems with many registered skills use keyword matching to decide which skill to invoke. Some skills have trigger words that overlap with common language, causing them to fire on unrelated prompts. This is especially common with skills listed early in the registry — they get a positional bias advantage and are selected even when the user's intent has nothing to do with them.

## Solution

Maintain a blocklist of skills known to produce false-positive activations. Before any skill invocation executes, check whether the target skill is on the blocklist. If it is, block the invocation and explain why, instructing the AI to only invoke that skill when the user's intent is unambiguous.

## How It Works

1. Before a skill invocation tool executes, extract the skill name from the parameters.
2. Check the skill name against a maintained blocklist of false-positive-prone skills.
3. If the skill is on the blocklist, block the invocation with an explanation of the false-positive pattern.
4. If the skill is not on the blocklist, allow it through.

## Signals

- **Input:** Skill invocation requests with the target skill name
- **Output:** Block with explanation (for blocklisted skills) or silent pass-through
