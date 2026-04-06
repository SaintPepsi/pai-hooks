# Question Answered Tracker

> Detect when the user answers an AI-posed question and log the interaction.

## Problem

When an AI assistant asks the user a question, the response arrives as a normal input with no structured link back to the question. This makes it hard to build a feedback loop: the system cannot easily associate answers with the questions that prompted them, so it cannot learn from the exchange.

## Solution

Listen for completion of question-asking tool invocations. When detected, mark the interaction so downstream systems know a question was asked and answered. This provides the structural hook for future learning — even if the current implementation is lightweight, the detection point is established.

## How It Works

1. Filter for events where the AI's question-asking tool has just completed.
2. Acknowledge the event silently (no user-facing output).
3. Provide an integration point for future enrichment (e.g., logging the Q&A pair, adjusting question strategy).

## Signals

- **Input:** Tool completion event for a question-asking interaction
- **Output:** Silent acknowledgment (no visible effect on the session)

## Context

This hook establishes the detection point. The heavier logic — extracting question text, correlating answers, building a learning corpus — can be layered on top without changing the trigger mechanism.
