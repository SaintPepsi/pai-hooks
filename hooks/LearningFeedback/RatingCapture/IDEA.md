# Rating Capture

> Capture explicit user ratings and detect implicit sentiment from every message.

## Problem

Users rarely give formal feedback to AI assistants. When they do (a quick "8" or "3 - that was wrong"), it needs to be captured instantly. More often, feedback is implicit — frustration in phrasing, enthusiasm in word choice — and goes entirely unrecorded. Without capturing both explicit and implicit signals, the system has no data to improve from.

## Solution

Intercept every user message and run two detection paths. First, check for explicit ratings (a bare number 1-10, optionally followed by a comment). Second, for longer messages, run lightweight sentiment analysis using an LLM to detect emotional signals and assign a confidence-weighted rating. Log both types as structured entries. For low ratings, capture additional context for detailed failure analysis.

## How It Works

1. On every user message, first check if it matches an explicit rating pattern (a number 1-10 with optional comment).
2. If explicit: log the rating immediately with timestamp and session ID.
3. If not explicit and the message is long enough: send it (with recent conversation context) to a fast sentiment analysis model.
4. If the sentiment model returns a rating with sufficient confidence, log it as an implicit signal.
5. For any rating below 5 (explicit or implicit), capture the surrounding conversation context and write a detailed learning file for later analysis.
6. For ratings at 3 or below, trigger a separate failure capture process for deeper investigation.

## Signals

- **Input:** User message text and recent conversation transcript
- **Output:** Structured rating entries (timestamp, score, source, confidence, session ID) appended to a ratings log; detailed learning files for low ratings
