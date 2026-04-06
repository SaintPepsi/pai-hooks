# Question Answered

> Track when the AI asks the user a question and record the response.

## Problem

AI assistants ask clarifying questions during a session, but the question-answer exchange is not captured in a structured way. Without tracking these pairs, the system cannot learn which questions led to useful answers or adapt its questioning behavior over time.

## Solution

Detect when the AI uses a question-asking tool and capture the subsequent user response. Log these question-answer pairs so they can be analyzed for patterns — which questions are asked most, which get short vs. detailed answers, and which could be avoided by remembering prior answers.

## How It Works

1. After the AI invokes a question-asking tool, capture the event.
2. Record the question context and the user's response.
3. Store the pair in a structured format for later analysis.

## Signals

- **Input:** Tool completion events for question-asking interactions
- **Output:** Silent logging of question-answer pairs

## Context

This is currently a minimal tracking hook. The infrastructure is in place for future enrichment — learning from past Q&A patterns to reduce redundant questions across sessions.
