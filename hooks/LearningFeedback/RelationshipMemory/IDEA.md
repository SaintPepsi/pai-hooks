# Relationship Memory

> Persist communication preferences and working-style observations between sessions.

## Problem

AI assistants forget everything about the user between sessions. Preferences discovered through interaction ("they get frustrated when I over-explain," "they respond well to concise bullet points") are lost. Each session starts from zero relationship context, leading to repeated friction and a feeling that the assistant never learns.

## Solution

At the end of each session, analyze the conversation transcript for relationship-relevant signals — preferences, frustrations, positive reactions, and milestones. Classify each observation by type and confidence, then append it to a daily relationship log. These notes accumulate over time and are loaded into future sessions, giving the assistant persistent memory of how the user communicates and what they value.

## How It Works

1. At session end, read the full conversation transcript.
2. Scan user messages for preference indicators (likes, dislikes, frustrations) and positive feedback patterns.
3. Scan assistant messages for session summaries and milestone markers (breakthroughs, first-time events).
4. Aggregate signals: if multiple frustration or positive indicators appear, record an observation with a confidence score.
5. Write all observations to a daily relationship log file, organized by timestamp and tagged with the relevant people.

## Signals

- **Input:** Session conversation transcript (user and assistant messages)
- **Output:** Structured relationship notes (type, entities, content, confidence) appended to a daily log file

## Context

Works best as part of a system where relationship notes are loaded back into future sessions at startup, creating a persistent memory of working dynamics.
