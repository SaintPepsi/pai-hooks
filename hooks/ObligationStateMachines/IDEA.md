# Obligation State Machines

> Tracker/enforcer pairs that create obligations when code changes and block session end until those obligations are fulfilled.

## Problem

Developers and AI assistants routinely modify code without updating documentation, writing tests, or citing their sources. These obligations are easy to forget in the flow of work, and by the time someone notices, the context is lost. Reminders after the fact are too late — the person who made the change has moved on.

## Solution

Use paired state machines — a tracker and an enforcer — to monitor work in real time. The tracker watches for actions that create obligations (editing code, referencing external sources). The enforcer blocks the session from ending until those obligations are fulfilled (docs updated, tests written, citations added). A configurable block limit prevents infinite loops — after enough reminders, the system releases with a written review.

## How It Works

1. A tracker observes every file write and records which files were changed, creating a "pending obligations" list in session state.
2. When the corresponding fulfillment action occurs (doc updated, test run, citation added), the tracker removes that item from the pending list.
3. When the user tries to end the session, the enforcer checks the pending list.
4. If obligations remain, the enforcer blocks the session and explains what still needs to be done.
5. After a configurable number of blocks, the enforcer releases the session and writes a review log of what was skipped.

## Signals

- **Input:** File writes (tracker) and session-end attempts (enforcer)
- **Output:** Block with explanation of unfulfilled obligations, or silent pass if all obligations are met

## Context

This pattern generalizes to any "if you do X, you must also do Y" rule. Each obligation domain (docs, tests, citations, hook docs, spot checks) is an independent tracker/enforcer pair sharing the same state machine pattern.
