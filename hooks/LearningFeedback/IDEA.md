# Learning Feedback

> Capture learning signals from user interactions and turn them into concrete system improvements.

## Problem

AI assistants make the same mistakes across sessions because they have no systematic way to learn from user feedback. Explicit ratings go unrecorded, implicit frustration or satisfaction passes unnoticed, and communication preferences discovered in one session are forgotten by the next. Without a feedback loop, improvement is manual and sporadic.

## Solution

Build a three-stage learning pipeline: capture signals (explicit ratings, implicit sentiment, relationship context), persist them as structured data, and periodically analyze the accumulated signals to propose concrete improvements. Each stage operates independently — signals accumulate continuously, relationship notes build session over session, and analysis runs on a budget-aware schedule.

## How It Works

1. On every user message, check for explicit ratings (numeric scores) and run implicit sentiment analysis on the message text.
2. Log all ratings and sentiment signals to append-only structured files with timestamps, confidence scores, and session context.
3. At session end, analyze the conversation transcript for relationship signals — preferences, frustrations, positive reactions, milestones — and persist them as daily notes.
4. Periodically (gated by a credit accumulation system to respect usage budgets), spawn a background analysis agent that reads all accumulated signals and proposes specific, evidence-backed improvements.

## Signals

- **Input:** User messages (for ratings and sentiment), session transcripts (for relationship context), accumulated learning files (for analysis)
- **Output:** Structured rating logs, daily relationship notes, and improvement proposals with confidence scores and evidence chains
